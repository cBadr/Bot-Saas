import { ForbiddenException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import {
  BinanceClient,
  BinanceRateLimiter,
  createBinanceClient,
  createPublicBinanceClient,
  extractFilters,
  validateOrder,
} from '@orca/exchange';
import {
  Decimal,
  decryptSecret,
  FEE_FREE_QUOTE_ASSET,
  roundToStepSize,
  roundToTickSize,
} from '@orca/shared';
import { env } from '@orca/config';
import { createLogger } from '@orca/logger';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';

const log = createLogger('TRADE', { module: 'WalletService' });
const encSecret = env.ENCRYPTION_SECRET ?? env.AUTH_SECRET;

interface BalanceWithValue {
  asset: string;
  free: string;
  locked: string;
  total: string;
  fdusdPrice: string | null;
  fdusdValue: string;
  /** True if a tradeable <asset>FDUSD pair exists. */
  tradeable: boolean;
}

@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  private async getClient(userId: string, apiKeyId: string): Promise<BinanceClient> {
    const k = await this.prisma.exchangeApiKey.findUnique({ where: { id: apiKeyId } });
    if (!k) throw new NotFoundException('API key not found');
    if (k.userId !== userId) throw new ForbiddenException();
    if (k.status !== 'ACTIVE') throw new BadRequestException('API key not active');
    const limiter = new BinanceRateLimiter(this.redis.client);
    return createBinanceClient(
      {
        apiKeyId: k.id,
        apiKey: decryptSecret(k.apiKey, encSecret),
        apiSecret: decryptSecret(k.apiSecret, encSecret),
      },
      limiter,
    );
  }

  /**
   * Returns all non-zero balances enriched with FDUSD price + value, plus total
   * portfolio value in FDUSD.
   */
  async overview(userId: string, apiKeyId: string) {
    const client = await this.getClient(userId, apiKeyId);
    const acct = await client.getAccount();

    const nonZero = acct.balances.filter(
      (b) => Number(b.free) + Number(b.locked) > 0,
    );

    // Bulk-fetch tickers for all <asset>FDUSD pairs
    const pub = createPublicBinanceClient();
    const symbols = nonZero
      .filter((b) => b.asset !== FEE_FREE_QUOTE_ASSET)
      .map((b) => `${b.asset}${FEE_FREE_QUOTE_ASSET}`);

    const priceMap = new Map<string, string>();
    if (symbols.length > 0) {
      // Fetch ALL ticker prices in one shot (no symbols param = all). This is more
      // robust than passing a `symbols=[...]` array (Binance fails the whole batch
      // if any one symbol doesn't exist, e.g. staked tokens like LDBNB).
      try {
        const { request } = await import('undici');
        const r = await request(`${env.BINANCE_BASE_URL}/api/v3/ticker/price`);
        if (r.statusCode === 200) {
          const data = (await r.body.json()) as Array<{ symbol: string; price: string }>;
          for (const d of data) priceMap.set(d.symbol, d.price);
        }
      } catch (err) {
        log.warn('Ticker fetch failed', { err: String(err) });
      }
    }

    const balances: BalanceWithValue[] = [];
    let totalFdusd = new Decimal(0);

    for (const b of nonZero) {
      const total = new Decimal(b.free).plus(b.locked);
      let fdusdPrice: string | null = null;
      let fdusdValue = new Decimal(0);
      let tradeable = false;
      if (b.asset === FEE_FREE_QUOTE_ASSET) {
        fdusdPrice = '1';
        fdusdValue = total;
        tradeable = false; // can't trade FDUSD against itself
      } else {
        const symbol = `${b.asset}${FEE_FREE_QUOTE_ASSET}`;
        const p = priceMap.get(symbol);
        if (p) {
          fdusdPrice = p;
          fdusdValue = total.mul(p);
          tradeable = true;
        }
      }
      totalFdusd = totalFdusd.plus(fdusdValue);
      balances.push({
        asset: b.asset,
        free: b.free,
        locked: b.locked,
        total: total.toString(),
        fdusdPrice,
        fdusdValue: fdusdValue.toFixed(8),
        tradeable,
      });
    }

    // Sort by USD value desc (so FDUSD/biggest holdings first)
    balances.sort((a, b) => Number(b.fdusdValue) - Number(a.fdusdValue));

    return {
      apiKeyId,
      totalFdusdValue: totalFdusd.toFixed(2),
      assetCount: balances.length,
      tradeableCount: balances.filter((b) => b.tradeable).length,
      balances,
    };
  }

  /** Get the trading rules + current price for a specific symbol. */
  async symbolInfo(userId: string, apiKeyId: string, symbol: string) {
    await this.getClient(userId, apiKeyId); // permission check
    const pub = createPublicBinanceClient();
    const sym = symbol.toUpperCase();
    const [ex, ticker] = await Promise.all([
      pub.getExchangeInfo([sym]),
      pub.getTickerPrice(sym),
    ]);
    if (!ex.symbols.length) throw new NotFoundException(`Symbol ${sym} not found`);
    const filters = extractFilters(ex.symbols[0]!);
    return { symbol: sym, price: ticker.price, filters };
  }

  /**
   * Place a manual trade from the wallet UI.
   * Must be a LIMIT order (zero fees on FDUSD pairs).
   * Either `quantity` (base) OR `quoteAmount` (quote) must be provided.
   */
  async trade(userId: string, apiKeyId: string, dto: {
    symbol: string;
    side: 'BUY' | 'SELL';
    /** Limit price; if omitted, uses current ticker price (market-like). */
    price?: number;
    /** Quantity in base asset. */
    quantity?: number;
    /** Quantity in quote asset (mutually exclusive with `quantity`). */
    quoteAmount?: number;
  }) {
    if (!dto.quantity && !dto.quoteAmount) {
      throw new BadRequestException('Either quantity or quoteAmount must be provided');
    }
    const client = await this.getClient(userId, apiKeyId);
    const sym = dto.symbol.toUpperCase();
    const pub = createPublicBinanceClient();

    // Resolve filters and current price
    const [ex, ticker] = await Promise.all([
      pub.getExchangeInfo([sym]),
      pub.getTickerPrice(sym),
    ]);
    if (!ex.symbols.length) throw new NotFoundException(`Symbol ${sym} not found`);
    const filters = extractFilters(ex.symbols[0]!);

    const priceRaw = dto.price ? String(dto.price) : ticker.price;
    const price = roundToTickSize(priceRaw, filters.tickSize);

    // Compute quantity
    let qty: string;
    if (dto.quantity) {
      qty = roundToStepSize(String(dto.quantity), filters.stepSize);
    } else {
      qty = roundToStepSize(new Decimal(dto.quoteAmount!).div(price), filters.stepSize);
    }

    const v = validateOrder(filters, price, qty);
    if (!v.ok) throw new BadRequestException(`Order validation failed: ${v.reason}`);

    const cid = `orca-wallet-${randomUUID().slice(0, 8)}`;
    const res = await client.placeOrder({
      symbol: sym,
      side: dto.side,
      type: 'LIMIT',
      timeInForce: 'GTC',
      price,
      quantity: qty,
      newClientOrderId: cid,
    });

    log.info('Wallet trade placed', {
      userId, apiKeyId, symbol: sym, side: dto.side, price, qty,
      orderId: res.orderId,
    });
    return {
      orderId: res.orderId,
      clientOrderId: res.clientOrderId,
      symbol: res.symbol,
      side: res.side,
      price: res.price,
      origQty: res.origQty,
      executedQty: res.executedQty,
      status: res.status,
    };
  }

  /** Cancel a pending wallet trade by orderId. */
  async cancelTrade(userId: string, apiKeyId: string, symbol: string, orderId: number) {
    const client = await this.getClient(userId, apiKeyId);
    const r = await client.cancelOrder({ symbol: symbol.toUpperCase(), orderId });
    return r;
  }

  /** Open orders for this API key (for wallet trades + bot orders). */
  async openOrders(userId: string, apiKeyId: string, symbol?: string) {
    const client = await this.getClient(userId, apiKeyId);
    const orders = await client.getOpenOrders(symbol?.toUpperCase());
    return orders;
  }

  /** Recent trades for a specific symbol. */
  async recentTrades(userId: string, apiKeyId: string, symbol: string, limit = 50) {
    const client = await this.getClient(userId, apiKeyId);
    return client.getMyTrades({ symbol: symbol.toUpperCase(), limit: Math.min(500, limit) });
  }
}
