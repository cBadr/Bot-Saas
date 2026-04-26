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

interface DCAState {
  ordersExecuted: number;
  baseHeld: string;        // total base accumulated (BUY) or remaining to sell (SELL)
  avgCost: string;         // weighted avg cost (BUY) or avg sell price (SELL)
  lastOrderAt: number;     // ms
  lastFillPrice: string;   // last fill price for price-gate comparison
  totalSpentQuote: string; // BUY: spent quote; SELL: received quote
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
    if (!existing) {
      await ctx.saveState({
        ordersExecuted: 0,
        baseHeld: '0',
        avgCost: '0',
        lastOrderAt: 0,
        lastFillPrice: '0',
        totalSpentQuote: '0',
      } satisfies DCAState);
      const gates: string[] = [];
      if (params.intervalMinutes) gates.push(`every ${params.intervalMinutes}m`);
      if (params.minPriceMovePct) gates.push(`on ${params.minPriceMovePct}% ${params.direction === 'BUY' ? 'drop' : 'rise'}`);
      await ctx.emit(
        'DCA_INITIALIZED',
        `${params.direction} ${params.totalOrders} orders ${gates.join(' & ')}`,
      );
    } else {
      ctx.logger.info('Resuming DCA from saved state', { ...existing });
    }
  }

  async onOrderUpdate(ctx: StrategyContext, params: DCAParams, event: StrategyOrderEvent): Promise<void> {
    if (event.status !== 'FILLED') return;
    const state = (await ctx.loadState<DCAState>())!;
    const fillPrice = new Decimal(event.price);
    const fillQty = new Decimal(event.executedQty);
    const fillQuote = fillPrice.mul(fillQty);

    if (event.side === 'BUY') {
      // Update weighted avg cost
      const oldHeld = new Decimal(state.baseHeld);
      const oldAvg = new Decimal(state.avgCost);
      const newHeld = oldHeld.plus(fillQty);
      state.avgCost = newHeld.gt(0)
        ? oldHeld.mul(oldAvg).plus(fillQty.mul(fillPrice)).div(newHeld).toString()
        : fillPrice.toString();
      state.baseHeld = newHeld.toString();
      if (params.direction === 'BUY') state.totalSpentQuote = new Decimal(state.totalSpentQuote).plus(fillQuote).toString();
    } else {
      // SELL: reduce held base
      state.baseHeld = Decimal.max(0, new Decimal(state.baseHeld).minus(fillQty)).toString();
      if (params.direction === 'SELL') state.totalSpentQuote = new Decimal(state.totalSpentQuote).plus(fillQuote).toString();
    }

    state.ordersExecuted += 1;
    state.lastOrderAt = Date.now();
    state.lastFillPrice = fillPrice.toString();

    await ctx.emit(`DCA_${event.side}_FILLED`, `${event.side} #${state.ordersExecuted}/${params.totalOrders} @ ${event.price}`);
    await ctx.saveState(state);
  }

  async onTick(ctx: StrategyContext, params: DCAParams, lastPriceStr: string): Promise<void> {
    const state = (await ctx.loadState<DCAState>())!;
    const lastPrice = new Decimal(lastPriceStr);
    const now = Date.now();

    // TP/SL on weighted avg
    if (params.direction === 'BUY' && new Decimal(state.baseHeld).gt(0) && new Decimal(state.avgCost).gt(0)) {
      const pnlPct = lastPrice.minus(state.avgCost).div(state.avgCost).mul(100).toNumber();
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
    const qty = roundToStepSize(state.baseHeld, ctx.filters.stepSize);
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
