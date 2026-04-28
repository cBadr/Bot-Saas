import { randomUUID } from 'node:crypto';
import { Decimal, roundToTickSize, roundToStepSize } from '@orca/shared';
import { validateOrder } from '@orca/exchange';
import type { Strategy, StrategyContext, StrategyOrderEvent } from '../base';
import { DcaSimpleParamsSchema, type DcaSimpleParams } from './params';

/** A single ladder rung order. Same shape as Grid Simple's SimpleOrder. */
interface DcaOrder {
  /** pending | open | ignored_balance | post_only_rejected | min_notional | bad_price | bad_qty | error */
  status: string;
  /** 'BUY' for BUY-mode ladder, 'SELL' for SELL-mode ladder. */
  side: 'BUY' | 'SELL';
  price: string;
  quantity: string;
  /** Index in the ladder (1..gridLevels) for stable identity. */
  index: number;
  clientOrderId?: string;
  orderId?: number;
  lastError?: { code?: number; category?: string; msg?: string; ts: number };
}

/**
 * The single counter order (TP for BUY-mode, BB for SELL-mode) that closes
 * the current cycle. Re-priced via cancel-and-replace on every new fill.
 */
interface CounterOrder {
  status: 'open' | 'pending' | 'error';
  side: 'BUY' | 'SELL';
  price: string;
  quantity: string;
  type: 'LIMIT_MAKER' | 'LIMIT';
  clientOrderId?: string;
  orderId?: number;
}

interface DcaSimpleState {
  /** Captured ONCE at first init. Reference for Unrealized P&L per project spec. */
  initialStartPrice: string;
  /** Anchor price the CURRENT cycle's ladder was built around. Updated each cycle. */
  cycleAnchorPrice: string;
  /** The ladder of opening orders (descending BUYs in BUY-mode, ascending SELLs in SELL-mode). */
  ladder: DcaOrder[];
  /** The single TP/BB counter order that closes the cycle. */
  counter: CounterOrder | null;
  /**
   * Position tracking — interpretation depends on direction.
   *   BUY mode  → heldBase = accumulated inventory; openCostBasis = total cost spent.
   *   SELL mode → heldBase = cumulative SELL qty awaiting BB; openCostBasis = total proceeds received.
   * avgPrice = openCostBasis / heldBase (when heldBase > 0).
   */
  heldBase: string;
  openCostBasis: string;
  avgPrice: string;
  /** Number of opening fills in the current cycle (resets on TP/BB). */
  fillsThisCycle: number;
  /** Cumulative realized P&L since bot launch (sum across all cycles). */
  realizedPnlQuote: string;
  /** Number of fully-closed cycles (a cycle = ladder fills + counter close). */
  cyclesCompleted: number;
  /** Bot launch timestamp (ms). Used for durationMinutes auto-stop. */
  startedAtMs: number;
  /** Next reconcile timestamp (ms). */
  nextReconcileAtMs: number;
  /** Has the bot already auto-stopped via duration? */
  autoStopped: boolean;
  /** FIFO of clientOrderIds already processed for FILLED — dedup across WS/poller/reconcile. */
  processedFills: string[];
}

const RECONCILE_EVERY_MS = 60 * 1000;
const MAX_PROCESSED_FILLS = 1000;

// ─── Per-bot async mutex (same pattern as grid_simple) ───────────────────
const botLocks = new Map<string, Promise<unknown>>();
function withBotLock<T>(botId: string, fn: () => Promise<T>): Promise<T> {
  const prev = (botLocks.get(botId) ?? Promise.resolve()) as Promise<unknown>;
  const next = prev.then(fn, fn);
  botLocks.set(botId, next.catch(() => {}));
  return next;
}

// ─── Error classification (same shape as grid_simple) ────────────────────
type ErrorCategory =
  | 'INSUFFICIENT_BALANCE' | 'POST_ONLY_REJECTED' | 'MIN_NOTIONAL'
  | 'PRICE_FILTER' | 'LOT_SIZE' | 'PERCENT_PRICE' | 'FILTER_OTHER'
  | 'RATE_LIMIT' | 'TIMESTAMP' | 'NETWORK' | 'AUTH' | 'BAD_REQUEST'
  | 'DUPLICATE_ORDER' | 'UNKNOWN';

interface ClassifiedError {
  category: ErrorCategory;
  code?: number;
  msg: string;
  retryable: boolean;
  transientRetry: boolean;
  fatal: boolean;
  hint: string;
}

