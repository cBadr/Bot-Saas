import { randomUUID } from 'node:crypto';
import { Decimal, roundToTickSize, roundToStepSize } from '@orca/shared';
import { validateOrder } from '@orca/exchange';
import type { Strategy, StrategyContext, StrategyOrderEvent } from '../base';
import { GridSimpleParamsSchema, type GridSimpleParams } from './params';

interface SimpleOrder {
  /**
   * pending | open | ignored_balance | post_only_rejected | price_too_far |
   * min_notional | bad_price | bad_qty | error
   */
  status: string;
  side: 'BUY' | 'SELL';
  price: string;
  quantity: string;
  clientOrderId?: string;
  orderId?: number;
  lastError?: { code?: number; category?: string; msg?: string; ts: number };
}

interface UnmatchedBuy {
  price: string;
  quantity: string;
}

interface GridSimpleState {
  /** The price the ladder centers on. Captured ONCE at first init. */
  initialStartPrice: string;
  /** Live order book maintained by the strategy. */
  orders: SimpleOrder[];
  /** Filled BUYs awaiting their counter-SELL. Used for floating PnL / avg cost. */
  unmatchedBuys: UnmatchedBuy[];
  /** Ms since epoch the bot first started — used for durationMinutes auto-stop. */
  startedAtMs: number;
  /** Next reconcile timestamp (ms). Strategy.onTick triggers reconcile when due. */
  nextReconcileAtMs: number;
  /** Has the bot already auto-stopped via duration? Prevents repeated stop()s. */
  autoStopped: boolean;
  /**
   * Bounded FIFO of clientOrderIds already processed for FILLED. Prevents
   * duplicate counter-order placement when the same fill arrives via WS,
   * OrderPoller, and reconcile (which all can observe the same event).
   */
  processedFills: string[];
}

const RECONCILE_EVERY_MS = 5 * 60 * 1000;
const MAX_PROCESSED_FILLS = 1000;

/**
 * Categorize a Binance / network error into a structured class so we can:
 *  - decide retry strategy (transient vs permanent)
 *  - aggregate similar errors into one human-readable summary
 *  - give the user an actionable hint
 */
type ErrorCategory =
  | 'INSUFFICIENT_BALANCE'  // -2010 with "insufficient balance"
  | 'POST_ONLY_REJECTED'    // -2010/-2011 with "would immediately match"
  | 'MIN_NOTIONAL'          // -1013 NOTIONAL filter — order value too small
  | 'PRICE_FILTER'          // -1013 PRICE_FILTER — tick rounding
  | 'LOT_SIZE'              // -1013 LOT_SIZE — step rounding
  | 'PERCENT_PRICE'         // -1013 PERCENT_PRICE_BY_SIDE — too far from market
  | 'FILTER_OTHER'          // -1013 other filter
  | 'RATE_LIMIT'            // -1003 / 429 / 418
  | 'TIMESTAMP'             // -1021 timestamp out of recv window
  | 'NETWORK'               // ECONNRESET, ETIMEDOUT, EAI_AGAIN, etc.
  | 'AUTH'                  // -2014/-2015/-1022
  | 'BAD_REQUEST'           // -1100/-1102/-1106/-1130 — programmer/data bug
  | 'DUPLICATE_ORDER'       // -2010 with "Duplicate order"
  | 'UNKNOWN';

interface ClassifiedError {
  category: ErrorCategory;
  code?: number;
  msg: string;
  /** Whether reconcile/init should retry this order with same params. */
  retryable: boolean;
  /** Whether we should immediately retry inside placeOrder (with backoff). */
  transientRetry: boolean;
  /** Whether the bot must stop. */
  fatal: boolean;
  /** Operator-facing actionable hint. */
  hint: string;
}

