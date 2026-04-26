import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Decimal } from '@orca/shared';
import type {
  BinanceAccountInfo,
  BinanceExchangeInfo,
  BinanceOpenOrder,
  BinanceOrderResponse,
  PlaceOrderParams,
} from '@orca/shared';
import type { BinanceClient as RealClient, UserDataEvent } from '@orca/exchange';
import { createPublicBinanceClient } from '@orca/exchange';
import { createLogger } from '@orca/logger';

const log = createLogger('BOT', { module: 'PaperClient' });

interface PaperOrder {
  symbol: string;
  orderId: number;
  clientOrderId: string;
  side: 'BUY' | 'SELL';
  type: 'LIMIT';
  price: string;
  origQty: string;
  executedQty: string;
  cummulativeQuoteQty: string;
  status: 'NEW' | 'FILLED' | 'CANCELED';
  transactTime: number;
  workingTime: number;
}

let nextOrderId = 1_000_000_000;

/**
 * Drop-in replacement for BinanceClient that simulates order execution
 * against the live market price (polled from Binance public API).
 *
 * Behavior:
 *  - Open BUY  fills when last price <= order price
 *  - Open SELL fills when last price >= order price
 *  - Emits executionReport events through `userStreamEmitter` so BotRunner
 *    receives them just like real Binance.
 *  - Tracks paper balances per asset.
 *  - Trading fees = 0 (matches FDUSD reality).
 */
export class PaperBinanceClient {
  private readonly publicClient = createPublicBinanceClient();
  private readonly orders = new Map<string, PaperOrder>(); // by clientOrderId
  private readonly balances = new Map<string, { free: Decimal; locked: Decimal }>();
  private readonly tickers = new Map<string, string>();
  private pollTimer?: NodeJS.Timeout;
  /** Subscribers receive simulated executionReport events. */
  readonly userStreamEmitter = new EventEmitter();

  constructor() {
    // Seed paper balances
    this.balances.set('FDUSD', { free: new Decimal(10_000), locked: new Decimal(0) });
    this.balances.set('USDT', { free: new Decimal(10_000), locked: new Decimal(0) });
  }

  startMarketPolling(symbols: string[], intervalMs = 3000) {
    if (this.pollTimer) return;
    const tick = async () => {
      for (const sym of symbols) {
        try {
          const t = await this.publicClient.getTickerPrice(sym);
          this.tickers.set(sym, t.price);
          this.matchOrders(sym, t.price);
        } catch (err) {
          log.warn('Ticker poll failed', { sym, err: String(err) });
        }
      }
    };
    void tick();
    this.pollTimer = setInterval(() => void tick(), intervalMs);
    if (this.pollTimer.unref) this.pollTimer.unref();
  }