function classifyError(err: unknown): ClassifiedError {
  const e = err as {
    response?: { data?: { code?: number; msg?: string }; status?: number };
    message?: string; code?: string;
  };
  const httpStatus = e.response?.status;
  const code = e.response?.data?.code;
  const msg = e.response?.data?.msg ?? e.message ?? String(err);
  const sysCode = e.code;

  if (sysCode && /^(ECONN|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE|ESOCKETTIMEDOUT)/.test(sysCode)) {
    return { category: 'NETWORK', msg: `${sysCode}: ${msg}`, retryable: true, transientRetry: true, fatal: false,
      hint: 'Network blip — will retry automatically.' };
  }
  if (code === -1003 || httpStatus === 429 || httpStatus === 418) {
    return { category: 'RATE_LIMIT', code, msg, retryable: true, transientRetry: true, fatal: false,
      hint: 'Hit Binance rate limit — backing off.' };
  }
  if (code === -1021) {
    return { category: 'TIMESTAMP', code, msg, retryable: true, transientRetry: true, fatal: false,
      hint: 'Server time drift — will resync and retry.' };
  }
  if (code === -2014 || code === -2015 || code === -1022) {
    return { category: 'AUTH', code, msg, retryable: false, transientRetry: false, fatal: true,
      hint: 'API key invalid, expired, or missing required permissions.' };
  }
  if (code === -1100 || code === -1102 || code === -1106 || code === -1130) {
    return { category: 'BAD_REQUEST', code, msg, retryable: false, transientRetry: false, fatal: false,
      hint: 'Malformed order request — please report this bug.' };
  }
  if (code === -2010 || code === -2011) {
    if (/duplicate order/i.test(msg)) {
      return { category: 'DUPLICATE_ORDER', code, msg, retryable: false, transientRetry: false, fatal: false,
        hint: 'Duplicate clientOrderId — likely a race condition; reconcile will resync.' };
    }
    if (/immediately match/i.test(msg) || /post[- ]?only/i.test(msg)) {
      return { category: 'POST_ONLY_REJECTED', code, msg, retryable: true, transientRetry: false, fatal: false,
        hint: 'Order would cross the book. Wait for market drift.' };
    }
    if (/insufficient balance/i.test(msg)) {
      return { category: 'INSUFFICIENT_BALANCE', code, msg, retryable: true, transientRetry: false, fatal: false,
        hint: 'Not enough free balance — reconcile retries every minute.' };
    }
    return { category: 'UNKNOWN', code, msg, retryable: true, transientRetry: false, fatal: false,
      hint: 'Order rejected by exchange.' };
  }
  if (code === -1013) {
    if (/min[_ ]?notional/i.test(msg) || /notional/i.test(msg)) {
      return { category: 'MIN_NOTIONAL', code, msg, retryable: false, transientRetry: false, fatal: false,
        hint: 'orderSize too small for this price level. Increase orderSize.' };
    }
    if (/price[_ ]?filter/i.test(msg)) {
      return { category: 'PRICE_FILTER', code, msg, retryable: false, transientRetry: false, fatal: false,
        hint: 'Price violates tick rules.' };
    }
    if (/lot[_ ]?size/i.test(msg)) {
      return { category: 'LOT_SIZE', code, msg, retryable: false, transientRetry: false, fatal: false,
        hint: 'Quantity violates step rules.' };
    }
    if (/percent[_ ]?price/i.test(msg) || /price.*too.*(low|high)/i.test(msg)) {
      return { category: 'PERCENT_PRICE', code, msg, retryable: true, transientRetry: false, fatal: false,
        hint: 'Price too far from current market — will retry as market moves closer.' };
    }
    return { category: 'FILTER_OTHER', code, msg, retryable: true, transientRetry: true, fatal: false,
      hint: 'Filter rejection — will retry once.' };
  }
  return { category: 'UNKNOWN', code, msg, retryable: false, transientRetry: false, fatal: false, hint: '' };
}

function statusForCategory(cat: ErrorCategory): string {
  switch (cat) {
    case 'INSUFFICIENT_BALANCE': return 'ignored_balance';
    case 'POST_ONLY_REJECTED':   return 'post_only_rejected';
    case 'PERCENT_PRICE':        return 'price_too_far';
    case 'MIN_NOTIONAL':         return 'min_notional';
    case 'PRICE_FILTER':         return 'bad_price';
    case 'LOT_SIZE':             return 'bad_qty';
    default:                     return 'error';
  }
}

/**
 * DCA Simple — see params.ts for the model.
 */
export class DcaSimpleStrategy implements Strategy<DcaSimpleParams> {
  readonly key = 'dca_simple';

