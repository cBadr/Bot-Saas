/**
 * Test utilities for strategy unit tests.
 *
 * Provides:
 *   - createMockCtx() — fake StrategyContext with in-memory state + emit log + mock Binance client
 *   - createMockClient() — configurable Binance client mock
 *
 * Strategies must work without ANY real I/O — only the contract methods are exercised.
 */

import type { StrategyContext } from '../base';

/** Persisted strategy state for the bot under test. */
export type StateStore = { current: unknown };

/** Recorded ctx.emit call. */
export interface EmitRecord {
  type: string;
  message: string;
  data?: Record<string, unknown>;
  ts: number;
}

/** Recorded order placement. */
export interface PlaceOrderRecord {
  symbol: string;
  side: 'BUY' | 'SELL';
  type: string;
  price: string;
  quantity: string;
  newClientOrderId?: string;
  timeInForce?: string;
}

/** Recorded order cancel. */
export interface CancelOrderRecord {
  symbol: string;
  orderId?: number;
  origClientOrderId?: string;
}

export interface MockClientHandle {
  /** Override per-symbol ticker price returned by getTickerPrice. */
  setTickerPrice(symbol: string, price: string): void;
  /** Set the response array returned by getOpenOrders. */
  setOpenOrders(orders: Array<{ orderId: number; clientOrderId: string }>): void;
  /** Toggle whether the next placeOrder call should reject. */
  setNextPlaceError(err: { code?: number; msg?: string } | null): void;
  /** All placeOrder calls observed (in order). */
  placedOrders: PlaceOrderRecord[];
  /** All cancelOrder calls observed (in order). */
  cancelledOrders: CancelOrderRecord[];
  /** Counter to assign sequential exchange order ids. */
  nextExchangeOrderId: number;
}

export interface MockCtx {
  ctx: StrategyContext;
  state: StateStore;
  emits: EmitRecord[];
  client: MockClientHandle;
}

const DEFAULT_FILTERS = {
  symbol: 'BTCFDUSD',
  baseAsset: 'BTC',
  quoteAsset: 'FDUSD',
  baseAssetPrecision: 8,
  quoteAssetPrecision: 2,
  tickSize: '0.01',
  stepSize: '0.00001',
  minQty: '0.00001',
  maxQty: '9000',
  minNotional: '5',
};

export function createMockCtx(overrides: {
  symbol?: string;
  filters?: Partial<typeof DEFAULT_FILTERS>;
  initialPrice?: string;
} = {}): MockCtx {
  const symbol = overrides.symbol ?? 'BTCFDUSD';
  const state: StateStore = { current: undefined };
  const emits: EmitRecord[] = [];
  const tickerPrices = new Map<string, string>();
  tickerPrices.set(symbol, overrides.initialPrice ?? '78000');

  let openOrders: Array<{ orderId: number; clientOrderId: string }> = [];
  let nextPlaceError: { code?: number; msg?: string } | null = null;

  const client: MockClientHandle = {
    setTickerPrice(s, p) { tickerPrices.set(s, p); },
    setOpenOrders(o) { openOrders = o; },
    setNextPlaceError(e) { nextPlaceError = e; },
    placedOrders: [],
    cancelledOrders: [],
    nextExchangeOrderId: 1000,
  };

  // Mock Binance client — only the methods strategies actually call.
  const mockBinanceClient: Record<string, unknown> = {
    getTickerPrice: async (s: string) => ({
      symbol: s,
      price: tickerPrices.get(s) ?? '78000',
    }),
    getAccount: async () => ({ balances: [] }),
    getOpenOrders: async () => openOrders,
    getOrder: async (params: { orderId?: number }) => {
      const found = openOrders.find((o) => o.orderId === params.orderId);
      if (found) {
        return {
          orderId: found.orderId,
          clientOrderId: found.clientOrderId,
          status: 'NEW',
          side: 'BUY',
          price: '0',
          origQty: '0',
          executedQty: '0',
          cummulativeQuoteQty: '0',
        };
      }
      // Simulate -2013 unknown order
      const err: Error & { response?: unknown } = new Error('Order does not exist');
      err.response = { data: { code: -2013, msg: 'Order does not exist' } };
      throw err;
    },
    placeOrder: async (params: PlaceOrderRecord) => {
      if (nextPlaceError) {
        const e = nextPlaceError;
        nextPlaceError = null;
        const err: Error & { response?: unknown } = new Error(e.msg ?? 'Mock error');
        err.response = { data: { code: e.code, msg: e.msg } };
        throw err;
      }
      client.placedOrders.push(params);
      const orderId = client.nextExchangeOrderId++;
      // Auto-add to open orders so reconcile sees it.
      openOrders.push({ orderId, clientOrderId: params.newClientOrderId ?? `cid-${orderId}` });
      return {
        orderId,
        clientOrderId: params.newClientOrderId,
        symbol: params.symbol,
        status: 'NEW',
        price: params.price,
        origQty: params.quantity,
        executedQty: '0',
      };
    },
    cancelOrder: async (params: CancelOrderRecord) => {
      client.cancelledOrders.push(params);
      openOrders = openOrders.filter((o) =>
        o.orderId !== params.orderId && o.clientOrderId !== params.origClientOrderId,
      );
      return { ok: true };
    },
    batchCancelOrders: async (sym: string, cids: string[]) => {
      const results = cids.map((cid) => {
        client.cancelledOrders.push({ symbol: sym, origClientOrderId: cid });
        openOrders = openOrders.filter((o) => o.clientOrderId !== cid);
        return { ok: true as const, value: {} };
      });
      return results;
    },
  };

  const ctx: StrategyContext = {
    botId: 'test-bot-' + Math.random().toString(36).slice(2, 10),
    symbol,
    filters: { ...DEFAULT_FILTERS, ...overrides.filters } as never,
    client: mockBinanceClient as never,
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    } as never,
    saveState: async (s: unknown) => { state.current = s; },
    loadState: async <T = unknown>() => state.current as T | undefined,
    emit: async (type: string, message: string, data?: Record<string, unknown>) => {
      emits.push({ type, message, data, ts: Date.now() });
    },
    cancelMyOrders: async () => {
      const cancelled = client.placedOrders.length;
      client.placedOrders = [];
      return cancelled;
    },
  };

  return { ctx, state, emits, client };
}

/** Find the most recent emit of a given type. */
export function lastEmit(emits: EmitRecord[], type: string): EmitRecord | undefined {
  for (let i = emits.length - 1; i >= 0; i--) {
    if (emits[i]!.type === type) return emits[i];
  }
  return undefined;
}

/** Count emits matching predicate. */
export function countEmits(emits: EmitRecord[], pred: (e: EmitRecord) => boolean): number {
  return emits.filter(pred).length;
}
