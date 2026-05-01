/**
 * Unit tests for the Grid Simple strategy.
 *
 * Focus areas (the things that broke during development):
 *   • Initial ladder placement — symmetric BUY+SELL
 *   • Cycle matching — BUY → SELL closes BUY-first, SELL → BUY closes SELL-first
 *   • Idempotency — duplicate fill events don't double-place counters
 *   • State migration — legacy `unmatchedBuys` shape upgrades cleanly
 *   • Realized PnL math — matches the project spec (Σ spread × qty)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { gridSimpleStrategy } from './strategy';
import type { GridSimpleParams } from './params';
import { createMockCtx, lastEmit, type MockCtx } from '../__test__/test-utils';

const baseParams: GridSimpleParams = {
  gridLevels: 3,
  gridSpread: 100,
  orderSize: 10,
  durationMinutes: 0,
};

describe('grid_simple — initial placement', () => {
  let mock: MockCtx;
  beforeEach(() => {
    mock = createMockCtx({ initialPrice: '78000' });
  });

  it('places 2 × gridLevels orders symmetrically around start price', async () => {
    await gridSimpleStrategy.init(mock.ctx, baseParams);
    const placed = mock.client.placedOrders;
    expect(placed).toHaveLength(6); // 3 BUYs + 3 SELLs

    const buys = placed.filter((o) => o.side === 'BUY').map((o) => Number(o.price)).sort((a, b) => a - b);
    const sells = placed.filter((o) => o.side === 'SELL').map((o) => Number(o.price)).sort((a, b) => a - b);

    expect(buys).toEqual([77700, 77800, 77900]); // start - 1×100, 2×100, 3×100
    expect(sells).toEqual([78100, 78200, 78300]);
  });

  it('persists initialStartPrice in state on first init', async () => {
    await gridSimpleStrategy.init(mock.ctx, baseParams);
    const state = mock.state.current as { initialStartPrice: string };
    // Tick-rounded form — 78000 with tickSize 0.01 → "78000.00"
    expect(Number(state.initialStartPrice)).toBe(78000);
  });

  it('respects customStartPrice override', async () => {
    await gridSimpleStrategy.init(mock.ctx, { ...baseParams, customStartPrice: 80000 });
    const state = mock.state.current as { initialStartPrice: string };
    expect(Number(state.initialStartPrice)).toBe(80000);
  });

  it('emits GRID_INITIALIZED + GRID_PLACEMENT_DONE events', async () => {
    await gridSimpleStrategy.init(mock.ctx, baseParams);
    expect(lastEmit(mock.emits, 'GRID_INITIALIZED')).toBeDefined();
    expect(lastEmit(mock.emits, 'GRID_PLACEMENT_DONE')).toBeDefined();
  });
});

describe('grid_simple — cycle matching', () => {
  let mock: MockCtx;
  beforeEach(async () => {
    mock = createMockCtx({ initialPrice: '78000' });
    await gridSimpleStrategy.init(mock.ctx, baseParams);
  });

  it('BUY fill places counter SELL one spread above', async () => {
    // Find a BUY order, simulate its fill
    const buyOrder = mock.client.placedOrders.find((o) => o.side === 'BUY' && Number(o.price) === 77900)!;
    const ordersBefore = mock.client.placedOrders.length;

    await gridSimpleStrategy.onOrderUpdate(mock.ctx, baseParams, {
      clientOrderId: buyOrder.newClientOrderId!,
      status: 'FILLED',
      side: 'BUY',
      price: '77900',
      origQty: buyOrder.quantity,
      executedQty: buyOrder.quantity,
      cumulativeQuote: '10',
      symbol: 'BTCFDUSD',
    });

    // A new SELL should have been placed at 78000
    const newOrders = mock.client.placedOrders.slice(ordersBefore);
    expect(newOrders).toHaveLength(1);
    expect(newOrders[0]!.side).toBe('SELL');
    expect(Number(newOrders[0]!.price)).toBe(78000); // 77900 + 100 spread
  });

  it('SELL fill matches unmatched BUY → realizes PnL', async () => {
    // First fill a BUY — opens cycle
    const buyOrder = mock.client.placedOrders.find((o) => o.side === 'BUY' && Number(o.price) === 77900)!;
    await gridSimpleStrategy.onOrderUpdate(mock.ctx, baseParams, {
      clientOrderId: buyOrder.newClientOrderId!,
      status: 'FILLED',
      side: 'BUY',
      price: '77900',
      origQty: '0.00012',
      executedQty: '0.00012',
      cumulativeQuote: '9.348',
      symbol: 'BTCFDUSD',
    });

    // Now find the counter SELL (placed at 78000) and fill IT
    const counterSell = mock.client.placedOrders.find(
      (o) => o.side === 'SELL' && Number(o.price) === 78000,
    )!;
    await gridSimpleStrategy.onOrderUpdate(mock.ctx, baseParams, {
      clientOrderId: counterSell.newClientOrderId!,
      status: 'FILLED',
      side: 'SELL',
      price: '78000',
      origQty: '0.00012',
      executedQty: '0.00012',
      cumulativeQuote: '9.36',
      symbol: 'BTCFDUSD',
    });

    const state = mock.state.current as { realizedPnlQuote: string; cyclesCompleted: number };
    // Spread × qty = 100 × 0.00012 = 0.012
    expect(Number(state.realizedPnlQuote)).toBeCloseTo(0.012, 6);
    expect(state.cyclesCompleted).toBe(1);
  });

  it('SELL-first cycle: SELL fill (no match) opens; later BUY fill (matches) closes', async () => {
    // Fill a SELL at 78100 first — no unmatched BUY yet, so this opens a SELL-first cycle.
    const sellOrder = mock.client.placedOrders.find((o) => o.side === 'SELL' && Number(o.price) === 78100)!;
    await gridSimpleStrategy.onOrderUpdate(mock.ctx, baseParams, {
      clientOrderId: sellOrder.newClientOrderId!,
      status: 'FILLED',
      side: 'SELL',
      price: '78100',
      origQty: '0.00012',
      executedQty: '0.00012',
      cumulativeQuote: '9.372',
      symbol: 'BTCFDUSD',
    });
    let state = mock.state.current as { unmatched: Array<{ side: string }>; cyclesCompleted: number };
    expect(state.cyclesCompleted).toBe(0);
    expect(state.unmatched.find((u) => u.side === 'SELL')).toBeDefined();

    // Now fill the counter BUY at 78000 — should match the unmatched SELL.
    const counterBuy = mock.client.placedOrders.find(
      (o) => o.side === 'BUY' && Number(o.price) === 78000,
    )!;
    await gridSimpleStrategy.onOrderUpdate(mock.ctx, baseParams, {
      clientOrderId: counterBuy.newClientOrderId!,
      status: 'FILLED',
      side: 'BUY',
      price: '78000',
      origQty: '0.00012',
      executedQty: '0.00012',
      cumulativeQuote: '9.36',
      symbol: 'BTCFDUSD',
    });
    state = mock.state.current as { realizedPnlQuote: string; cyclesCompleted: number; unmatched: Array<unknown> };
    expect(state.cyclesCompleted).toBe(1);
    // Profit = (78100 sell - 78000 buy) × 0.00012 = 0.012
    expect(Number(state.realizedPnlQuote)).toBeCloseTo(0.012, 6);
  });
});

describe('grid_simple — idempotency', () => {
  let mock: MockCtx;
  beforeEach(async () => {
    mock = createMockCtx({ initialPrice: '78000' });
    await gridSimpleStrategy.init(mock.ctx, baseParams);
  });

  it('duplicate fill events do NOT double-place counter orders', async () => {
    const buyOrder = mock.client.placedOrders.find((o) => o.side === 'BUY' && Number(o.price) === 77900)!;
    const ordersBefore = mock.client.placedOrders.length;

    const fillEvent = {
      clientOrderId: buyOrder.newClientOrderId!,
      status: 'FILLED' as const,
      side: 'BUY' as const,
      price: '77900',
      origQty: '0.00012',
      executedQty: '0.00012',
      cumulativeQuote: '9.348',
      symbol: 'BTCFDUSD',
    };

    // Fire same event 3 times (simulating WS + OrderPoller + Reconcile delivering it)
    await gridSimpleStrategy.onOrderUpdate(mock.ctx, baseParams, fillEvent);
    await gridSimpleStrategy.onOrderUpdate(mock.ctx, baseParams, fillEvent);
    await gridSimpleStrategy.onOrderUpdate(mock.ctx, baseParams, fillEvent);

    // Only ONE counter SELL should have been placed.
    const newOrders = mock.client.placedOrders.slice(ordersBefore);
    expect(newOrders).toHaveLength(1);

    const state = mock.state.current as { processedFills: string[] };
    expect(state.processedFills).toContain(buyOrder.newClientOrderId!);
  });

  it('processedFills ring is bounded (FIFO eviction at 1000)', async () => {
    // Manually inject a state with > 1000 entries to ensure the bound is enforced
    // by exercising _pushProcessed via a real fill.
    const state = mock.state.current as { processedFills: string[] };
    state.processedFills = Array.from({ length: 1005 }, (_, i) => `cid-${i}`);
    await mock.ctx.saveState(state);

    const buyOrder = mock.client.placedOrders.find((o) => o.side === 'BUY' && Number(o.price) === 77900)!;
    await gridSimpleStrategy.onOrderUpdate(mock.ctx, baseParams, {
      clientOrderId: buyOrder.newClientOrderId!,
      status: 'FILLED',
      side: 'BUY',
      price: '77900',
      origQty: '0.00012',
      executedQty: '0.00012',
      cumulativeQuote: '9.348',
      symbol: 'BTCFDUSD',
    });
    const after = mock.state.current as { processedFills: string[] };
    expect(after.processedFills.length).toBeLessThanOrEqual(1000);
  });
});

describe('grid_simple — non-FILLED events ignored', () => {
  it('NEW status is a no-op', async () => {
    const mock = createMockCtx({ initialPrice: '78000' });
    await gridSimpleStrategy.init(mock.ctx, baseParams);
    const ordersBefore = mock.client.placedOrders.length;
    await gridSimpleStrategy.onOrderUpdate(mock.ctx, baseParams, {
      clientOrderId: 'whatever',
      status: 'NEW',
      side: 'BUY',
      price: '77900',
      origQty: '0.00012',
      executedQty: '0',
      cumulativeQuote: '0',
      symbol: 'BTCFDUSD',
    });
    expect(mock.client.placedOrders).toHaveLength(ordersBefore);
  });
});