  stop() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = undefined;
  }

  // ─── Public-equivalent passthroughs ──────────────────
  getServerTime() { return this.publicClient.getServerTime(); }
  getExchangeInfo(symbols?: string[]): Promise<BinanceExchangeInfo> {
    return this.publicClient.getExchangeInfo(symbols);
  }
  getTickerPrice(symbol: string) { return this.publicClient.getTickerPrice(symbol); }
  getKlines(p: Parameters<RealClient['getKlines']>[0]) { return this.publicClient.getKlines(p); }

  // ─── Account ─────────────────────────────────────────
  async getAccount(): Promise<BinanceAccountInfo> {
    return {
      makerCommission: 0,
      takerCommission: 0,
      canTrade: true,
      canWithdraw: false,
      canDeposit: false,
      updateTime: Date.now(),
      accountType: 'PAPER',
      balances: Array.from(this.balances.entries()).map(([asset, b]) => ({
        asset,
        free: b.free.toString(),
        locked: b.locked.toString(),
      })),
      permissions: ['SPOT'],
    };
  }

  async getOpenOrders(symbol?: string): Promise<BinanceOpenOrder[]> {
    const all = Array.from(this.orders.values()).filter((o) => o.status === 'NEW');
    const filtered = symbol ? all.filter((o) => o.symbol === symbol) : all;
    return filtered.map((o) => ({
      symbol: o.symbol,
      orderId: o.orderId,
      clientOrderId: o.clientOrderId,
      price: o.price,
      origQty: o.origQty,
      executedQty: o.executedQty,
      status: o.status,
      timeInForce: 'GTC',
      type: o.type,
      side: o.side,
      time: o.transactTime,
      updateTime: o.transactTime,
    }));
  }

  // ─── Order placement ─────────────────────────────────
  async placeOrder(params: PlaceOrderParams): Promise<BinanceOrderResponse> {
    const cid = params.newClientOrderId ?? `paper-${randomUUID().slice(0, 12)}`;
    const orderId = nextOrderId++;
    const order: PaperOrder = {
      symbol: params.symbol,
      orderId,
      clientOrderId: cid,
      side: params.side,
      type: 'LIMIT',
      price: params.price,
      origQty: params.quantity,
      executedQty: '0',
      cummulativeQuoteQty: '0',
      status: 'NEW',
      transactTime: Date.now(),
      workingTime: Date.now(),
    };
    this.orders.set(cid, order);
    this.lockFundsFor(order);
    log.debug('Paper order placed', { symbol: params.symbol, side: params.side, price: params.price, qty: params.quantity });

    // Fast-fill check vs current ticker
    const last = this.tickers.get(params.symbol);
    if (last) this.matchOrders(params.symbol, last);

    return {
      symbol: order.symbol,
      orderId: order.orderId,
      orderListId: -1,
      clientOrderId: order.clientOrderId,
      transactTime: order.transactTime,
      price: order.price,
      origQty: order.origQty,
      executedQty: order.executedQty,
      cummulativeQuoteQty: order.cummulativeQuoteQty,
      status: order.status,
      timeInForce: 'GTC',
      type: order.type,
      side: order.side,
      workingTime: order.workingTime,
    };
  }

  async cancelOrder(p: { symbol: string; origClientOrderId?: string; orderId?: number }): Promise<BinanceOrderResponse> {
    const order = p.origClientOrderId
      ? this.orders.get(p.origClientOrderId)
      : Array.from(this.orders.values()).find((o) => o.orderId === p.orderId);
    if (!order) throw new Error('Order not found');
    if (order.status === 'NEW') {
      order.status = 'CANCELED';
      this.unlockFundsFor(order);
      this.emitExecutionReport(order);
    }
    return this.toResponse(order);
  }

  async cancelAllOrders(symbol: string) {
    const open = Array.from(this.orders.values()).filter((o) => o.symbol === symbol && o.status === 'NEW');
    for (const o of open) {
      o.status = 'CANCELED';
      this.unlockFundsFor(o);
      this.emitExecutionReport(o);
    }
    return { canceled: open.length };
  }

  async getOrder(p: { symbol: string; origClientOrderId?: string; orderId?: number }): Promise<BinanceOrderResponse> {
    const order = p.origClientOrderId
      ? this.orders.get(p.origClientOrderId)
      : Array.from(this.orders.values()).find((o) => o.orderId === p.orderId);
    if (!order) throw new Error('Order not found');
    return this.toResponse(order);
  }

  async getMyTrades() { return []; }

  // User data stream — we emit executionReport events manually.
  async createListenKey() { return 'paper-listen-key'; }
  async keepAliveListenKey() { /* no-op */ }
  async closeListenKey() { /* no-op */ }

  // ─── Internal: match open orders against current price ─
  private matchOrders(symbol: string, lastPriceStr: string) {
    const lastPrice = new Decimal(lastPriceStr);
    for (const order of this.orders.values()) {
      if (order.symbol !== symbol || order.status !== 'NEW') continue;
      const orderPrice = new Decimal(order.price);
      const shouldFill =
        (order.side === 'BUY' && lastPrice.lte(orderPrice)) ||
        (order.side === 'SELL' && lastPrice.gte(orderPrice));
      if (shouldFill) {
        this.fillOrder(order);
      }
    }
  }

  private fillOrder(order: PaperOrder) {
    order.status = 'FILLED';
    order.executedQty = order.origQty;
    const quote = new Decimal(order.price).mul(order.origQty);
    order.cummulativeQuoteQty = quote.toFixed(8);
    order.transactTime = Date.now();
    this.applyFill(order);
    this.emitExecutionReport(order);
    log.info('Paper order filled', { symbol: order.symbol, side: order.side, price: order.price, qty: order.origQty });
  }

  private symbolAssets(symbol: string): { base: string; quote: string } {
    // Naive: assume symbol = BASE + QUOTE where QUOTE is one of common
    const quotes = ['FDUSD', 'USDT', 'USDC', 'BUSD', 'BTC', 'ETH', 'BNB'];
    for (const q of quotes) {
      if (symbol.endsWith(q)) return { base: symbol.slice(0, -q.length), quote: q };
    }
    return { base: symbol.slice(0, 3), quote: symbol.slice(3) };
  }

  private getOrInitBalance(asset: string) {
    let b = this.balances.get(asset);
    if (!b) { b = { free: new Decimal(0), locked: new Decimal(0) }; this.balances.set(asset, b); }
    return b;
  }

  private lockFundsFor(order: PaperOrder) {
    const { base, quote } = this.symbolAssets(order.symbol);
    if (order.side === 'BUY') {
      const cost = new Decimal(order.price).mul(order.origQty);
      const b = this.getOrInitBalance(quote);
      b.free = b.free.minus(cost);
      b.locked = b.locked.plus(cost);
    } else {
      const b = this.getOrInitBalance(base);
      b.free = b.free.minus(order.origQty);
      b.locked = b.locked.plus(order.origQty);
    }
  }

  private unlockFundsFor(order: PaperOrder) {
    const { base, quote } = this.symbolAssets(order.symbol);
    if (order.side === 'BUY') {
      const cost = new Decimal(order.price).mul(order.origQty);
      const b = this.getOrInitBalance(quote);
      b.locked = b.locked.minus(cost);
      b.free = b.free.plus(cost);
    } else {
      const b = this.getOrInitBalance(base);
      b.locked = b.locked.minus(order.origQty);
      b.free = b.free.plus(order.origQty);
    }
  }

  private applyFill(order: PaperOrder) {
    const { base, quote } = this.symbolAssets(order.symbol);
    const cost = new Decimal(order.price).mul(order.origQty);
    if (order.side === 'BUY') {
      const q = this.getOrInitBalance(quote);
      const b = this.getOrInitBalance(base);
      q.locked = q.locked.minus(cost);
      b.free = b.free.plus(order.origQty);
    } else {
      const q = this.getOrInitBalance(quote);
      const b = this.getOrInitBalance(base);
      b.locked = b.locked.minus(order.origQty);
      q.free = q.free.plus(cost);
    }
  }

  private emitExecutionReport(order: PaperOrder) {
    const event: UserDataEvent = {
      e: 'executionReport',
      s: order.symbol,
      c: order.clientOrderId,
      i: order.orderId,
      S: order.side,
      X: order.status,
      p: order.price,
      q: order.origQty,
      z: order.executedQty,
      Z: order.cummulativeQuoteQty,
      L: order.price,
      l: order.executedQty,
      t: order.status === 'FILLED' ? Date.now() : 0,
      n: '0',
      N: null,
      m: true,
      T: order.transactTime,
    };
    this.userStreamEmitter.emit('event', event);
  }

  private toResponse(order: PaperOrder): BinanceOrderResponse {
    return {
      symbol: order.symbol,
      orderId: order.orderId,
      orderListId: -1,
      clientOrderId: order.clientOrderId,
      transactTime: order.transactTime,
      price: order.price,
      origQty: order.origQty,
      executedQty: order.executedQty,
      cummulativeQuoteQty: order.cummulativeQuoteQty,
      status: order.status,
      timeInForce: 'GTC',
      type: order.type,
      side: order.side,
      workingTime: order.workingTime,
    };
  }
}