function classifyError(err: unknown): ClassifiedError {
  const e = err as {
    response?: { data?: { code?: number; msg?: string }; status?: number };
    message?: string;
    code?: string;
  };
  const httpStatus = e.response?.status;
  const code = e.response?.data?.code;
  const msg = e.response?.data?.msg ?? e.message ?? String(err);
  const sysCode = e.code; // Node syscall errors like ECONNRESET

  // Network / system errors
  if (sysCode && /^(ECONN|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE|ESOCKETTIMEDOUT)/.test(sysCode)) {
    return { category: 'NETWORK', msg: `${sysCode}: ${msg}`, retryable: true, transientRetry: true, fatal: false,
      hint: 'Network blip — will retry automatically.' };
  }

  // Rate limit
  if (code === -1003 || httpStatus === 429 || httpStatus === 418) {
    return { category: 'RATE_LIMIT', code, msg, retryable: true, transientRetry: true, fatal: false,
      hint: 'Hit Binance rate limit — backing off.' };
  }

  // Timestamp
  if (code === -1021) {
    return { category: 'TIMESTAMP', code, msg, retryable: true, transientRetry: true, fatal: false,
      hint: 'Server time drift — will resync and retry.' };
  }

  // Auth — fatal
  if (code === -2014 || code === -2015 || code === -1022) {
    return { category: 'AUTH', code, msg, retryable: false, transientRetry: false, fatal: true,
      hint: 'API key invalid, expired, or missing required permissions. Edit the key in Settings.' };
  }

  // Bad request — programmer / data bug, fatal
  if (code === -1100 || code === -1102 || code === -1106 || code === -1130) {
    return { category: 'BAD_REQUEST', code, msg, retryable: false, transientRetry: false, fatal: false,
      hint: 'Malformed order request — please report this bug.' };
  }

  // -2010 family — distinguish by message
  if (code === -2010 || code === -2011) {
    if (/duplicate order/i.test(msg)) {
      return { category: 'DUPLICATE_ORDER', code, msg, retryable: false, transientRetry: false, fatal: false,
        hint: 'Duplicate clientOrderId — likely a race condition; reconcile will resync.' };
    }
    if (/immediately match/i.test(msg) || /post[- ]?only/i.test(msg)) {
      return { category: 'POST_ONLY_REJECTED', code, msg, retryable: true, transientRetry: false, fatal: false,
        hint: 'Order price would cross the book. Widen gridSpread or wait for the market to drift.' };
    }
    if (/insufficient balance/i.test(msg)) {
      return { category: 'INSUFFICIENT_BALANCE', code, msg, retryable: true, transientRetry: false, fatal: false,
        hint: 'Not enough free balance. Reconcile retries every 5 minutes as funds free up.' };
    }
    // -2010 with other text → treat as transient unknown
    return { category: 'UNKNOWN', code, msg, retryable: true, transientRetry: false, fatal: false,
      hint: 'Order rejected by exchange. Check the message.' };
  }

  // Filter failures
  if (code === -1013) {
    if (/min[_ ]?notional/i.test(msg) || /notional/i.test(msg)) {
      return { category: 'MIN_NOTIONAL', code, msg, retryable: false, transientRetry: false, fatal: false,
        hint: 'orderSize too small for this price level. Increase orderSize.' };
    }
    if (/price[_ ]?filter/i.test(msg)) {
      return { category: 'PRICE_FILTER', code, msg, retryable: false, transientRetry: false, fatal: false,
        hint: 'Price violates tick rules — please report this bug.' };
    }
    if (/lot[_ ]?size/i.test(msg)) {
      return { category: 'LOT_SIZE', code, msg, retryable: false, transientRetry: false, fatal: false,
        hint: 'Quantity violates step rules — please report this bug.' };
    }
    if (/percent[_ ]?price/i.test(msg) || /price.*too.*(low|high)/i.test(msg)) {
      return { category: 'PERCENT_PRICE', code, msg, retryable: true, transientRetry: false, fatal: false,
        hint: 'Price too far from current market. Reconcile will retry as market moves closer.' };
    }
    return { category: 'FILTER_OTHER', code, msg, retryable: true, transientRetry: true, fatal: false,
      hint: 'Filter rejection — will retry once.' };
  }

  return { category: 'UNKNOWN', code, msg, retryable: false, transientRetry: false, fatal: false,
    hint: 'Unrecognized error — see message.' };
}