  validateParams(raw: unknown): DcaSimpleParams {
    return DcaSimpleParamsSchema.parse(raw);
  }

  private tag(ctx: StrategyContext): string {
    return ctx.botId.slice(0, 8);
  }

  // ═══ Public lifecycle ════════════════════════════════════════════════

  async init(ctx: StrategyContext, params: DcaSimpleParams): Promise<void> {
    return withBotLock(ctx.botId, () => this._initLocked(ctx, params));
  }

  async onOrderUpdate(ctx: StrategyContext, params: DcaSimpleParams, event: StrategyOrderEvent): Promise<void> {
    if (event.status !== 'FILLED') return;
    return withBotLock(ctx.botId, () => this._onFillLocked(ctx, params, event));
  }

  async onTick(ctx: StrategyContext, params: DcaSimpleParams, _lastPrice: string): Promise<void> {
    const peek = await ctx.loadState<DcaSimpleState>();
    if (!peek) return;
    const durationDue = params.durationMinutes > 0 && !peek.autoStopped &&
      Date.now() - peek.startedAtMs >= params.durationMinutes * 60_000;
    const reconcileDue = Date.now() >= peek.nextReconcileAtMs;
    if (!durationDue && !reconcileDue) return;

    return withBotLock(ctx.botId, async () => {
      const state = await ctx.loadState<DcaSimpleState>();
      if (!state) return;

      if (params.durationMinutes > 0 && !state.autoStopped &&
          Date.now() - state.startedAtMs >= params.durationMinutes * 60_000) {
        state.autoStopped = true;
        await ctx.saveState(state);
        await ctx.emit('DCA_DURATION_REACHED',
          `Duration ${params.durationMinutes}min elapsed — stopping bot`);
        await this.stop(ctx, params);
        return;
      }

      if (Date.now() >= state.nextReconcileAtMs) {
        state.nextReconcileAtMs = Date.now() + RECONCILE_EVERY_MS;
        await ctx.saveState(state);
        await this._reconcileLocked(ctx, params);
      }
    });
  }

  async stop(ctx: StrategyContext, _params: DcaSimpleParams): Promise<void> {
    try {
      await ctx.cancelMyOrders();
      await ctx.emit('DCA_STOPPED', 'Cancelled all bot orders');
    } catch (err) {
      ctx.logger.error('cancel-on-stop failed', { err: String(err) });
    }
    try { await ctx.saveState(null); } catch {}
  }

  // ═══ Init / state migration ══════════════════════════════════════════

  private async _initLocked(ctx: StrategyContext, params: DcaSimpleParams): Promise<void> {
    const existing = await ctx.loadState<DcaSimpleState>();
    if (existing) {
      this._migrateState(existing);
      ctx.logger.info('Resuming dca_simple from saved state', {
        ladder: existing.ladder.length,
        held: existing.heldBase,
        cycles: existing.cyclesCompleted,
        realized: existing.realizedPnlQuote,
      });
      await ctx.emit('DCA_RESUMED',
        `Resumed: ${existing.ladder.length} ladder · cycles=${existing.cyclesCompleted} · realized=${existing.realizedPnlQuote}`);
      existing.nextReconcileAtMs = Date.now(); // run integrity ASAP
      await ctx.saveState(existing);
      return;
    }

    // ─── Fresh start ───
    let startPrice: string;
    if (params.customStartPrice) {
      startPrice = roundToTickSize(String(params.customStartPrice), ctx.filters.tickSize);
    } else {
      const ticker = await ctx.client.getTickerPrice(ctx.symbol);
      startPrice = roundToTickSize(ticker.price, ctx.filters.tickSize);
    }

    const state: DcaSimpleState = {
      initialStartPrice: startPrice,
      cycleAnchorPrice: startPrice,
      ladder: [],
      counter: null,
      heldBase: '0',
      openCostBasis: '0',
      avgPrice: '0',
      fillsThisCycle: 0,
      realizedPnlQuote: '0',
      cyclesCompleted: 0,
      startedAtMs: Date.now(),
      nextReconcileAtMs: Date.now(),
      autoStopped: false,
      processedFills: [],
    };

    await this._buildLadder(ctx, params, state);
    await ctx.emit('DCA_INITIALIZED',
      `${params.direction} ladder · ${state.ladder.length} rungs · spread $${params.gridSpread} · TP $${params.takeProfit} · start ${startPrice}`,
      { direction: params.direction, gridLevels: params.gridLevels, gridSpread: params.gridSpread,
        takeProfit: params.takeProfit, startPrice });

    await ctx.saveState(state);
  }

