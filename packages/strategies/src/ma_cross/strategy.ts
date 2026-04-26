import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Decimal, roundToTickSize, roundToStepSize } from '@orca/shared';
import { validateOrder } from '@orca/exchange';
import type { Strategy, StrategyContext, StrategyOrderEvent } from '../base';
import { RollingSMA, RisingEdge } from '../graph/indicators';

export const MACrossParamsSchema = z.object({
  fastPeriod: z.coerce.number().int().min(2).max(500).default(9),
  slowPeriod: z.coerce.number().int().min(2).max(500).default(21),
  /** Quote amount per BUY trade. Will be liquidated on opposite signal. */
  quoteAmountPerTrade: z.coerce.number().positive(),
  /** Optional take-profit % (close position if up by X%). */
  takeProfitPct: z.coerce.number().min(0.1).max(1000).optional(),
  /** Optional stop-loss % (close position if down by X%). */
  stopLossPct: z.coerce.number().min(0.1).max(100).optional(),
}).refine((p) => p.fastPeriod < p.slowPeriod, {
  message: 'fastPeriod must be less than slowPeriod',
  path: ['fastPeriod'],
});
export type MACrossParams = z.infer<typeof MACrossParamsSchema>;

interface MACrossState {
  inPosition: boolean;
  entryPrice: string;
  baseHeld: string;
  lastSignal: 'NONE' | 'BUY' | 'SELL';
}

/**
 * MA Crossover strategy:
 *  - Two SMAs: fast & slow
 *  - When fast crosses ABOVE slow → BUY (open long)
 *  - When fast crosses BELOW slow → SELL (close long)
 *  - Optional TP/SL on entry price
 */
export class MACrossStrategy implements Strategy<MACrossParams> {
  readonly key = 'ma_cross_v1';

  private runtimes = new Map<string, {
    fast: RollingSMA; slow: RollingSMA;
    crossUp: RisingEdge; crossDown: RisingEdge;
  }>();

  validateParams(raw: unknown): MACrossParams {
    return MACrossParamsSchema.parse(raw);
  }

  private buildRuntime(botId: string, params: MACrossParams): void {
    this.runtimes.set(botId, {
      fast: new RollingSMA(params.fastPeriod),
      slow: new RollingSMA(params.slowPeriod),
      crossUp: new RisingEdge(),
      crossDown: new RisingEdge(),
    });
  }

  async init(ctx: StrategyContext, params: MACrossParams): Promise<void> {
    this.buildRuntime(ctx.botId, params);
    const existing = await ctx.loadState<MACrossState>();
    if (!existing) {
      await ctx.saveState({
        inPosition: false,
        entryPrice: '0',
        baseHeld: '0',
        lastSignal: 'NONE',
      } satisfies MACrossState);
    }
    await ctx.emit('MA_CROSS_INITIALIZED', `MA${params.fastPeriod}/${params.slowPeriod} on ${ctx.symbol}`);
  }

  async onOrderUpdate(ctx: StrategyContext, _params: MACrossParams, event: StrategyOrderEvent): Promise<void> {
    if (event.status !== 'FILLED') return;
    const state = (await ctx.loadState<MACrossState>())!;
    if (event.side === 'BUY') {
      state.inPosition = true;
      state.entryPrice = event.price;
      state.baseHeld = event.executedQty;
      await ctx.emit('MA_BUY_FILLED', `BUY filled @ ${event.price}`);
    } else {
      state.inPosition = false;
      state.entryPrice = '0';
      state.baseHeld = '0';
      await ctx.emit('MA_SELL_FILLED', `SELL filled @ ${event.price}`);
    }
    await ctx.saveState(state);
  }

