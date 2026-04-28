import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Decimal, roundToTickSize, roundToStepSize } from '@orca/shared';
import { validateOrder } from '@orca/exchange';
import type { Strategy, StrategyContext, StrategyOrderEvent } from '../base';

export const DCAParamsSchema = z.object({
  /** BUY: accumulate base by spending quote. SELL: distribute base into quote. */
  direction: z.enum(['BUY', 'SELL']).default('BUY'),
  /** Total quote currency for BUY mode, OR total base value (in quote terms) for SELL mode. */
  totalQuoteInvestment: z.coerce.number().positive(),
  /** How many DCA orders to make in total. */
  totalOrders: z.coerce.number().int().min(1).max(1000).default(20),
  /** Time gate: minutes between orders. If unset, only price gate is used. */
  intervalMinutes: z.coerce.number().int().min(1).max(43_200).optional(),
  /**
   * Price gate (BUY): only buy if price dropped at least this % since last buy.
   * Price gate (SELL): only sell if price rose at least this % since last sell.
   * If unset, only time gate is used.
   */
  minPriceMovePct: z.coerce.number().min(0.01).max(100).optional(),
  /**
   * Price gate as ABSOLUTE $ amount (alternative to minPriceMovePct).
   * BUY: only buy if price dropped at least this many quote units since last buy.
   * SELL: only sell if price rose at least this many quote units.
   */
  minPriceMoveDollar: z.coerce.number().positive().optional(),
  /** TP %: BUY → liquidate if avg cost up X%; SELL → re-enter if price drops X%. */
  takeProfitPct: z.coerce.number().min(0.1).max(1000).optional(),
  /** SL %: stop loss percentage. */
  stopLossPct: z.coerce.number().min(0.1).max(100).optional(),
}).refine(
  (p) => p.intervalMinutes !== undefined || p.minPriceMovePct !== undefined || p.minPriceMoveDollar !== undefined,
  {
    message: 'At least one gate must be set: intervalMinutes, minPriceMovePct, or minPriceMoveDollar',
    path: ['intervalMinutes'],
  },
);
export type DCAParams = z.infer<typeof DCAParamsSchema>;

/**
 * DCA bot state. P&L tracking aligned with the project-wide spec:
 *
 *   Realized P&L = Σ over closing fills of (sellPrice − buyCostBasis) × qty
 *                  (sign-flipped for SELL-direction bots)
 *   Unrealized   = (currentPrice − initialStartPrice) × signedHeldQty
 *                  signedHeldQty = +heldBase (BUY mode) | −heldBase (SELL mode)
 *   Total        = Realized + Unrealized
 *
 * Field semantics depend on `direction`:
 *   BUY mode  → heldBase = inventory accumulated from BUYs (decremented on closing SELLs)
 *               openCostBasis = total cost spent on currently-held inventory
 *   SELL mode → heldBase = cumulative SELL qty awaiting BB (decremented on closing BUYs)
 *               openCostBasis = total proceeds received from those SELLs
 *
 *   avgPrice = openCostBasis / heldBase (when heldBase > 0)
 */
interface DCAState {
  ordersExecuted: number;
  lastOrderAt: number;        // ms
  lastFillPrice: string;      // last fill price for price-gate comparison
  totalSpentQuote: string;    // BUY: cumulative spent; SELL: cumulative received

  // Position tracking
  heldBase: string;
  openCostBasis: string;
  avgPrice: string;

  // P&L tracking (project spec)
  initialStartPrice: string;  // captured once at bot launch — Unrealized reference
  realizedPnlQuote: string;
  cyclesCompleted: number;

  // ── Legacy field kept for one-time migration from older state shape ──
  /** @deprecated migrated into `heldBase` on load. */
  baseHeld?: string;
  /** @deprecated migrated into `avgPrice` on load. */
  avgCost?: string;
}

/**
 * Dollar-Cost Averaging:
 *  - direction=BUY:  periodically buys quote-amount worth of base
 *  - direction=SELL: periodically sells equivalent base, distributing into quote
 *  - Gates (intervalMinutes / minPriceMovePct) work independently or together
 *  - Optional TP/SL based on weighted avg vs current price
 */
export class DCAStrategy implements Strategy<DCAParams> {
  readonly key = 'dca_v1';

  validateParams(raw: unknown): DCAParams {
    return DCAParamsSchema.parse(raw);
  }

