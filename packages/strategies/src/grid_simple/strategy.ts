import { randomUUID } from 'node:crypto';
import { Decimal, roundToTickSize, roundToStepSize } from '@orca/shared';
import { validateOrder } from '@orca/exchange';
import type { Strategy, StrategyContext, StrategyOrderEvent } from '../base';
import { GridSimpleParamsSchema, type GridSimpleParams } from './params';

interface SimpleOrder {
  /** 'pending' | 'open' | 'ignored_balance' | 'error' */
  status: string;
  side: 'BUY' | 'SELL';
  price: string;
  quantity: string;
  clientOrderId?: string;
  orderId?: number;
  lastError?: { code?: number; msg?: string; ts: number };
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
   * Try to place an order. Handles:
   *  - Real insufficient balance → mark `ignored_balance`, reconcile retries.
   *  - Post-only rejection ("would immediately match") → re-price 1 tick further
   *    from the market and retry once; if still rejected, mark `post_only_rejected`
   *    (NOT retried — the spread is too tight; user needs to widen).
   *  - Filter failure → one 3s retry with same params.
   *  - Auth error → fatal throw.
   *  - Other → mark `error`.
   */
  private async _placeOrderAttempt(
    ctx: StrategyContext,
    order: SimpleOrder,
    repriceAttempts: number,
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
      const e = err as { response?: { data?: { code?: number; msg?: string } }; message?: string };
      const code = e.response?.data?.code;
      const msg = e.response?.data?.msg ?? e.message ?? String(err);

      // Fatal — auth error.
      if (code === -2014 || code === -2015) {
        ctx.logger.error('Fatal API key error — bot must stop', { code, msg });
        await ctx.emit('FATAL_API_ERROR', `Fatal: ${msg}`, { code });
        throw err;
      }

      // Distinguish post-only rejection from insufficient balance —
      // both can return -2010, but the message tells them apart.
      const wouldMatch =
        /immediately match/i.test(msg) ||
        /post[- ]?only/i.test(msg) ||
        code === -2011 ||
        msg.includes('Order would trigger immediately');
      const realInsufficient =
        !wouldMatch && (/insufficient balance/i.test(msg) || code === -2010);

      if (wouldMatch) {
        // Re-price one tick further from the market and retry once.
        if (repriceAttempts < 2) {
          const tick = new Decimal(ctx.filters.tickSize);
          const adj = order.side === 'BUY'
            ? new Decimal(order.price).minus(tick)
            : new Decimal(order.price).plus(tick);
          if (adj.lte(0)) {
            order.status = 'post_only_rejected';
            order.lastError = { code, msg, ts: Date.now() };
            return;
          }
          const newPrice = roundToTickSize(adj, ctx.filters.tickSize);
          ctx.logger.info('Post-only rejection — re-pricing 1 tick away', {
            side: order.side, oldPrice: order.price, newPrice, attempt: repriceAttempts + 1,
          });
          // Recompute qty so quote spend stays close to orderSize. Use the original
          // order.quantity * (oldPrice / newPrice) ratio? Simpler: re-use same qty.
          order.price = newPrice;
          await this._placeOrderAttempt(ctx, order, repriceAttempts + 1);
          return;
        }
        // Two re-prices failed → spread is too tight relative to current book.
        ctx.logger.warn('Order skipped: too close to market for LIMIT_MAKER', {
          side: order.side, price: order.price, msg,
        });
        order.status = 'post_only_rejected';
        order.lastError = { code, msg, ts: Date.now() };
        await ctx.emit('ORDER_SKIPPED_POST_ONLY',
          `${order.side} @ ${order.price} skipped — too close to market. Widen gridSpread.`,
          { side: order.side, price: order.price });
        return;
      }

      if (realInsufficient) {
        // Real lack of balance — reconcile loop retries with same price/qty.
        order.status = 'ignored_balance';
        order.lastError = { code, msg, ts: Date.now() };
        return;
      }

      // Filter failure — usually slippage. One short retry.
      if (code === -1013) {
        ctx.logger.warn('Filter failure, retrying once after 3s', { side: order.side, price: order.price, msg });
        await new Promise((r) => setTimeout(r, 3000));
        try {
          const cid2 = `orca-${this.tag(ctx)}-${order.side === 'BUY' ? 'b' : 's'}r-${randomUUID().slice(0, 6)}`;
          const res = await ctx.client.placeOrder({
            symbol: ctx.symbol,
            side: order.side,
            type: 'LIMIT_MAKER',
            price: order.price,
            quantity: order.quantity,
            newClientOrderId: cid2,
          });
          order.clientOrderId = cid2;
          order.orderId = res.orderId;
          order.status = 'open';
          return;
        } catch (e2) {
          ctx.logger.warn('Retry failed for filter error', { err: String(e2) });
          order.status = 'error';
          return;
        }
      }

      ctx.logger.warn('Order placement failed', { side: order.side, price: order.price, msg });
      order.status = 'error';
      order.lastError = { code, msg, ts: Date.now() };
    }
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

    // ─── Fire all orders in parallel (chunked to respect Binance burst limits) ───
    const CHUNK_SIZE = 20;
    const t0 = Date.now();
    for (let i = 0; i < orders.length; i += CHUNK_SIZE) {
      const chunk = orders.slice(i, i + CHUNK_SIZE);
      await Promise.allSettled(chunk.map((o) => this.placeOrder(ctx, o)));
    }
    const placed = orders.filter((o) => o.status === 'open').length;
    const skipped = orders.filter((o) => o.status === 'ignored_balance').length;
    const errored = orders.filter((o) => o.status === 'error').length;
    ctx.logger.info('Initial grid placed', {
      total: orders.length, placed, skipped, errored, ms: Date.now() - t0,
    });
    await ctx.emit('GRID_PLACEMENT_DONE',
      `Placed ${placed}/${orders.length} (skipped ${skipped}, errored ${errored}) in ${Date.now() - t0}ms`,
      { placed, skipped, errored });

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

    // 1) Retry balance-skipped AND post-only-rejected orders.
    //    The market may have moved away from these prices, freeing them up.
    const retryable = state.orders.filter(
      (o) => o.status === 'ignored_balance' || o.status === 'post_only_rejected',
    );
    if (retryable.length > 0) {
      ctx.logger.info(`Retrying ${retryable.length} skipped orders`, {
        balance: retryable.filter((o) => o.status === 'ignored_balance').length,
        postOnly: retryable.filter((o) => o.status === 'post_only_rejected').length,
      });
      for (const o of retryable) {
        o.status = 'pending';
        delete o.lastError;
      }
      const CHUNK = 20;
      for (let i = 0; i < retryable.length; i += CHUNK) {
        await Promise.allSettled(retryable.slice(i, i + CHUNK).map((o) => this.placeOrder(ctx, o)));
      }
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