  private _migrateState(s: DcaSimpleState): void {
    if (!Array.isArray(s.processedFills)) s.processedFills = [];
    if (!Array.isArray(s.ladder)) s.ladder = [];
    if (typeof s.realizedPnlQuote !== 'string') s.realizedPnlQuote = '0';
    if (typeof s.cyclesCompleted !== 'number') s.cyclesCompleted = 0;
    if (typeof s.heldBase !== 'string') s.heldBase = '0';
    if (typeof s.openCostBasis !== 'string') s.openCostBasis = '0';
    if (typeof s.avgPrice !== 'string') s.avgPrice = '0';
    if (typeof s.fillsThisCycle !== 'number') s.fillsThisCycle = 0;
  }

  // ═══ Ladder construction ═════════════════════════════════════════════

  /**
   * Builds the ladder around `state.cycleAnchorPrice`:
   *   BUY mode  → descending BUYs at  anchor − i*spread
   *   SELL mode → ascending  SELLs at anchor + i*spread
   * Then fires all in parallel (chunked to respect rate limits).
   */
  private async _buildLadder(ctx: StrategyContext, params: DcaSimpleParams, state: DcaSimpleState): Promise<void> {
    const anchor = new Decimal(state.cycleAnchorPrice);
    const spread = new Decimal(params.gridSpread);
    const ladderSide: 'BUY' | 'SELL' = params.direction;
    const orders: DcaOrder[] = [];

    for (let i = 1; i <= params.gridLevels; i++) {
      const offset = spread.mul(i);
      const rawPrice = ladderSide === 'BUY' ? anchor.minus(offset) : anchor.plus(offset);
      if (rawPrice.lte(0)) {
        ctx.logger.warn('Skipping ladder rung — price would be ≤0', { i, rawPrice: rawPrice.toString() });
        continue;
      }
      const price = roundToTickSize(rawPrice, ctx.filters.tickSize);
      const qty = roundToStepSize(new Decimal(params.orderSize).div(price), ctx.filters.stepSize);
      const v = validateOrder(ctx.filters, price, qty);
      if (!v.ok) {
        ctx.logger.warn(`Skipping invalid ${ladderSide} rung`, { i, price, qty, reason: v.reason });
        continue;
      }
      orders.push({ status: 'pending', side: ladderSide, price, quantity: qty, index: i });
    }

    state.ladder = orders;
    state.counter = null;
    state.fillsThisCycle = 0;
    state.heldBase = '0';
    state.openCostBasis = '0';
    state.avgPrice = '0';

    if (orders.length === 0) return;

    // Fire in parallel (chunked).
    const CHUNK = 25;
    const t0 = Date.now();
    for (let i = 0; i < orders.length; i += CHUNK) {
      await Promise.allSettled(orders.slice(i, i + CHUNK).map((o) => this._placeOrder(ctx, o)));
    }
    const placed = orders.filter((o) => o.status === 'open').length;
    ctx.logger.info('DCA ladder placed', {
      placed, total: orders.length, ms: Date.now() - t0,
    });
  }

  // ═══ Order placement (with retry classification) ═════════════════════

  private async _placeOrder(ctx: StrategyContext, order: DcaOrder, transientAttempts = 0): Promise<void> {
    const cid = `orca-${this.tag(ctx)}-d${order.side === 'BUY' ? 'b' : 's'}${order.index}-${randomUUID().slice(0, 6)}`;
    try {
      const res = await ctx.client.placeOrder({
        symbol: ctx.symbol,
        side: order.side,
        type: 'LIMIT_MAKER',
        price: order.price,
        quantity: order.quantity,
        newClientOrderId: cid,
      });
      order.clientOrderId = cid;
      order.orderId = res.orderId;
      order.status = 'open';
      delete order.lastError;
      void ctx.emit('DCA_ORDER_PLACED', `${order.side} #${order.index} @ ${order.price}`, {
        side: order.side, price: order.price, quantity: order.quantity,
        clientOrderId: cid, exchangeOrderId: res.orderId,
      });
    } catch (err) {
      const c = classifyError(err);
      if (c.fatal) {
        ctx.logger.error('Fatal DCA placement error', { errCategory: c.category, code: c.code, msg: c.msg });
        await ctx.emit('FATAL_API_ERROR', `Fatal [${c.category}]: ${c.msg}`, { category: c.category, code: c.code });
        throw err;
      }
      if (c.transientRetry && transientAttempts < 3) {
        const backoffMs = 250 * Math.pow(2, transientAttempts);
        await new Promise((r) => setTimeout(r, backoffMs));
        await this._placeOrder(ctx, order, transientAttempts + 1);
        return;
      }
      order.status = statusForCategory(c.category);
      order.lastError = { code: c.code, category: c.category, msg: c.msg, ts: Date.now() };
      ctx.logger.warn('DCA order placement failed', {
        side: order.side, index: order.index, price: order.price,
        errCategory: c.category, code: c.code, msg: c.msg,
      });
      void ctx.emit('ORDER_ERROR',
        `${order.side} @ ${order.price} → ${c.category}${c.code ? ` (${c.code})` : ''}: ${c.msg.slice(0, 120)}`,
        { side: order.side, price: order.price, quantity: order.quantity,
          errCategory: c.category, code: c.code, msg: c.msg, hint: c.hint, willRetry: true });
    }
  }