  async init(ctx: StrategyContext, params: DCAParams): Promise<void> {
    const existing = await ctx.loadState<DCAState>();
    if (existing) {
      this._migrateState(existing);
      await ctx.saveState(existing);
      ctx.logger.info('Resuming DCA from saved state', {
        ordersExecuted: existing.ordersExecuted,
        heldBase: existing.heldBase,
        realized: existing.realizedPnlQuote,
        cycles: existing.cyclesCompleted,
      });
      await ctx.emit('DCA_RESUMED',
        `Resumed DCA: ${existing.ordersExecuted}/${params.totalOrders} fills, realized=${existing.realizedPnlQuote}, cycles=${existing.cyclesCompleted}`);
      return;
    }

    // Fresh start — capture the launch ticker as the Unrealized reference.
    const ticker = await ctx.client.getTickerPrice(ctx.symbol);
    const startPrice = roundToTickSize(ticker.price, ctx.filters.tickSize);

    await ctx.saveState({
      ordersExecuted: 0,
      lastOrderAt: 0,
      lastFillPrice: '0',
      totalSpentQuote: '0',
      heldBase: '0',
      openCostBasis: '0',
      avgPrice: '0',
      initialStartPrice: startPrice,
      realizedPnlQuote: '0',
      cyclesCompleted: 0,
    } satisfies DCAState);

    const gates: string[] = [];
    if (params.intervalMinutes) gates.push(`every ${params.intervalMinutes}m`);
    if (params.minPriceMovePct) gates.push(`on ${params.minPriceMovePct}% ${params.direction === 'BUY' ? 'drop' : 'rise'}`);
    if (params.minPriceMoveDollar) gates.push(`on $${params.minPriceMoveDollar} ${params.direction === 'BUY' ? 'drop' : 'rise'}`);
    await ctx.emit(
      'DCA_INITIALIZED',
      `${params.direction} ${params.totalOrders} orders ${gates.join(' & ')} · start ${startPrice}`,
      { direction: params.direction, totalOrders: params.totalOrders, startPrice },
    );
  }

  /**
   * Migrate legacy state shape in-place. Older DCA bots had `baseHeld` /
   * `avgCost` instead of `heldBase` / `avgPrice` and lacked the P&L
   * tracking fields entirely.
   */
  private _migrateState(s: DCAState): void {
    if (typeof s.heldBase !== 'string') {
      s.heldBase = s.baseHeld ?? '0';
      delete s.baseHeld;
    }
    if (typeof s.avgPrice !== 'string') {
      s.avgPrice = s.avgCost ?? '0';
      delete s.avgCost;
    }
    if (typeof s.openCostBasis !== 'string') {
      // Best-effort reconstruction: avgPrice × heldBase
      const held = new Decimal(s.heldBase || '0');
      const avg = new Decimal(s.avgPrice || '0');
      s.openCostBasis = held.gt(0) && avg.gt(0) ? held.mul(avg).toString() : '0';
    }
    if (typeof s.initialStartPrice !== 'string') s.initialStartPrice = s.lastFillPrice || '0';
    if (typeof s.realizedPnlQuote !== 'string') s.realizedPnlQuote = '0';
    if (typeof s.cyclesCompleted !== 'number') s.cyclesCompleted = 0;
  }