/** Map a category → status string stored on the SimpleOrder. */
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

/** Group an array of errors into `{ category: count, sample }` for one-shot reporting. */
function summarizeErrors(errors: ClassifiedError[]): Array<{
  category: ErrorCategory; count: number; code?: number; sampleMsg: string; hint: string;
}> {
  const groups = new Map<ErrorCategory, { count: number; code?: number; sample: ClassifiedError }>();
  for (const e of errors) {
    const g = groups.get(e.category);
    if (g) g.count++;
    else groups.set(e.category, { count: 1, code: e.code, sample: e });
  }
  return [...groups.entries()].map(([category, g]) => ({
    category, count: g.count, code: g.code, sampleMsg: g.sample.msg, hint: g.sample.hint,
  }));
}

/**
 * Per-bot async mutex to serialize ALL state mutations within a single
 * process. Prevents loadState→mutate→saveState races between concurrent
 * fill events, reconcile, and onTick. Keyed by botId because the strategy
 * is a singleton shared across bots.
 */
const botLocks = new Map<string, Promise<unknown>>();
function withBotLock<T>(botId: string, fn: () => Promise<T>): Promise<T> {
  const prev = (botLocks.get(botId) ?? Promise.resolve()) as Promise<unknown>;
  const next = prev.then(fn, fn);
  // Store the swallowed version so a rejection in one task doesn't break the chain.
  botLocks.set(botId, next.catch(() => {}));
  return next;
}

/**
 * GridSimple — see params.ts for the model.
 */
export class GridSimpleStrategy implements Strategy<GridSimpleParams> {
  readonly key = 'grid_simple';

  validateParams(raw: unknown): GridSimpleParams {
    return GridSimpleParamsSchema.parse(raw);
  }

  private fmt(v: Decimal | string | number): string {
    return new Decimal(v).toString();
  }

  /** clientOrderId tag — first segment of botId, used to filter our orders. */
  private tag(ctx: StrategyContext): string {
    return ctx.botId.slice(0, 8);
  }

  private async placeOrder(
    ctx: StrategyContext,
    order: SimpleOrder,
  ): Promise<void> {
    return this._placeOrderAttempt(ctx, order, 0);
  }