  /**
   * Place / replace the counter order (TP for BUY-mode, BB for SELL-mode).
   * Falls back to LIMIT GTC if LIMIT_MAKER would cross the book.
   */
  private async _placeCounter(
    ctx: StrategyContext, params: DcaSimpleParams, counter: CounterOrder,
  ): Promise<void> {
    const cid = `orca-${this.tag(ctx)}-${params.direction === 'BUY' ? 'tp' : 'bb'}-${randomUUID().slice(0, 6)}`;
    const tryPlace = async (type: 'LIMIT_MAKER' | 'LIMIT') => {
      return ctx.client.placeOrder({
        symbol: ctx.symbol,
        side: counter.side,
        type,
        ...(type === 'LIMIT' ? { timeInForce: 'GTC' } : {}),
        price: counter.price,
        quantity: counter.quantity,
        newClientOrderId: cid,
      });
    };
    try {
      const res = await tryPlace('LIMIT_MAKER');
      counter.clientOrderId = cid;
      counter.orderId = res.orderId;
      counter.status = 'open';
      counter.type = 'LIMIT_MAKER';
      void ctx.emit('DCA_COUNTER_PLACED',
        `${counter.side} ${params.direction === 'BUY' ? 'TP' : 'BB'} @ ${counter.price}`,
        { side: counter.side, price: counter.price, quantity: counter.quantity,
          clientOrderId: cid, exchangeOrderId: res.orderId, type: 'LIMIT_MAKER' });
    } catch (err) {
      const c = classifyError(err);
      if (c.category === 'POST_ONLY_REJECTED') {
        // Market is already past the TP/BB — fall back to LIMIT GTC.
        ctx.logger.info('Counter would cross — falling back to LIMIT GTC', {
          price: counter.price, side: counter.side,
        });
        try {
          const res = await tryPlace('LIMIT');
          counter.clientOrderId = cid;
          counter.orderId = res.orderId;
          counter.status = 'open';
          counter.type = 'LIMIT';
          void ctx.emit('DCA_COUNTER_PLACED',
            `${counter.side} ${params.direction === 'BUY' ? 'TP' : 'BB'} @ ${counter.price} (LIMIT fallback)`,
            { side: counter.side, price: counter.price, quantity: counter.quantity,
              clientOrderId: cid, exchangeOrderId: res.orderId, type: 'LIMIT' });
        } catch (e2) {
          counter.status = 'error';
          ctx.logger.error('Counter LIMIT fallback failed', { err: String(e2) });
        }
      } else {
        counter.status = 'error';
        ctx.logger.warn('Counter placement failed', {
          errCategory: c.category, code: c.code, msg: c.msg,
        });
      }
    }
  }

  // ═══ Fill handling ═══════════════════════════════════════════════════

  private async _onFillLocked(
    ctx: StrategyContext, params: DcaSimpleParams, event: StrategyOrderEvent,
  ): Promise<void> {
    const state = await ctx.loadState<DcaSimpleState>();
    if (!state) return;
    this._migrateState(state);

    // Idempotency
    if (state.processedFills.includes(event.clientOrderId)) {
      ctx.logger.debug('Skipping duplicate fill', { clientOrderId: event.clientOrderId });
      return;
    }

    // Identify which order this is: a ladder rung or the counter?
    const isCounter = state.counter && state.counter.clientOrderId === event.clientOrderId;
    const ladderIdx = state.ladder.findIndex((o) => o.clientOrderId === event.clientOrderId);

    if (!isCounter && ladderIdx === -1) {
      // Unknown order — mark processed and move on (could be a stale event).
      this._pushProcessed(state, event.clientOrderId);
      await ctx.saveState(state);
      return;
    }

    this._pushProcessed(state, event.clientOrderId);

    if (isCounter) {
      await this._handleCounterFill(ctx, params, state, event);
    } else {
      await this._handleLadderFill(ctx, params, state, event, ladderIdx);
    }

    await ctx.saveState(state);
  }