  async onOrderUpdate(ctx: StrategyContext, params: DCAParams, event: StrategyOrderEvent): Promise<void> {
    if (event.status !== 'FILLED') return;
    const state = (await ctx.loadState<DCAState>())!;
    this._migrateState(state);

    const fillPrice = new Decimal(event.price);
    const fillQty = new Decimal(event.executedQty);
    const fillQuote = fillPrice.mul(fillQty);

    // Identify the leg type:
    //   "opening" = same side as direction (BUY in BUY-mode, SELL in SELL-mode) → adds to position
    //   "closing" = opposite side → realizes P&L by releasing proportional cost basis
    const isOpeningLeg = event.side === params.direction;

    let cyclePnl = new Decimal(0);
    let cycleClosed = false;

    if (isOpeningLeg) {
      // Add to position
      const newHeld = new Decimal(state.heldBase).plus(fillQty);
      const newBasis = new Decimal(state.openCostBasis).plus(fillQuote);
      state.heldBase = newHeld.toString();
      state.openCostBasis = newBasis.toString();
      state.avgPrice = newHeld.gt(0) ? newBasis.div(newHeld).toString() : '0';
      state.totalSpentQuote = new Decimal(state.totalSpentQuote).plus(fillQuote).toString();
    } else {
      // Closing leg — realize P&L proportionally based on stored cost basis.
      const heldBefore = new Decimal(state.heldBase);
      if (heldBefore.lte(0)) {
        // Closing fill but we have no recorded position (e.g. SELL-mode bot's
        // very first BUY-back without prior tracking). Skip realized accounting.
        ctx.logger.warn('DCA closing fill with no recorded position — skipping P&L', {
          side: event.side, qty: event.executedQty,
        });
      } else {
        const closeQty = Decimal.min(fillQty, heldBefore);
        const avgPrice = new Decimal(state.avgPrice);
        const basisReleased = avgPrice.mul(closeQty);

        // Direction-aware realized P&L:
        //   BUY-mode close (SELL fill):   pnl = (sellPrice − avgCost)     × qty
        //   SELL-mode close (BUY fill):   pnl = (avgSellPrice − buyPrice) × qty
        cyclePnl = params.direction === 'BUY'
          ? fillPrice.minus(avgPrice).mul(closeQty)
          : avgPrice.minus(fillPrice).mul(closeQty);

        state.realizedPnlQuote = new Decimal(state.realizedPnlQuote).plus(cyclePnl).toString();
        state.heldBase = heldBefore.minus(closeQty).toString();
        state.openCostBasis = Decimal.max(
          0, new Decimal(state.openCostBasis).minus(basisReleased),
        ).toString();
        // Recompute avgPrice if any inventory remains; reset if fully closed.
        const remaining = new Decimal(state.heldBase);
        state.avgPrice = remaining.gt(0)
          ? new Decimal(state.openCostBasis).div(remaining).toString()
          : '0';

        // A cycle is "closed" when the position is fully released.
        if (remaining.lte(new Decimal(ctx.filters.stepSize).mul(0.5))) {
          state.cyclesCompleted += 1;
          cycleClosed = true;
          // Clean up tiny dust to avoid drift
          state.heldBase = '0';
          state.openCostBasis = '0';
        }
      }
      state.totalSpentQuote = new Decimal(state.totalSpentQuote).plus(fillQuote).toString();
    }

    state.ordersExecuted += 1;
    state.lastOrderAt = Date.now();
    state.lastFillPrice = fillPrice.toString();

    const evtType = `DCA_${event.side}_FILLED`;
    const evtMsg = isOpeningLeg
      ? `${event.side} #${state.ordersExecuted} @ ${event.price} → opening leg (avg ${new Decimal(state.avgPrice).toFixed(8)})`
      : cycleClosed
        ? `${event.side} #${state.ordersExecuted} @ ${event.price} → cycle #${state.cyclesCompleted} closed (PnL ${cyclePnl.toFixed(8)})`
        : `${event.side} #${state.ordersExecuted} @ ${event.price} → partial close (PnL ${cyclePnl.toFixed(8)})`;

    await ctx.emit(evtType, evtMsg, {
      price: event.price,
      quantity: event.executedQty,
      isOpeningLeg,
      cycleClosed,
      cyclePnl: cyclePnl.toString(),
      cyclesCompleted: state.cyclesCompleted,
      realizedPnlQuote: state.realizedPnlQuote,
      heldBase: state.heldBase,
      avgPrice: state.avgPrice,
    });
    await ctx.saveState(state);
  }

