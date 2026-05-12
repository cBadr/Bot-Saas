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

  /**
   * Cancel all open orders on this API key. By default, only "manual" wallet
   * orders are cancelled (clientOrderId starting with `orca-wallet`). Pass
   * `includeBots=true` to also cancel bot-placed orders — DANGEROUS: this
   * leaves the bot's internal state out of sync with Binance until the next
   * integrity reconcile (~60s), which will then re-place them.
   *
   * Optionally scope by `symbol` to limit the operation.
   */
  async cancelAllOpenOrders(userId: string, apiKeyId: string, opts: {
    symbol?: string;
    includeBots?: boolean;
  } = {}) {
    const client = await this.getClient(userId, apiKeyId);
    const open = await client.getOpenOrders(opts.symbol?.toUpperCase());
    if (open.length === 0) {
      return { cancelled: 0, skipped: 0, failed: 0, total: 0 };
    }

    type OpenOrder = (typeof open)[number];
    const matches: OpenOrder[] = [];
    let skipped = 0;
    for (const o of open) {
      const cid = (o as { clientOrderId?: string }).clientOrderId ?? '';
      const isManual = cid.startsWith('orca-wallet');
      const isBot = cid.startsWith('orca-') && !isManual;
      if (!opts.includeBots && isBot) { skipped++; continue; }
      matches.push(o);
    }
    if (matches.length === 0) {
      return { cancelled: 0, skipped, failed: 0, total: open.length };
    }

    // Group by symbol → batchCancelOrders supports per-symbol parallelism.
    const bySymbol = new Map<string, string[]>();
    for (const o of matches) {
      const cid = (o as { clientOrderId?: string }).clientOrderId;
      const sym = (o as { symbol: string }).symbol;
      if (!cid) continue;
      const arr = bySymbol.get(sym) ?? [];
      arr.push(cid);
      bySymbol.set(sym, arr);
    }
    let cancelled = 0, failed = 0;
    for (const [sym, cids] of bySymbol) {
      const results = await client.batchCancelOrders(sym, cids, { concurrency: 20 });
      for (const r of results) {
        if (r.ok) cancelled++;
        else {
          // Already filled/canceled errors are not real failures.
          const err = r.error as { response?: { data?: { code?: number } } };
          const code = err.response?.data?.code;
          if (code === -2011 || code === -2013) cancelled++;
          else failed++;
        }
      }
    }
    log.info('Wallet cancel-all', { userId, apiKeyId, cancelled, skipped, failed, total: open.length });
    return { cancelled, skipped, failed, total: open.length };
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

  // ─────────────────────────── Phase 2: portfolio analytics ───────────────────────────

  /** Portfolio overview enriched with 24h ticker stats per holding. */
  async overviewWithChanges(userId: string, apiKeyId: string) {
    const overview = await this.overview(userId, apiKeyId);
    const symbols = overview.balances
      .filter((b) => b.tradeable)
      .map((b) => `${b.asset}${FEE_FREE_QUOTE_ASSET}`);
    const changes24h = new Map<string, { changePct: number; change: number; high: number; low: number; volume: number }>();
    if (symbols.length > 0) {
      try {
        const { request } = await import('undici');
        // Binance lets us batch via ?symbols=["A","B"] (URL-encoded JSON array).
        const symbolsParam = encodeURIComponent(JSON.stringify(symbols));
        const r = await request(`${env.BINANCE_BASE_URL}/api/v3/ticker/24hr?symbols=${symbolsParam}`);
        if (r.statusCode === 200) {
          const data = (await r.body.json()) as Array<{
            symbol: string; priceChange: string; priceChangePercent: string;
            highPrice: string; lowPrice: string; volume: string;
          }>;
          for (const d of data) {
            changes24h.set(d.symbol, {
              changePct: Number(d.priceChangePercent),
              change: Number(d.priceChange),
              high: Number(d.highPrice),
              low: Number(d.lowPrice),
              volume: Number(d.volume),
            });
          }
        }
      } catch (err) { log.warn('24hr ticker fetch failed', { err: String(err) }); }
    }
    // Enrich balances with 24h change + compute portfolio 24h delta.
    let portfolioChange24h = 0;
    let portfolioValue24hAgo = 0;
    const enriched = overview.balances.map((b) => {
      const ch = b.tradeable ? changes24h.get(`${b.asset}${FEE_FREE_QUOTE_ASSET}`) ?? null : null;
      const valueNow = Number(b.fdusdValue);
      if (ch !== null && valueNow > 0) {
        const valueThen = valueNow / (1 + ch.changePct / 100);
        portfolioValue24hAgo += valueThen;
        portfolioChange24h += valueNow - valueThen;
      } else {
        portfolioValue24hAgo += valueNow;  // assume stable (FDUSD itself)
      }
      return { ...b, change24h: ch };
    });
    const portfolioChangePct24h = portfolioValue24hAgo > 0
      ? ((Number(overview.totalFdusdValue) - portfolioValue24hAgo) / portfolioValue24hAgo) * 100
      : 0;
    return {
      ...overview,
      balances: enriched,
      change24h: {
        absolute: portfolioChange24h,
        percentage: portfolioChangePct24h,
        valueAgo: portfolioValue24hAgo,
      },
    };
  }

  /** Deposit history from Binance (last 90 days). */
  async deposits(userId: string, apiKeyId: string) {
    const client = await this.getClient(userId, apiKeyId);
    const rows = await client.getDepositHistory({ limit: 500 });
    return rows.map((r) => ({
      coin: r.coin, network: r.network, amount: r.amount,
      status: r.status, address: r.address, addressTag: r.addressTag ?? null,
      txId: r.txId, insertTime: r.insertTime,
      walletType: r.walletType,
    }));
  }

  /** Withdrawal history from Binance (last 90 days). */
  async withdrawals(userId: string, apiKeyId: string) {
    const client = await this.getClient(userId, apiKeyId);
    const rows = await client.getWithdrawHistory({ limit: 500 });
    return rows.map((r) => ({
      coin: r.coin, network: r.network, amount: r.amount,
      transactionFee: r.transactionFee, status: r.status,
      address: r.address, addressTag: r.addressTag ?? null,
      txId: r.txId, applyTime: r.applyTime,
    }));
  }

  /** Convert dust balances (< 0.001 BTC equiv) to BNB. */
  async convertDust(userId: string, apiKeyId: string, assets: string[]) {
    if (!assets.length) throw new BadRequestException('Pass at least one asset');
    const client = await this.getClient(userId, apiKeyId);
    return client.convertDust(assets);
  }

  /**
   * Aggregate trade history across multiple symbols (held + recent).
   * Optional date filters; capped at ~1000 rows.
   */
  async allTrades(userId: string, apiKeyId: string, opts: {
    symbols?: string[]; from?: string; to?: string; limit?: number;
  } = {}) {
    const client = await this.getClient(userId, apiKeyId);
    let symbols = opts.symbols;
    if (!symbols || symbols.length === 0) {
      // Default: every held asset's <X>FDUSD pair, since that's where most trading happens.
      const overview = await this.overview(userId, apiKeyId);
      symbols = overview.balances
        .filter((b) => b.tradeable)
        .slice(0, 10) // cap to 10 symbols to bound the API calls
        .map((b) => `${b.asset}${FEE_FREE_QUOTE_ASSET}`);
    }
    const startTime = opts.from ? new Date(opts.from).getTime() : undefined;
    const limit = Math.min(1000, opts.limit ?? 500);
    const perSymbol = Math.max(50, Math.floor(limit / Math.max(1, symbols.length)));
    const all: Array<{
      symbol: string; id: number; orderId: number; price: string;
      qty: string; quoteQty: string; commission: string; commissionAsset: string;
      time: number; isBuyer: boolean; isMaker: boolean;
    }> = [];
    for (const sym of symbols) {
      try {
        const rows = await client.getMyTrades({
          symbol: sym,
          ...(startTime ? { startTime } : {}),
          limit: perSymbol,
        }) as never as typeof all;
        for (const r of rows) all.push({ ...r, symbol: sym });
      } catch (err) {
        log.warn('getMyTrades failed', { symbol: sym, err: String(err) });
      }
    }
    all.sort((a, b) => b.time - a.time);
    return all.slice(0, limit);
  }

  /** CSV-formatted trade export. */
  async exportTradesCsv(userId: string, apiKeyId: string, from?: string, to?: string): Promise<string> {
    const trades = await this.allTrades(userId, apiKeyId, { from, to, limit: 1000 });
    const header = ['time', 'symbol', 'side', 'price', 'qty', 'quoteQty', 'commission', 'commissionAsset', 'isMaker', 'orderId', 'tradeId'].join(',');
    const rows = trades.map((t) => [
      new Date(t.time).toISOString(),
      t.symbol,
      t.isBuyer ? 'BUY' : 'SELL',
      t.price, t.qty, t.quoteQty,
      t.commission, t.commissionAsset,
      t.isMaker ? '1' : '0',
      String(t.orderId), String(t.id),
    ].map(csvEscape).join(','));
    return [header, ...rows].join('\n');
  }

  /**
   * Per-asset cost-basis snapshot reconstructed from trade history:
   *   avgBuyPrice = Σ(buy_price × buy_qty) / Σ(buy_qty)
   *   currentValue, unrealized P&L, and rank.
   */
  async costBasis(userId: string, apiKeyId: string) {
    const overview = await this.overview(userId, apiKeyId);
    const tradeableBalances = overview.balances.filter((b) => b.tradeable && Number(b.total) > 0);

    const result: Array<{
      asset: string;
      symbol: string;
      heldQty: number;
      heldValue: number;
      avgBuyPrice: number | null;
      totalBuyQty: number;
      totalBuyCost: number;
      totalSellQty: number;
      totalSellProceeds: number;
      realizedPnl: number;
      unrealizedPnl: number | null;
      currentPrice: number;
    }> = [];

    const client = await this.getClient(userId, apiKeyId);
    for (const b of tradeableBalances) {
      const symbol = `${b.asset}${FEE_FREE_QUOTE_ASSET}`;
      try {
        const trades = await client.getMyTrades({ symbol, limit: 1000 }) as never as Array<{
          price: string; qty: string; quoteQty: string; commission: string;
          isBuyer: boolean;
        }>;
        let buyQty = 0, buyCost = 0, sellQty = 0, sellProceeds = 0;
        for (const t of trades) {
          const q = Number(t.qty);
          const cost = Number(t.quoteQty);
          if (t.isBuyer) { buyQty += q; buyCost += cost; }
          else { sellQty += q; sellProceeds += cost; }
        }
        const avgBuyPrice = buyQty > 0 ? buyCost / buyQty : null;
        const realizedPnl = sellProceeds - (avgBuyPrice ? avgBuyPrice * sellQty : 0);
        const heldQty = Number(b.total);
        const currentPrice = b.fdusdPrice ? Number(b.fdusdPrice) : 0;
        const unrealizedPnl = avgBuyPrice !== null && currentPrice > 0
          ? (currentPrice - avgBuyPrice) * heldQty
          : null;
        result.push({
          asset: b.asset, symbol,
          heldQty, heldValue: Number(b.fdusdValue),
          avgBuyPrice, totalBuyQty: buyQty, totalBuyCost: buyCost,
          totalSellQty: sellQty, totalSellProceeds: sellProceeds,
          realizedPnl, unrealizedPnl, currentPrice,
        });
      } catch (err) {
        log.warn('costBasis getMyTrades failed', { symbol, err: String(err) });
      }
    }
    return result.sort((a, b) => b.heldValue - a.heldValue);
  }

  // ─────────────────────────── Portfolio Snapshots ───────────────────────────

  /** Save a portfolio snapshot for the apiKey (manual or cron-triggered). */
  async snapshotNow(userId: string, apiKeyId: string) {
    const overview = await this.overview(userId, apiKeyId);
    const breakdown = overview.balances.map((b) => ({
      asset: b.asset, total: b.total, value: Number(b.fdusdValue),
    }));
    return this.prisma.portfolioSnapshot.create({
      data: {
        apiKeyId, userId,
        totalValueUsd: Number(overview.totalFdusdValue),
        assetCount: overview.assetCount,
        breakdown: breakdown as object,
      },
      select: { id: true, createdAt: true, totalValueUsd: true },
    });
  }

  /** Return up to `days` of recent snapshots, oldest first. */
  async snapshots(userId: string, apiKeyId: string, days = 30) {
    // Verify ownership.
    const k = await this.prisma.exchangeApiKey.findUnique({ where: { id: apiKeyId } });
    if (!k || k.userId !== userId) throw new ForbiddenException();
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await this.prisma.portfolioSnapshot.findMany({
      where: { apiKeyId, createdAt: { gte: since } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true, totalValueUsd: true, assetCount: true },
    });
    return rows.map((r) => ({
      ts: r.createdAt.getTime(),
      value: Number(r.totalValueUsd),
      assets: r.assetCount,
    }));
  }

  // ─────────────────────────── Price Alerts ───────────────────────────

  async listAlerts(userId: string) {
    return this.prisma.priceAlert.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createAlert(userId: string, input: {
    symbol: string; asset: string;
    direction: 'ABOVE' | 'BELOW'; threshold: number;
    note?: string;
  }) {
    return this.prisma.priceAlert.create({
      data: {
        userId,
        symbol: input.symbol.toUpperCase(),
        asset: input.asset.toUpperCase(),
        direction: input.direction,
        threshold: input.threshold,
        note: input.note,
      },
    });
  }

  async deleteAlert(userId: string, id: string) {
    const a = await this.prisma.priceAlert.findUnique({ where: { id } });
    if (!a || a.userId !== userId) throw new NotFoundException('Alert not found');
    await this.prisma.priceAlert.delete({ where: { id } });
    return { ok: true };
  }

  async toggleAlert(userId: string, id: string, enabled: boolean) {
    const a = await this.prisma.priceAlert.findUnique({ where: { id } });
    if (!a || a.userId !== userId) throw new NotFoundException('Alert not found');
    return this.prisma.priceAlert.update({
      where: { id },
      data: { enabled, ...(enabled ? { triggeredAt: null, triggeredPrice: null } : {}) },
    });
  }
}

function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}