  /**
   * Ladder rung filled — opening leg. Update avg cost basis & re-arm the
   * counter at the new target price.
   */
  private async _handleLadderFill(
    ctx: StrategyContext, params: DcaSimpleParams, state: DcaSimpleState,
    event: StrategyOrderEvent, ladderIdx: number,
  ): Promise<void> {
    const filled = state.ladder.splice(ladderIdx, 1)[0]!;
    const fillPrice = new Decimal(event.price);
    const fillQty = new Decimal(event.executedQty);
    const fillQuote = fillPrice.mul(fillQty);

    // Update position (BUY-mode: cost basis; SELL-mode: proceeds).
    state.heldBase = new Decimal(state.heldBase).plus(fillQty).toString();
    state.openCostBasis = new Decimal(state.openCostBasis).plus(fillQuote).toString();
    const heldDecimal = new Decimal(state.heldBase);
    state.avgPrice = heldDecimal.gt(0)
      ? new Decimal(state.openCostBasis).div(heldDecimal).toString()
      : '0';
    state.fillsThisCycle += 1;

    await ctx.emit(`DCA_${filled.side}_FILLED`,
      `${filled.side} #${filled.index} @ ${event.price} → fills=${state.fillsThisCycle}, avg=${new Decimal(state.avgPrice).toFixed(8)}`,
      {
        price: event.price, quantity: event.executedQty,
        index: filled.index,
        avgPrice: state.avgPrice,
        heldBase: state.heldBase,
        fillsThisCycle: state.fillsThisCycle,
        isOpeningLeg: true,
      });

    // Re-arm the counter order at the new target price.
    await this._ensureCounter(ctx, params, state);
  }

  /**
   * Counter (TP/BB) filled — closing leg. Realize PnL, complete cycle,
   * cancel any remaining ladder orders, then build a fresh ladder around
   * the new market price.
   */
  private async _handleCounterFill(
    ctx: StrategyContext, params: DcaSimpleParams, state: DcaSimpleState,
    event: StrategyOrderEvent,
  ): Promise<void> {
    const fillPrice = new Decimal(event.price);
    const fillQty = new Decimal(event.executedQty);
    const avg = new Decimal(state.avgPrice);

    // Realized P&L per project spec:
    //   BUY-mode close (SELL fill):   (sellPrice − avgCost)     × qty
    //   SELL-mode close (BUY fill):   (avgSellPrice − buyPrice) × qty
    const cyclePnl = params.direction === 'BUY'
      ? fillPrice.minus(avg).mul(fillQty)
      : avg.minus(fillPrice).mul(fillQty);

    state.realizedPnlQuote = new Decimal(state.realizedPnlQuote).plus(cyclePnl).toString();
    state.cyclesCompleted += 1;
    state.counter = null;

    await ctx.emit(`DCA_${event.side}_FILLED`,
      `Counter ${event.side} @ ${event.price} → cycle #${state.cyclesCompleted} closed (PnL ${cyclePnl.toFixed(8)})`,
      {
        price: event.price, quantity: event.executedQty,
        cycleClosed: true,
        cyclePnl: cyclePnl.toString(),
        cyclesCompleted: state.cyclesCompleted,
        realizedPnlQuote: state.realizedPnlQuote,
        avgPrice: state.avgPrice,
      });

    // Cancel any remaining unfilled ladder orders (the ones below/above current
    // market that didn't get hit during this cycle).
    await this._cancelLadder(ctx, state);

    // Reset position and rebuild a fresh ladder around current market.
    state.heldBase = '0';
    state.openCostBasis = '0';
    state.avgPrice = '0';
    state.fillsThisCycle = 0;

    try {
      const ticker = await ctx.client.getTickerPrice(ctx.symbol);
      state.cycleAnchorPrice = roundToTickSize(ticker.price, ctx.filters.tickSize);
    } catch (err) {
      ctx.logger.warn('Failed to fetch ticker for cycle rebuild — using last fill price', { err: String(err) });
      state.cycleAnchorPrice = event.price;
    }

    await this._buildLadder(ctx, params, state);
    await ctx.emit('DCA_CYCLE_REBUILT',
      `Cycle #${state.cyclesCompleted + 1} ladder rebuilt around ${state.cycleAnchorPrice}`,
      { anchor: state.cycleAnchorPrice, ladderSize: state.ladder.length });
  }