  async onTick(ctx: StrategyContext, params: DCAParams, lastPriceStr: string): Promise<void> {
    const state = (await ctx.loadState<DCAState>())!;
    this._migrateState(state);
    const lastPrice = new Decimal(lastPriceStr);
    const now = Date.now();

    // TP/SL on weighted avg (BUY mode only — SELL mode liquidation logic is
    // symmetric but rarely useful in practice; leaving as-is)
    if (params.direction === 'BUY' && new Decimal(state.heldBase).gt(0) && new Decimal(state.avgPrice).gt(0)) {
      const pnlPct = lastPrice.minus(state.avgPrice).div(state.avgPrice).mul(100).toNumber();
      if (params.takeProfitPct && pnlPct >= params.takeProfitPct) {
        await this.liquidate(ctx, state, lastPriceStr, `TP +${pnlPct.toFixed(2)}%`);
        return;
      }
      if (params.stopLossPct && pnlPct <= -params.stopLossPct) {
        await this.liquidate(ctx, state, lastPriceStr, `SL ${pnlPct.toFixed(2)}%`);
        return;
      }
    }

    // Done check
    if (state.ordersExecuted >= params.totalOrders) return;

    // ── Gates: BOTH (if both set) must pass; OR (if only one set) — that one ──
    const timeGateOk = params.intervalMinutes
      ? (now - state.lastOrderAt >= params.intervalMinutes * 60_000)
      : true; // no gate set → satisfied
    const priceGateOk = (params.minPriceMovePct || params.minPriceMoveDollar)
      ? this.priceGateSatisfied(state, lastPrice, params)
      : true;
    // First order: always allowed (no last fill to compare against)
    const isFirstOrder = state.ordersExecuted === 0;
    const gatesPassed = isFirstOrder || (timeGateOk && priceGateOk);
    if (!gatesPassed) return;

    // Compute order
    const remainingOrders = params.totalOrders - state.ordersExecuted;
    const remainingQuote = new Decimal(params.totalQuoteInvestment).minus(state.totalSpentQuote);
    const quotePerOrder = remainingQuote.div(remainingOrders);
    if (quotePerOrder.lte(0)) return;

    const price = roundToTickSize(lastPriceStr, ctx.filters.tickSize);
    const qty = roundToStepSize(quotePerOrder.div(price), ctx.filters.stepSize);
    const v = validateOrder(ctx.filters, price, qty);
    if (!v.ok) {
      ctx.logger.warn('DCA order skipped: validation failed', { reason: v.reason });
      return;
    }

    const cid = `orca-dca-${ctx.botId.slice(0, 8)}-${randomUUID().slice(0, 8)}`;
    try {
      const res = await ctx.client.placeOrder({
        symbol: ctx.symbol,
        side: params.direction,
        type: 'LIMIT',
        timeInForce: 'GTC',
        price,
        quantity: qty,
        newClientOrderId: cid,
      });
      await ctx.emit('DCA_ORDER_PLACED', `${params.direction} #${state.ordersExecuted + 1} @ ${price}`, {
        clientOrderId: cid,
        exchangeOrderId: res.orderId,
        quantity: qty,
      });
    } catch (err) {
      ctx.logger.error('DCA order failed', { err: String(err) });
    }
  }

  /** True if price moved enough since the last fill to satisfy the gate. */
  private priceGateSatisfied(state: DCAState, lastPrice: Decimal, params: DCAParams): boolean {
    if (state.lastFillPrice === '0' || new Decimal(state.lastFillPrice).lte(0)) return true;
    const lastFill = new Decimal(state.lastFillPrice);
    const moveAbs = params.direction === 'BUY'
      ? lastFill.minus(lastPrice)   // BUY: gate satisfied if price dropped (positive)
      : lastPrice.minus(lastFill);  // SELL: gate satisfied if price rose (positive)

    // If $ gate set, check it. If satisfied → pass.
    if (params.minPriceMoveDollar !== undefined) {
      if (moveAbs.toNumber() >= params.minPriceMoveDollar) return true;
    }
    // If % gate set, check it.
    if (params.minPriceMovePct !== undefined) {
      const movePct = moveAbs.div(lastFill).mul(100);
      if (movePct.toNumber() >= params.minPriceMovePct) return true;
    }
    return false;
  }

  private async liquidate(ctx: StrategyContext, state: DCAState, lastPriceStr: string, reason: string): Promise<void> {
    const qty = roundToStepSize(state.heldBase, ctx.filters.stepSize);
    if (new Decimal(qty).lte(0)) return;
    const price = roundToTickSize(lastPriceStr, ctx.filters.tickSize);
    const v = validateOrder(ctx.filters, price, qty);
    if (!v.ok) return;
    const cid = `orca-dca-liq-${ctx.botId.slice(0, 8)}-${randomUUID().slice(0, 8)}`;
    try {
      const res = await ctx.client.placeOrder({
        symbol: ctx.symbol, side: 'SELL', type: 'LIMIT', timeInForce: 'GTC',
        price, quantity: qty, newClientOrderId: cid,
      });
      await ctx.emit('DCA_LIQUIDATE', `${reason} — selling ${qty} @ ${price}`, {
        exchangeOrderId: res.orderId,
      });
    } catch (err) {
      ctx.logger.error('DCA liquidate failed', { err: String(err) });
    }
  }

  async stop(ctx: StrategyContext, _params: DCAParams): Promise<void> {
    try { await ctx.cancelMyOrders(); }
    catch (err) { ctx.logger.error('DCA cancel-my-orders failed', { err: String(err) }); }
    await ctx.emit('DCA_STOPPED', 'Cancelled this bot\'s open orders');
  }
}

export const dcaStrategy = new DCAStrategy();