  /**
   * Try to place an order. Routes errors through `classifyError` and:
   *  - transient (network/rate-limit/timestamp) → exponential backoff retry up to 3x
   *  - post-only rejection → re-price 1 tick further from market, up to 2x
   *  - permanent (insufficient/min_notional/etc) → mark with category-specific status
   *  - fatal (auth) → throw to abort the bot
   *
   * All errors are surfaced both on `order.lastError` (for inspection) and as
   * BotEvents (for the activity log). Aggregate summaries are emitted by the
   * caller via `summarizeAndEmit` so 15 identical errors collapse into 1 event.
   */
  private async _placeOrderAttempt(
    ctx: StrategyContext,
    order: SimpleOrder,
    repriceAttempts = 0,
    transientAttempts = 0,
  ): Promise<void> {
    const cid = `orca-${this.tag(ctx)}-${order.side === 'BUY' ? 'b' : 's'}-${randomUUID().slice(0, 6)}`;
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
      void ctx.emit('ORDER_PLACED', `${order.side} @ ${order.price}`, {
        side: order.side, price: order.price, quantity: order.quantity,
        clientOrderId: cid, exchangeOrderId: res.orderId,
      });
    } catch (err) {
      const c = classifyError(err);

      // Fatal — auth. Bubble up so the runner marks the bot as ERROR.
      if (c.fatal) {
        ctx.logger.error('Fatal placement error', {
          errCategory: c.category, code: c.code, msg: c.msg, hint: c.hint,
        });
        await ctx.emit('FATAL_API_ERROR', `Fatal [${c.category}]: ${c.msg}`,
          { category: c.category, code: c.code, hint: c.hint });
        throw err;
      }

      // Transient — exponential backoff retry (max 3 attempts).
      if (c.transientRetry && transientAttempts < 3) {
        const backoffMs = 250 * Math.pow(2, transientAttempts);
        ctx.logger.warn(`Transient error [${c.category}], retrying in ${backoffMs}ms`, {
          attempt: transientAttempts + 1, errCategory: c.category, msg: c.msg,
        });
        await new Promise((r) => setTimeout(r, backoffMs));
        await this._placeOrderAttempt(ctx, order, repriceAttempts, transientAttempts + 1);
        return;
      }

      // Post-only rejection — try re-pricing 1 tick further from market (up to 2 attempts).
      if (c.category === 'POST_ONLY_REJECTED' && repriceAttempts < 2) {
        const tick = new Decimal(ctx.filters.tickSize);
        const adj = order.side === 'BUY'
          ? new Decimal(order.price).minus(tick)
          : new Decimal(order.price).plus(tick);
        if (adj.lte(0)) {
          order.status = 'post_only_rejected';
          order.lastError = { code: c.code, category: c.category, msg: c.msg, ts: Date.now() };
          return;
        }
        const newPrice = roundToTickSize(adj, ctx.filters.tickSize);
        ctx.logger.info('Post-only rejection — re-pricing 1 tick away', {
          side: order.side, oldPrice: order.price, newPrice, attempt: repriceAttempts + 1,
        });
        order.price = newPrice;
        await this._placeOrderAttempt(ctx, order, repriceAttempts + 1, transientAttempts);
        return;
      }

      // Permanent / will-be-retried-by-reconcile — mark status & store error.
      order.status = statusForCategory(c.category);
      order.lastError = { code: c.code, category: c.category, msg: c.msg, ts: Date.now() };
      ctx.logger.warn('Order placement failed', {
        side: order.side, price: order.price, errCategory: c.category,
        code: c.code, msg: c.msg, hint: c.hint,
      });
      // Per-order detailed event so the user can drill into each individual
      // failure in the bot's activity log (separate from the aggregate summary).
      void ctx.emit('ORDER_ERROR',
        `${order.side} @ ${order.price} → ${c.category}${c.code ? ` (${c.code})` : ''}: ${c.msg.slice(0, 120)}`,
        {
          side: order.side, price: order.price, quantity: order.quantity,
          attemptedClientOrderId: cid,
          errCategory: c.category, code: c.code, msg: c.msg, hint: c.hint,
          attempts: { reprice: repriceAttempts, transient: transientAttempts },
          status: order.status,
          willRetry: order.status === 'ignored_balance' || order.status === 'post_only_rejected' || order.status === 'price_too_far',
        });
    }
  }

  /**
   * After a batch placement, group errors by category and emit ONE summary
   * event per category — so 15 "INSUFFICIENT_BALANCE" rejections become a
   * single "GRID_PLACEMENT_ERRORS" event the user can read at a glance.
   */
  private async summarizeAndEmit(
    ctx: StrategyContext,
    orders: SimpleOrder[],
    phase: 'init' | 'reconcile' | 'counter',
  ): Promise<void> {
    const errors: ClassifiedError[] = orders
      .filter((o) => o.lastError && o.status !== 'open')
      .map((o) => ({
        category: (o.lastError?.category as ErrorCategory) ?? 'UNKNOWN',
        code: o.lastError?.code,
        msg: o.lastError?.msg ?? 'unknown',
        retryable: o.status === 'ignored_balance' || o.status === 'post_only_rejected' || o.status === 'price_too_far',
        transientRetry: false,
        fatal: false,
        hint: '',
      }));
    if (errors.length === 0) return;
    const summary = summarizeErrors(errors);
    const lines = summary.map((s) =>
      `${s.count}× ${s.category}${s.code ? ` (${s.code})` : ''}: ${s.sampleMsg.slice(0, 120)}`,
    );
    const headline = `Phase=${phase}: ${errors.length} order(s) had errors across ${summary.length} categor${summary.length === 1 ? 'y' : 'ies'}`;
    await ctx.emit('GRID_PLACEMENT_ERRORS', `${headline} — ${lines.join(' | ')}`, {
      phase,
      total: errors.length,
      summary,
    });
  }

  async init(ctx: StrategyContext, params: GridSimpleParams): Promise<void> {
    return withBotLock(ctx.botId, () => this._initLocked(ctx, params));
  }

  private async _initLocked(ctx: StrategyContext, params: GridSimpleParams): Promise<void> {
    const existing = await ctx.loadState<GridSimpleState>();
    if (existing) {
      // Defensive: older saved states may lack processedFills.
      if (!Array.isArray(existing.processedFills)) existing.processedFills = [];
      ctx.logger.info('Resuming grid_simple from saved state', {
        orders: existing.orders.length,
        startPrice: existing.initialStartPrice,
      });
      await ctx.emit('GRID_RESUMED',
        `Resumed grid with ${existing.orders.length} orders @ start ${existing.initialStartPrice}`);
      // Run a reconcile shortly after resume to catch missed fills.
      existing.nextReconcileAtMs = Date.now() + 15_000;
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

    const orders: SimpleOrder[] = [];
    for (let i = 1; i <= params.gridLevels; i++) {
      const offset = new Decimal(params.gridSpread).mul(i);
      const buyPrice = roundToTickSize(new Decimal(startPrice).minus(offset), ctx.filters.tickSize);
      const sellPrice = roundToTickSize(new Decimal(startPrice).plus(offset), ctx.filters.tickSize);

      const buyQty = roundToStepSize(
        new Decimal(params.orderSize).div(buyPrice), ctx.filters.stepSize,
      );
      const sellQty = roundToStepSize(
        new Decimal(params.orderSize).div(sellPrice), ctx.filters.stepSize,
      );

      const buyValid = validateOrder(ctx.filters, buyPrice, buyQty);
      const sellValid = validateOrder(ctx.filters, sellPrice, sellQty);

      if (buyValid.ok && new Decimal(buyPrice).gt(0)) {
        orders.push({ status: 'pending', side: 'BUY', price: buyPrice, quantity: buyQty });
      } else {
        ctx.logger.warn('Skipping invalid BUY level', {
          price: buyPrice, qty: buyQty,
          reason: buyValid.ok ? 'price_le_0' : buyValid.reason,
        });
      }
      if (sellValid.ok) {
        orders.push({ status: 'pending', side: 'SELL', price: sellPrice, quantity: sellQty });
      } else {
        ctx.logger.warn('Skipping invalid SELL level', { price: sellPrice, qty: sellQty, reason: sellValid.reason });
      }
    }

    await ctx.emit('GRID_INITIALIZED',
      `Built symmetric ladder: ${orders.length} orders, spread=$${params.gridSpread}, start=${startPrice}`,
      { startPrice, gridLevels: params.gridLevels, spread: params.gridSpread, totalOrders: orders.length });

    // ─── Fire all orders in parallel ───
    // Spot has no native batch order endpoint (only Futures does). Best we can
    // do is concurrent HTTP. Concurrency capped at 25 to stay well under
    // Binance's default 50 orders/10s/symbol limit while leaving headroom for
    // counter orders + reconcile activity.
    const CHUNK_SIZE = 25;
    const t0 = Date.now();
    for (let i = 0; i < orders.length; i += CHUNK_SIZE) {
      const chunk = orders.slice(i, i + CHUNK_SIZE);
      await Promise.allSettled(chunk.map((o) => this.placeOrder(ctx, o)));
    }
    const breakdown: Record<string, number> = {};
    for (const o of orders) breakdown[o.status] = (breakdown[o.status] ?? 0) + 1;
    const placed = breakdown['open'] ?? 0;
    ctx.logger.info('Initial grid placed', {
      total: orders.length, placed, breakdown, ms: Date.now() - t0,
    });
    const breakdownStr = Object.entries(breakdown)
      .map(([k, v]) => `${k}=${v}`).join(', ');
    await ctx.emit('GRID_PLACEMENT_DONE',
      `Placed ${placed}/${orders.length} in ${Date.now() - t0}ms (${breakdownStr})`,
      { placed, total: orders.length, breakdown });
    // Emit per-category error summary so the user sees exactly what went wrong.
    await this.summarizeAndEmit(ctx, orders, 'init');

    const state: GridSimpleState = {
      initialStartPrice: startPrice,
      orders,
      unmatchedBuys: [],
      startedAtMs: Date.now(),
      nextReconcileAtMs: Date.now() + RECONCILE_EVERY_MS,
      autoStopped: false,
      processedFills: [],
    };
    await ctx.saveState(state);
  }

  async onOrderUpdate(
    ctx: StrategyContext,
    params: GridSimpleParams,
    event: StrategyOrderEvent,
  ): Promise<void> {
    if (event.status !== 'FILLED') return;
    return withBotLock(ctx.botId, () => this._onFillLocked(ctx, params, event));
  }

  private async _onFillLocked(
    ctx: StrategyContext,
    params: GridSimpleParams,
    event: StrategyOrderEvent,
  ): Promise<void> {
    const state = await ctx.loadState<GridSimpleState>();
    if (!state) return;
    if (!Array.isArray(state.processedFills)) state.processedFills = [];
    const handled = await this._handleFill(ctx, params, state, event);
    if (handled) await ctx.saveState(state);
  }

  /**
   * Pure mutation: process one FILLED event against the given state object.
   * Caller owns persistence. Returns true if state was actually mutated.
   * Idempotent: duplicate events for the same clientOrderId become no-ops.
   */
  private async _handleFill(
    ctx: StrategyContext,
    params: GridSimpleParams,
    state: GridSimpleState,
    event: StrategyOrderEvent,
  ): Promise<boolean> {
    if (!Array.isArray(state.processedFills)) state.processedFills = [];

    if (state.processedFills.includes(event.clientOrderId)) {
      ctx.logger.debug('Skipping duplicate fill', { clientOrderId: event.clientOrderId });
      return false;
    }

    const idx = state.orders.findIndex((o) => o.clientOrderId === event.clientOrderId);
    if (idx === -1) {
      // Mark processed so reconcile / poller don't keep re-firing it forever.
      this._pushProcessed(state, event.clientOrderId);
      return true;
    }

    const filled = state.orders.splice(idx, 1)[0]!;
    // Mark processed BEFORE placing counter so even if placeOrder throws,
    // the next duplicate event won't re-place the counter.
    this._pushProcessed(state, event.clientOrderId);
    const filledQty = event.executedQty;

    let counter: SimpleOrder | undefined;
    if (filled.side === 'BUY') {
      // Counter SELL one spread above
      const sellPrice = roundToTickSize(
        new Decimal(filled.price).plus(params.gridSpread), ctx.filters.tickSize,
      );
      const sellQty = roundToStepSize(filledQty, ctx.filters.stepSize);
      counter = { status: 'pending', side: 'SELL', price: sellPrice, quantity: sellQty };
      state.unmatchedBuys.push({ price: filled.price, quantity: filledQty });
      await ctx.emit('BUY_FILLED',
        `BUY filled @ ${filled.price} → placing SELL @ ${sellPrice}`,
        { price: filled.price, quantity: filledQty, counterPrice: sellPrice });
    } else {
      // Counter BUY one spread below
      const buyPrice = roundToTickSize(
        new Decimal(filled.price).minus(params.gridSpread), ctx.filters.tickSize,
      );
      if (new Decimal(buyPrice).lte(0)) {
        ctx.logger.warn('Counter BUY price would be ≤0, skipping', { sellPrice: filled.price });
      } else {
        const buyQty = roundToStepSize(
          new Decimal(params.orderSize).div(buyPrice), ctx.filters.stepSize,
        );
        counter = { status: 'pending', side: 'BUY', price: buyPrice, quantity: buyQty };
      }
      // Match against an unmatched buy at (price - spread) to realize PnL
      const matchPrice = new Decimal(filled.price).minus(params.gridSpread);
      const halfTick = new Decimal(ctx.filters.tickSize).div(2);
      const mIdx = state.unmatchedBuys.findIndex(
        (b) => new Decimal(b.price).minus(matchPrice).abs().lte(halfTick),
      );
      let pnl = '0';
      if (mIdx > -1) {
        const matched = state.unmatchedBuys.splice(mIdx, 1)[0]!;
        pnl = new Decimal(filled.price).minus(matched.price).mul(filledQty).toString();
      }
      await ctx.emit('SELL_FILLED',
        `SELL filled @ ${filled.price} (PnL ${pnl})`,
        { price: filled.price, quantity: filledQty, pnl, counterPrice: counter?.price });
    }

    if (counter) {
      state.orders.push(counter);
      await this.placeOrder(ctx, counter);
      // If counter placement failed, surface it as a single-order summary event.
      if (counter.status !== 'open' && counter.lastError) {
        await ctx.emit('COUNTER_ORDER_FAILED',
          `Counter ${counter.side} @ ${counter.price} failed: ${counter.lastError.category ?? 'UNKNOWN'} — ${(counter.lastError.msg ?? '').slice(0, 120)}`,
          {
            side: counter.side, price: counter.price, quantity: counter.quantity,
            category: counter.lastError.category, code: counter.lastError.code, msg: counter.lastError.msg,
          });
      }
    }
    return true;
  }

  private _pushProcessed(state: GridSimpleState, clientOrderId: string): void {
    state.processedFills.push(clientOrderId);
    if (state.processedFills.length > MAX_PROCESSED_FILLS) {
      state.processedFills.splice(0, state.processedFills.length - MAX_PROCESSED_FILLS);
    }
  }

  async onTick(ctx: StrategyContext, params: GridSimpleParams, _lastPrice: string): Promise<void> {
    // Quick check first (no lock) so the tick stays cheap when nothing is due.
    const peek = await ctx.loadState<GridSimpleState>();
    if (!peek) return;
    const durationDue = params.durationMinutes > 0 && !peek.autoStopped &&
      Date.now() - peek.startedAtMs >= params.durationMinutes * 60_000;
    const reconcileDue = Date.now() >= peek.nextReconcileAtMs;
    if (!durationDue && !reconcileDue) return;

    return withBotLock(ctx.botId, async () => {
      const state = await ctx.loadState<GridSimpleState>();
      if (!state) return;

      // Duration auto-stop
      if (params.durationMinutes > 0 && !state.autoStopped &&
          Date.now() - state.startedAtMs >= params.durationMinutes * 60_000) {
        state.autoStopped = true;
        await ctx.saveState(state);
        await ctx.emit('GRID_DURATION_REACHED',
          `Duration ${params.durationMinutes}min elapsed — stopping bot`);
        await this.stop(ctx, params);
        return;
      }

      // Reconcile
      if (Date.now() >= state.nextReconcileAtMs) {
        state.nextReconcileAtMs = Date.now() + RECONCILE_EVERY_MS;
        await ctx.saveState(state); // commit cadence timestamp before slow work
        await this._reconcileLocked(ctx, params);
      }
    });
  }

  /**
   * Periodic safety net:
   *   1. Retry any orders skipped due to insufficient balance.
   *   2. Compare our internal `open` orders to Binance's reality:
   *      - Missing on exchange & FILLED → synthesize fill event so PnL/counter happen.
   *      - Missing & CANCELED/EXPIRED/REJECTED → re-place.
   *      - Genuinely missing (-2013 unknown order) → re-place.
   */
  /**
   * MUST be called inside withBotLock. Operates on the live state and saves
   * once at the end. Routes any missed fills through `_handleFill` directly
   * (no re-locking, no nested onOrderUpdate).
   */
  private async _reconcileLocked(ctx: StrategyContext, params: GridSimpleParams): Promise<void> {
    const state = await ctx.loadState<GridSimpleState>();
    if (!state) return;
    if (!Array.isArray(state.processedFills)) state.processedFills = [];

    // 1) Retry orders that previously failed for retryable reasons.
    //    The market may have moved or balance may have freed up since.
    const RETRY_STATUSES = ['ignored_balance', 'post_only_rejected', 'price_too_far'];
    const retryable = state.orders.filter((o) => RETRY_STATUSES.includes(o.status));
    if (retryable.length > 0) {
      const byStatus: Record<string, number> = {};
      for (const o of retryable) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
      ctx.logger.info(`Retrying ${retryable.length} skipped orders`, byStatus);
      for (const o of retryable) {
        o.status = 'pending';
        delete o.lastError;
      }
      const CHUNK = 25;
      for (let i = 0; i < retryable.length; i += CHUNK) {
        await Promise.allSettled(retryable.slice(i, i + CHUNK).map((o) => this.placeOrder(ctx, o)));
      }
      const recovered = retryable.filter((o) => o.status === 'open').length;
      const stillBad = retryable.length - recovered;
      await ctx.emit('GRID_RECONCILE_RETRY',
        `Reconcile retry: ${recovered}/${retryable.length} recovered (${stillBad} still skipped)`,
        { recovered, stillBad, total: retryable.length });
      if (stillBad > 0) await this.summarizeAndEmit(ctx, retryable, 'reconcile');
    }

    // 2) Reconcile vs exchange
    let exchangeOpen: { orderId: number; clientOrderId: string }[] = [];
    try {
      const open = await ctx.client.getOpenOrders(ctx.symbol);
      exchangeOpen = open.map((o) => ({ orderId: o.orderId, clientOrderId: o.clientOrderId }));
    } catch (err) {
      ctx.logger.warn('reconcile: getOpenOrders failed', { err: String(err) });
      await ctx.saveState(state);
      return;
    }
    const exOpenIds = new Set(exchangeOpen.map((o) => String(o.orderId)));

    const ourOpen = state.orders.filter((o) => o.status === 'open' && o.orderId);
    for (const internal of ourOpen) {
      if (exOpenIds.has(String(internal.orderId))) continue;
      // Order is in our state as "open" but exchange doesn't show it.
      type FinalOrder = {
        status: string; side: 'BUY' | 'SELL'; orderId: number;
        clientOrderId: string; executedQty: string; price: string;
      };
      let final: FinalOrder | undefined;
      try {
        const res = await ctx.client.getOrder({ symbol: ctx.symbol, orderId: internal.orderId! });
        final = res as unknown as FinalOrder;
      } catch (e) {
        const code = (e as { response?: { data?: { code?: number } } }).response?.data?.code;
        if (code === -2013) {
          // Order never made it onto the exchange — re-place.
          internal.status = 'pending';
          internal.orderId = undefined;
          internal.clientOrderId = undefined;
          await this.placeOrder(ctx, internal);
          continue;
        }
        ctx.logger.warn('reconcile: getOrder failed', { orderId: internal.orderId, err: String(e) });
        continue;
      }
      if (!final) continue;

      if (final.status === 'FILLED') {
        ctx.logger.info('reconcile: picking up missed fill', { orderId: final.orderId });
        // Use _handleFill directly so we mutate the SAME state object
        // and the single saveState at the end persists everything atomically.
        await this._handleFill(ctx, params, state, {
          clientOrderId: final.clientOrderId,
          exchangeOrderId: final.orderId,
          status: 'FILLED',
          side: final.side,
          price: final.price,
          origQty: final.executedQty,
          executedQty: final.executedQty,
          cumulativeQuote: '0',
          symbol: ctx.symbol,
        });
      } else if (['CANCELED', 'EXPIRED', 'REJECTED'].includes(final.status)) {
        ctx.logger.warn('reconcile: re-placing order', { orderId: final.orderId, status: final.status });
        internal.status = 'pending';
        internal.orderId = undefined;
        internal.clientOrderId = undefined;
        await this.placeOrder(ctx, internal);
      }
    }

    await ctx.saveState(state);
  }

  async stop(ctx: StrategyContext, _params: GridSimpleParams): Promise<void> {
    try {
      await ctx.cancelMyOrders();
      await ctx.emit('GRID_STOPPED', 'Cancelled all bot orders');
    } catch (err) {
      ctx.logger.error('cancel-on-stop failed', { err: String(err) });
    }
    try { await ctx.saveState(null); } catch {}
  }
}

export const gridSimpleStrategy = new GridSimpleStrategy();