  /**
   * Cancel-and-replace the counter order. Called after every ladder fill so
   * the counter always reflects the current avg cost basis.
   */
  private async _ensureCounter(
    ctx: StrategyContext, params: DcaSimpleParams, state: DcaSimpleState,
  ): Promise<void> {
    if (new Decimal(state.heldBase).lte(0)) return;

    const avg = new Decimal(state.avgPrice);
    const tp = new Decimal(params.takeProfit);
    const targetRaw = params.direction === 'BUY' ? avg.plus(tp) : avg.minus(tp);
    if (targetRaw.lte(0)) return;

    const targetPrice = roundToTickSize(targetRaw, ctx.filters.tickSize);
    const targetQty = roundToStepSize(state.heldBase, ctx.filters.stepSize);
    const v = validateOrder(ctx.filters, targetPrice, targetQty);
    if (!v.ok) {
      ctx.logger.warn('Counter validation failed — skipping this update', { reason: v.reason });
      return;
    }

    // If existing counter matches desired price+qty within tolerance, leave it.
    if (state.counter && state.counter.status === 'open') {
      const halfTick = new Decimal(ctx.filters.tickSize).div(2);
      const halfStep = new Decimal(ctx.filters.stepSize).div(2);
      if (
        new Decimal(state.counter.price).minus(targetPrice).abs().lte(halfTick) &&
        new Decimal(state.counter.quantity).minus(targetQty).abs().lte(halfStep)
      ) {
        return;
      }
      // Cancel the stale counter before placing a new one.
      try {
        if (state.counter.orderId) {
          await ctx.client.cancelOrder({ symbol: ctx.symbol, orderId: state.counter.orderId });
        }
      } catch (err) {
        const c = classifyError(err);
        if (c.code !== -2011 && c.code !== -2013) {
          ctx.logger.warn('Failed to cancel stale counter — proceeding anyway', { err: String(err) });
        }
      }
      state.counter = null;
    }

    const counter: CounterOrder = {
      status: 'pending',
      side: params.direction === 'BUY' ? 'SELL' : 'BUY',
      price: targetPrice,
      quantity: targetQty,
      type: 'LIMIT_MAKER',
    };
    await this._placeCounter(ctx, params, counter);
    state.counter = counter;
  }

  // ═══ Reconciliation (1-minute integrity loop) ════════════════════════

