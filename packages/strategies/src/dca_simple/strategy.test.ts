/**
 * Unit tests for the DCA Simple strategy.
 *
 * Focus areas:
 *   • Multipliers — flat / percent / dollar for both price gap and order size
 *   • Counter (TP/BB) placement at avg ± takeProfit
 *   • Cooldown gating — counter fill sets cooldownUntilMs, ladder NOT rebuilt immediately
 *   • Recenter from inactivity — only fires when fillsThisCycle === 0
 *   • Direction (BUY vs SELL) — correct ladder direction + counter side
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { dcaSimpleStrategy } from './strategy';
import type { DcaSimpleParams } from './params';
import { createMockCtx, lastEmit, type MockCtx } from '../__test__/test-utils';

const baseParams: DcaSimpleParams = {
  direction: 'BUY',
  gridLevels: 5,
  gridSpread: 100,
  orderSize: 10,
  takeProfit: 200,
  priceMultiplierMode: 'flat',
  priceMultiplier: 0,
  sizeMultiplierMode: 'flat',
  sizeMultiplier: 0,
  cooldownMinutes: 0,
  recenterAfterMinutes: 0,
  durationMinutes: 0,
};

describe('dca_simple — initial ladder placement', () => {
  let mock: MockCtx;
  beforeEach(() => {
    mock = createMockCtx({ initialPrice: '78000' });
  });

  it('BUY mode places descending ladder below start', async () => {
    await dcaSimpleStrategy.init(mock.ctx, baseParams);
    const placed = mock.client.placedOrders;
    expect(placed.every((o) => o.side === 'BUY')).toBe(true);
    expect(placed).toHaveLength(5);
    const prices = placed.map((o) => Number(o.price)).sort((a, b) => b - a);
    // Descending from start: 77900, 77800, 77700, 77600, 77500
    expect(prices).toEqual([77900, 77800, 77700, 77600, 77500]);
  });

  it('SELL mode places ascending ladder above start', async () => {
    await dcaSimpleStrategy.init(mock.ctx, { ...baseParams, direction: 'SELL' });
    const placed = mock.client.placedOrders;
    expect(placed.every((o) => o.side === 'SELL')).toBe(true);
    const prices = placed.map((o) => Number(o.price)).sort((a, b) => a - b);
    expect(prices).toEqual([78100, 78200, 78300, 78400, 78500]);
  });
});

describe('dca_simple — multipliers', () => {
  it('flat mode: gap is constant baseSpread × i', async () => {
    const mock = createMockCtx({ initialPrice: '78000' });
    await dcaSimpleStrategy.init(mock.ctx, baseParams);
    const prices = mock.client.placedOrders.map((o) => Number(o.price)).sort((a, b) => b - a);
    // BUY: 78000 - {100, 200, 300, 400, 500}
    expect(prices).toEqual([77900, 77800, 77700, 77600, 77500]);
  });

  it('percent mode: gap grows geometrically', async () => {
    const mock = createMockCtx({ initialPrice: '78000' });
    await dcaSimpleStrategy.init(mock.ctx, {
      ...baseParams,
      priceMultiplierMode: 'percent',
      priceMultiplier: 10, // 10% growth per rung
    });
    // gap_1 = 100 (i=1)
    // gap_2 = 100*1.1 = 110, offset_2 = 100+110 = 210 → price 77790
    // gap_3 = 100*1.21 = 121, offset_3 = 100+110+121 = 331 → price 77669
    const prices = mock.client.placedOrders.map((o) => Number(o.price)).sort((a, b) => b - a);
    expect(prices[0]).toBeCloseTo(77900, 0);
    expect(prices[1]).toBeCloseTo(77790, 0);
    expect(prices[2]).toBeCloseTo(77669, 0);
  });

  it('dollar mode: gap grows arithmetically', async () => {
    const mock = createMockCtx({ initialPrice: '78000' });
    await dcaSimpleStrategy.init(mock.ctx, {
      ...baseParams,
      priceMultiplierMode: 'dollar',
      priceMultiplier: 50, // each gap +$50
    });
    // gap_1 = 100 → 77900
    // gap_2 = 150 → 77750  (offset = 100+150 = 250)
    // gap_3 = 200 → 77550  (offset = 100+150+200 = 450)
    const prices = mock.client.placedOrders.map((o) => Number(o.price)).sort((a, b) => b - a);
    expect(prices[0]).toBeCloseTo(77900, 0);
    expect(prices[1]).toBeCloseTo(77750, 0);
    expect(prices[2]).toBeCloseTo(77550, 0);
  });

  it('size multiplier: percent grows order qty per rung', async () => {
    const mock = createMockCtx({ initialPrice: '78000' });
    await dcaSimpleStrategy.init(mock.ctx, {
      ...baseParams,
      sizeMultiplierMode: 'percent',
      sizeMultiplier: 50, // each order 50% bigger
    });
    const ordersByPrice = [...mock.client.placedOrders].sort(
      (a, b) => Number(b.price) - Number(a.price),
    );
    const sizes = ordersByPrice.map((o) => Number(o.quantity) * Number(o.price));
    // Each rung is strictly larger than the previous, and growing roughly
    // geometrically (allow generous slop for stepSize rounding + price drift).
    expect(sizes[1]).toBeGreaterThan(sizes[0]!);
    expect(sizes[2]).toBeGreaterThan(sizes[1]!);
    expect(sizes[3]).toBeGreaterThan(sizes[2]!);
    // Last rung should be ≥ 4× first rung (50% growth × 4 = 5×, but allow slop)
    expect(sizes[4]! / sizes[0]!).toBeGreaterThan(4);
  });
});

describe('dca_simple — counter (TP) placement', () => {
  let mock: MockCtx;
  beforeEach(async () => {
    mock = createMockCtx({ initialPrice: '78000' });
    await dcaSimpleStrategy.init(mock.ctx, baseParams);
  });

  it('after first BUY fill, counter SELL is placed at avg + takeProfit', async () => {
    const buy = mock.client.placedOrders.find(
      (o) => o.side === 'BUY' && Number(o.price) === 77900,
    )!;
    const ordersBefore = mock.client.placedOrders.length;

    await dcaSimpleStrategy.onOrderUpdate(mock.ctx, baseParams, {
      clientOrderId: buy.newClientOrderId!,
      status: 'FILLED',
      side: 'BUY',
      price: '77900',
      origQty: buy.quantity,
      executedQty: buy.quantity,
      cumulativeQuote: '10',
      symbol: 'BTCFDUSD',
    });

    // After avg = 77900, counter target = avg + 200 = 78100
    const newOrders = mock.client.placedOrders.slice(ordersBefore);
    expect(newOrders).toHaveLength(1);
    expect(newOrders[0]!.side).toBe('SELL');
    expect(Number(newOrders[0]!.price)).toBeCloseTo(78100, 0);
  });
});

describe('dca_simple — cooldown gating', () => {
  it('with cooldownMinutes>0, counter fill does NOT rebuild ladder immediately', async () => {
    const mock = createMockCtx({ initialPrice: '78000' });
    const params = { ...baseParams, cooldownMinutes: 10 };
    await dcaSimpleStrategy.init(mock.ctx, params);

    // Fill a BUY to open position
    const buy = mock.client.placedOrders.find(
      (o) => o.side === 'BUY' && Number(o.price) === 77900,
    )!;
    await dcaSimpleStrategy.onOrderUpdate(mock.ctx, params, {
      clientOrderId: buy.newClientOrderId!,
      status: 'FILLED', side: 'BUY', price: '77900',
      origQty: buy.quantity, executedQty: buy.quantity,
      cumulativeQuote: '10', symbol: 'BTCFDUSD',
    });

    // Find the counter SELL and fill it (closes the cycle)
    const counter = [...mock.client.placedOrders].reverse().find((o) => o.side === 'SELL')!;
    const ordersBefore = mock.client.placedOrders.length;

    await dcaSimpleStrategy.onOrderUpdate(mock.ctx, params, {
      clientOrderId: counter.newClientOrderId!,
      status: 'FILLED', side: 'SELL', price: counter.price,
      origQty: counter.quantity, executedQty: counter.quantity,
      cumulativeQuote: '10', symbol: 'BTCFDUSD',
    });

    // Cooldown active → no new ladder placed.
    const newOrders = mock.client.placedOrders.slice(ordersBefore);
    expect(newOrders).toHaveLength(0);

    const state = mock.state.current as { cooldownUntilMs: number; ladder: unknown[] };
    expect(state.cooldownUntilMs).toBeGreaterThan(Date.now());
    expect(state.ladder).toHaveLength(0);
    expect(lastEmit(mock.emits, 'DCA_COOLDOWN_STARTED')).toBeDefined();
  });

  it('with cooldownMinutes=0, counter fill rebuilds immediately', async () => {
    const mock = createMockCtx({ initialPrice: '78000' });
    await dcaSimpleStrategy.init(mock.ctx, baseParams);

    const buy = mock.client.placedOrders.find(
      (o) => o.side === 'BUY' && Number(o.price) === 77900,
    )!;
    await dcaSimpleStrategy.onOrderUpdate(mock.ctx, baseParams, {
      clientOrderId: buy.newClientOrderId!,
      status: 'FILLED', side: 'BUY', price: '77900',
      origQty: buy.quantity, executedQty: buy.quantity,
      cumulativeQuote: '10', symbol: 'BTCFDUSD',
    });

    const counter = [...mock.client.placedOrders].reverse().find((o) => o.side === 'SELL')!;
    await dcaSimpleStrategy.onOrderUpdate(mock.ctx, baseParams, {
      clientOrderId: counter.newClientOrderId!,
      status: 'FILLED', side: 'SELL', price: counter.price,
      origQty: counter.quantity, executedQty: counter.quantity,
      cumulativeQuote: '10', symbol: 'BTCFDUSD',
    });

    const state = mock.state.current as { ladder: unknown[]; cooldownUntilMs: number };
    expect(state.cooldownUntilMs).toBe(0);
    // Fresh ladder built immediately
    expect(state.ladder.length).toBe(5);
    expect(lastEmit(mock.emits, 'DCA_CYCLE_REBUILT')).toBeDefined();
  });
});

describe('dca_simple — recenter from inactivity', () => {
  it('does NOT fire when fillsThisCycle > 0 (cycle is active)', async () => {
    const mock = createMockCtx({ initialPrice: '78000' });
    const params = { ...baseParams, recenterAfterMinutes: 1 };
    await dcaSimpleStrategy.init(mock.ctx, params);

    // Fill one rung — cycle is now "active"
    const buy = mock.client.placedOrders.find(
      (o) => o.side === 'BUY' && Number(o.price) === 77900,
    )!;
    await dcaSimpleStrategy.onOrderUpdate(mock.ctx, params, {
      clientOrderId: buy.newClientOrderId!,
      status: 'FILLED', side: 'BUY', price: '77900',
      origQty: buy.quantity, executedQty: buy.quantity,
      cumulativeQuote: '10', symbol: 'BTCFDUSD',
    });

    // Force cycleStartedAtMs into the past so the inactivity threshold is met
    const state = mock.state.current as Record<string, unknown>;
    state.cycleStartedAtMs = Date.now() - 5 * 60_000;
    state.nextReconcileAtMs = 0;
    await mock.ctx.saveState(state);

    const ladderSizeBefore = (mock.state.current as { ladder: unknown[] }).ladder.length;
    await dcaSimpleStrategy.onTick(mock.ctx, params, '78000');

    // No recenter event should have been emitted (cycle had a fill).
    expect(lastEmit(mock.emits, 'DCA_RECENTER_INACTIVITY')).toBeUndefined();
    const after = mock.state.current as { ladder: unknown[] };
    expect(after.ladder.length).toBe(ladderSizeBefore);
  });

  it('DOES fire when fillsThisCycle === 0 and threshold elapsed', async () => {
    const mock = createMockCtx({ initialPrice: '78000' });
    const params = { ...baseParams, recenterAfterMinutes: 1, cooldownMinutes: 0 };
    await dcaSimpleStrategy.init(mock.ctx, params);

    const state = mock.state.current as Record<string, unknown>;
    state.cycleStartedAtMs = Date.now() - 5 * 60_000;
    state.nextReconcileAtMs = 0;
    await mock.ctx.saveState(state);

    await dcaSimpleStrategy.onTick(mock.ctx, params, '78000');

    expect(lastEmit(mock.emits, 'DCA_RECENTER_INACTIVITY')).toBeDefined();
  });
});

describe('dca_simple — state migration', () => {
  it('upgrades legacy heldBase shape on resume', async () => {
    const mock = createMockCtx({ initialPrice: '78000' });
    // Plant a legacy state and resume
    await mock.ctx.saveState({
      initialStartPrice: '78000',
      cycleAnchorPrice: '78000',
      ladder: [],
      counter: null,
      // no fillsThisCycle, no realizedPnlQuote, no processedFills
      heldBase: '0',
      openCostBasis: '0',
      avgPrice: '0',
      startedAtMs: Date.now() - 1_000_000,
    });
    await dcaSimpleStrategy.init(mock.ctx, baseParams);
    const state = mock.state.current as Record<string, unknown>;
    expect(state.processedFills).toBeDefined();
    expect(state.realizedPnlQuote).toBe('0');
    expect(state.cyclesCompleted).toBe(0);
    expect(state.fillsThisCycle).toBe(0);
    expect(state.cooldownUntilMs).toBe(0);
    expect(state.cycleStartedAtMs).toBeDefined();
  });
});
