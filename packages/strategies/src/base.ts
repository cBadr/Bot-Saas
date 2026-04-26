import type { BinanceClient, SymbolFilters } from '@orca/exchange';
import type { OrcaLogger } from '@orca/logger';

export interface StrategyContext {
  botId: string;
  symbol: string;
  filters: SymbolFilters;
  client: BinanceClient;
  logger: OrcaLogger;
  /** Persist arbitrary state (resumable across restarts). */
  saveState: (state: unknown) => Promise<void>;
  /** Load previously saved state. */
  loadState: <T = unknown>() => Promise<T | undefined>;
  /** Emit a high-level event (logged + persisted to BotEvent table). */
  emit: (type: string, message: string, data?: Record<string, unknown>) => Promise<void>;
  /** Cancel ONLY the orders this bot placed (tracked via DB), not all symbol orders. */
  cancelMyOrders: () => Promise<number>;
}

export interface StrategyOrderEvent {
  clientOrderId: string;
  exchangeOrderId?: number;
  status: string;
  side: 'BUY' | 'SELL';
  price: string;
  origQty: string;
  executedQty: string;
  cumulativeQuote: string;
  symbol: string;
  meta?: Record<string, unknown>;
}

export interface Strategy<TParams = unknown> {
  /** Stable identifier matching Strategy.builtinKey in the DB. */
  readonly key: string;

  /** Validate user-supplied params; return parsed/typed params or throw. */
  validateParams(raw: unknown): TParams;

  /** Initialize: place initial orders, set up internal state. */
  init(ctx: StrategyContext, params: TParams): Promise<void>;

  /** Called whenever an order owned by this bot updates (filled/canceled). */
  onOrderUpdate(
    ctx: StrategyContext,
    params: TParams,
    event: StrategyOrderEvent,
  ): Promise<void>;

  /** Called periodically (e.g. every 5s) for housekeeping (price triggers, TP/SL). */
  onTick(ctx: StrategyContext, params: TParams, lastPrice: string): Promise<void>;

  /** Stop & cleanup: cancel open orders, persist final state. */
  stop(ctx: StrategyContext, params: TParams): Promise<void>;
}