  private async _reconcileLocked(ctx: StrategyContext, params: DcaSimpleParams): Promise<void> {
    const state = await ctx.loadState<DcaSimpleState>();
    if (!state) return;
    this._migrateState(state);
    const t0 = Date.now();

    // Snapshot exchange's open orders for this bot's symbol.
    let exchangeOpen: Array<{ orderId: number; clientOrderId: string }> = [];
    try {
      const open = await ctx.client.getOpenOrders(ctx.symbol);
      exchangeOpen = open.map((o) => ({ orderId: o.orderId, clientOrderId: o.clientOrderId }));
    } catch (err) {
      ctx.logger.warn('integrity: getOpenOrders failed', { err: String(err) });
      await ctx.saveState(state);
      return;
    }
    const exOpenIds = new Set(exchangeOpen.map((o) => String(o.orderId)));

    // Pass 1: ladder rungs missing on exchange — query their final state.
    const ladderOpen = state.ladder.filter((o) => o.status === 'open' && o.orderId);
    for (const internal of ladderOpen) {
      if (exOpenIds.has(String(internal.orderId))) continue;
      try {
        const final = await ctx.client.getOrder({ symbol: ctx.symbol, orderId: internal.orderId! });
        if (final.status === 'FILLED') {
          ctx.logger.info('integrity: picking up missed ladder fill', { orderId: final.orderId });
          state.processedFills = state.processedFills.filter((c) => c !== final.clientOrderId);
          // Find the rung's current index (ladder may have been mutated since we started iterating).
          const idxNow = state.ladder.findIndex((o) => o.orderId === final.orderId);
          if (idxNow !== -1) {
            await this._handleLadderFill(ctx, params, state, {
              clientOrderId: final.clientOrderId,
              exchangeOrderId: final.orderId,
              status: 'FILLED',
              side: final.side as 'BUY' | 'SELL',
              price: final.price,
              origQty: final.executedQty,
              executedQty: final.executedQty,
              cumulativeQuote: '0',
              symbol: ctx.symbol,
            }, idxNow);
            this._pushProcessed(state, final.clientOrderId);
          }
        } else if (['CANCELED', 'EXPIRED', 'REJECTED'].includes(final.status)) {
          internal.status = 'pending';
          internal.orderId = undefined;
          internal.clientOrderId = undefined;
        }
      } catch (e) {
        const code = (e as { response?: { data?: { code?: number } } }).response?.data?.code;
        if (code === -2013) {
          internal.status = 'pending';
          internal.orderId = undefined;
          internal.clientOrderId = undefined;
        }
      }
    }

    // Pass 1b: counter missing on exchange.
    if (state.counter && state.counter.status === 'open' && state.counter.orderId &&
        !exOpenIds.has(String(state.counter.orderId))) {
      try {
        const final = await ctx.client.getOrder({ symbol: ctx.symbol, orderId: state.counter.orderId });
        if (final.status === 'FILLED') {
          ctx.logger.info('integrity: picking up missed counter fill', { orderId: final.orderId });
          state.processedFills = state.processedFills.filter((c) => c !== final.clientOrderId);
          await this._handleCounterFill(ctx, params, state, {
            clientOrderId: final.clientOrderId,
            exchangeOrderId: final.orderId,
            status: 'FILLED',
            side: final.side as 'BUY' | 'SELL',
            price: final.price,
            origQty: final.executedQty,
            executedQty: final.executedQty,
            cumulativeQuote: '0',
            symbol: ctx.symbol,
          });
          this._pushProcessed(state, final.clientOrderId);
        } else if (['CANCELED', 'EXPIRED', 'REJECTED'].includes(final.status)) {
          state.counter = null;
          await this._ensureCounter(ctx, params, state);
        }
      } catch {
        // If we can't query, leave it for next cycle.
      }
    }

    // Pass 2: retry any ladder rungs that aren't open.
    const toRetry = state.ladder.filter((o) => o.status !== 'open');
    if (toRetry.length > 0) {
      for (const o of toRetry) {
        o.status = 'pending';
        delete o.lastError;
        o.orderId = undefined;
        o.clientOrderId = undefined;
      }
      const CHUNK = 25;
      for (let i = 0; i < toRetry.length; i += CHUNK) {
        await Promise.allSettled(toRetry.slice(i, i + CHUNK).map((o) => this._placeOrder(ctx, o)));
      }
    }

    // Pass 3: ensure counter is up-to-date (may have drifted from avg).
    if (new Decimal(state.heldBase).gt(0)) {
      await this._ensureCounter(ctx, params, state);
    }

    const expected = state.ladder.length + (state.counter ? 1 : 0);
    const open = state.ladder.filter((o) => o.status === 'open').length
      + (state.counter && state.counter.status === 'open' ? 1 : 0);
    const ms = Date.now() - t0;
    if (open === expected) {
      ctx.logger.info(`integrity ✓ all ${expected} DCA orders open (${ms}ms)`);
      await ctx.emit('DCA_INTEGRITY_OK',
        `All ${expected} DCA orders are open on Binance`,
        { expected, open, ms });
    } else {
      ctx.logger.warn(`integrity ✗ ${open}/${expected} open — will retry next minute`);
      await ctx.emit('DCA_INTEGRITY_REPAIR',
        `${open}/${expected} DCA orders open — will retry next minute`,
        { expected, open, missing: expected - open, ms });
    }

    await ctx.saveState(state);
  }

  /** Cancel all of this bot's ladder orders (used on cycle rebuild). */
  private async _cancelLadder(ctx: StrategyContext, state: DcaSimpleState): Promise<void> {
    const toCancel = state.ladder.filter((o) => o.status === 'open' && o.orderId);
    if (toCancel.length === 0) return;
    const cids = toCancel.map((o) => o.clientOrderId!).filter(Boolean);
    try {
      await ctx.client.batchCancelOrders(ctx.symbol, cids, { concurrency: 20 });
    } catch (err) {
      ctx.logger.warn('Ladder cancel failed (proceeding anyway)', { err: String(err) });
    }
    state.ladder = [];
  }

  private _pushProcessed(state: DcaSimpleState, clientOrderId: string): void {
    if (!Array.isArray(state.processedFills)) state.processedFills = [];
    state.processedFills.push(clientOrderId);
    if (state.processedFills.length > MAX_PROCESSED_FILLS) {
      state.processedFills.splice(0, state.processedFills.length - MAX_PROCESSED_FILLS);
    }
  }
}

export const dcaSimpleStrategy = new DcaSimpleStrategy();