  async onTick(ctx: StrategyContext, params: MACrossParams, lastPriceStr: string): Promise<void> {
    if (!this.runtimes.has(ctx.botId)) this.buildRuntime(ctx.botId, params);
    const rt = this.runtimes.get(ctx.botId)!;
    const lastPrice = Number(lastPriceStr);
    if (!Number.isFinite(lastPrice)) return;

    rt.fast.push(lastPrice);
    rt.slow.push(lastPrice);
    if (!rt.fast.ready || !rt.slow.ready) return;

    const fast = rt.fast.value!;
    const slow = rt.slow.value!;
    const state = (await ctx.loadState<MACrossState>())!;

    // TP/SL on entry
    if (state.inPosition && state.entryPrice !== '0') {
      const pnlPct = (lastPrice - Number(state.entryPrice)) / Number(state.entryPrice) * 100;
      if (params.takeProfitPct && pnlPct >= params.takeProfitPct) {
        await this.exitPosition(ctx, state, lastPriceStr, `TP +${pnlPct.toFixed(2)}%`);
        return;
      }
      if (params.stopLossPct && pnlPct <= -params.stopLossPct) {
        await this.exitPosition(ctx, state, lastPriceStr, `SL ${pnlPct.toFixed(2)}%`);
        return;
      }
    }

    const upCross = rt.crossUp.test(fast > slow);
    const downCross = rt.crossDown.test(fast < slow);

    if (upCross && !state.inPosition) {
      await this.enterPosition(ctx, params, state, lastPriceStr);
    } else if (downCross && state.inPosition) {
      await this.exitPosition(ctx, state, lastPriceStr, 'MA cross DOWN');
    }
  }

  private async enterPosition(
    ctx: StrategyContext,
    params: MACrossParams,
    state: MACrossState,
    lastPriceStr: string,
  ): Promise<void> {
    const price = roundToTickSize(lastPriceStr, ctx.filters.tickSize);
    const qty = roundToStepSize(
      new Decimal(params.quoteAmountPerTrade).div(price),
      ctx.filters.stepSize,
    );
    const v = validateOrder(ctx.filters, price, qty);
    if (!v.ok) {
      ctx.logger.warn('MA enter skipped', { reason: v.reason });
      return;
    }
    const cid = `orca-ma-${ctx.botId.slice(0, 8)}-b-${randomUUID().slice(0, 8)}`;
    try {
      const res = await ctx.client.placeOrder({
        symbol: ctx.symbol,
        side: 'BUY', type: 'LIMIT', timeInForce: 'GTC',
        price, quantity: qty, newClientOrderId: cid,
      });
      state.lastSignal = 'BUY';
      await ctx.saveState(state);
      await ctx.emit('MA_BUY_PLACED', `Cross UP — BUY @ ${price}`, {
        clientOrderId: cid,
        exchangeOrderId: res.orderId,
      });
    } catch (err) {
      ctx.logger.error('MA buy failed', { err: String(err) });
    }
  }

  private async exitPosition(
    ctx: StrategyContext,
    state: MACrossState,
    lastPriceStr: string,
    reason: string,
  ): Promise<void> {
    const qty = roundToStepSize(state.baseHeld, ctx.filters.stepSize);
    if (new Decimal(qty).lte(0)) return;
    const price = roundToTickSize(lastPriceStr, ctx.filters.tickSize);
    const v = validateOrder(ctx.filters, price, qty);
    if (!v.ok) return;
    const cid = `orca-ma-${ctx.botId.slice(0, 8)}-s-${randomUUID().slice(0, 8)}`;
    try {
      const res = await ctx.client.placeOrder({
        symbol: ctx.symbol,
        side: 'SELL', type: 'LIMIT', timeInForce: 'GTC',
        price, quantity: qty, newClientOrderId: cid,
      });
      state.lastSignal = 'SELL';
      await ctx.saveState(state);
      await ctx.emit('MA_SELL_PLACED', `${reason} — SELL @ ${price}`, {
        exchangeOrderId: res.orderId,
      });
    } catch (err) {
      ctx.logger.error('MA sell failed', { err: String(err) });
    }
  }

  async stop(ctx: StrategyContext): Promise<void> {
    try { await ctx.cancelMyOrders(); }
    catch (err) { ctx.logger.error('MA cancel-all failed', { err: String(err) }); }
    this.runtimes.delete(ctx.botId);
    await ctx.emit('MA_CROSS_STOPPED', 'Cancelled open orders');
  }
}

export const maCrossStrategy = new MACrossStrategy();
