import { randomUUID } from 'node:crypto';
import { Decimal, roundToTickSize, roundToStepSize } from '@orca/shared';
import { validateOrder } from '@orca/exchange';
import type { Strategy, StrategyContext, StrategyOrderEvent } from '../base';
import { GridParamsSchema, type GridParams } from './params';

interface GridLevel {
  index: number;
  price: string;
  buyClientOrderId?: string;
  sellClientOrderId?: string;
  /** Whether this level currently holds inventory (i.e. a buy was filled). */
  hasInventory: boolean;
  /** Quantity of base asset held at this level. */
  quantity: string;
}

interface GridState {
  levels: GridLevel[];
  active: boolean;
  triggered: boolean;
  /** Highest price reached when trailing-up/trailing-stop is enabled. */
  highWaterPrice?: string;
  /** Number of completed BUY→SELL cycles (round-trips). */
  cyclesCompleted: number;
  /** Whether initial position bootstrap has been done. */
  initialPositionDone: boolean;
}

/**
 * Grid Trading Strategy v1
 *
 * Modes:
 *  - arithmetic: equal price step between levels
 *  - geometric:  multiplier-based spacing (level_n = lowerPrice * mult^n)
 *
 * Logic:
 *  - Place BUY limit orders at every level <= currentPrice
 *  - Place SELL limit orders at every level >  currentPrice (only if inventory exists)
 *  - When BUY fills:  place SELL one level above
 *  - When SELL fills: place BUY one level below
 *  - Each fill captures the spacing as profit (minus zero fees on FDUSD)
 */
export class GridStrategy implements Strategy<GridParams> {
  readonly key = 'grid_v1';

  validateParams(raw: unknown): GridParams {
    return GridParamsSchema.parse(raw);
  }

  private buildLevels(params: GridParams, ctx: StrategyContext): GridLevel[] {
    const levels: GridLevel[] = [];
    const tick = ctx.filters.tickSize;
    const lower = new Decimal(params.lowerPrice);

    const push = (i: number, raw: Decimal) => levels.push({
      index: i,
      price: roundToTickSize(raw, tick),
      hasInventory: false,
      quantity: '0',
    });

    if (params.spacingMode === 'arithmetic') {
      const step = new Decimal(params.upperPrice).minus(lower).div(params.gridLevels - 1);
      for (let i = 0; i < params.gridLevels; i++) push(i, lower.plus(step.mul(i)));
    } else if (params.spacingMode === 'fixed_dollar') {
      const step = new Decimal(params.spacingDollar!);
      for (let i = 0; i < params.gridLevels; i++) push(i, lower.plus(step.mul(i)));
    } else {
      // geometric
      let mult = params.priceMultiplier;
      if (!mult) {
        mult = new Decimal(params.upperPrice).div(lower)
          .pow(new Decimal(1).div(params.gridLevels - 1)).toNumber();
      }
      for (let i = 0; i < params.gridLevels; i++) push(i, lower.mul(new Decimal(mult).pow(i)));
    }
    return levels;
  }

  /**
   * Quote allocated per BUY at a given level index, applying orderSizeMultiplier.
   * If multiplier=1 → equal slicing. If multiplier=1.2 → each higher level gets
   * 20% more quote than the previous one. We normalize so the SUM still equals
   * totalQuoteInvestment.
   */
  private quotePerOrder(params: GridParams, levelIndex: number): Decimal {
    const m = new Decimal(params.orderSizeMultiplier ?? 1);
    if (m.eq(1)) {
      return new Decimal(params.totalQuoteInvestment).div(params.gridLevels);
    }
    // Geometric series sum: S = base * (m^N - 1) / (m - 1)
    // We want sum = totalQuoteInvestment. Solve for `base`:
    //   base = totalQuoteInvestment * (m - 1) / (m^N - 1)
    const N = params.gridLevels;
    const total = new Decimal(params.totalQuoteInvestment);
    const denom = m.pow(N).minus(1);
    const base = total.mul(m.minus(1)).div(denom);
    return base.mul(m.pow(levelIndex));
  }

  private qtyAt(price: string, params: GridParams, levelIndex: number, ctx: StrategyContext): string {
    const qty = this.quotePerOrder(params, levelIndex).div(price);
    return roundToStepSize(qty, ctx.filters.stepSize);
  }

  async init(ctx: StrategyContext, params: GridParams): Promise<void> {
    const existing = await ctx.loadState<GridState>();
    if (existing) {
      // Reconcile saved state with actual Binance open orders. If Binance has
      // no open orders for this symbol but our state expects them (because the
      // engine restarted ungracefully), re-place them.
      try {
        const openOrders = await ctx.client.getOpenOrders(ctx.symbol);
        const expectedOpen = existing.levels.filter(
          (l) => l.buyClientOrderId || l.sellClientOrderId,
        ).length;
        if (expectedOpen > 0 && openOrders.length === 0) {
          ctx.logger.warn('Saved state expects open orders but Binance has none — re-placing', {
            expectedOpen,
          });
          await ctx.emit('GRID_RECONCILED', 'Re-placing orders: state was stale');
          // Reset all level order IDs and re-place from current price
          for (const l of existing.levels) {
            l.buyClientOrderId = undefined;
            l.sellClientOrderId = undefined;
          }
          const ticker = await ctx.client.getTickerPrice(ctx.symbol);
          await this.placeInitialOrders(ctx, params, existing, ticker.price);
          await ctx.saveState(existing);
          return;
        }
      } catch (err) {
        ctx.logger.error('Reconciliation failed, continuing with saved state', { err: String(err) });
      }
      ctx.logger.info('Resuming grid from saved state', {
        levels: existing.levels.length,
        active: existing.active,
      });
      await ctx.emit('GRID_RESUMED', `Resumed with ${existing.levels.length} levels`);
      return;
    }

    const ticker = await ctx.client.getTickerPrice(ctx.symbol);
    const liveTickerPrice = ticker.price;
    // Anchor price = explicit override OR live ticker
    const anchorPrice = params.anchorPrice ? String(params.anchorPrice) : liveTickerPrice;

    const levels = this.buildLevels(params, ctx);
    const state: GridState = {
      levels,
      active: !params.gridTriggerPrice,
      triggered: !params.gridTriggerPrice,
      highWaterPrice: liveTickerPrice,
      cyclesCompleted: 0,
      initialPositionDone: false,
    };

    const spacingDesc = params.spacingMode === 'fixed_dollar'
      ? `$${params.spacingDollar} per level`
      : params.spacingMode;

    await ctx.emit('GRID_INITIALIZED',
      `Built ${levels.length} levels (${params.gridMode}) with ${spacingDesc} spacing`, {
      lowerPrice: params.lowerPrice,
      upperPrice: params.upperPrice,
      spacing: params.spacingMode,
      gridMode: params.gridMode,
      anchorPrice,
      liveTickerPrice,
    });

    if (!state.active) {
      await ctx.emit('GRID_ARMED', `Grid armed, waiting for trigger ${params.gridTriggerPrice}`);
      await ctx.saveState(state);
      return;
    }

    // ─── Use existing free balance as inventory (preferred path) ───
    if (params.useExistingInventory) {
      try {
        const acct = await ctx.client.getAccount();
        const baseAsset = ctx.filters.baseAsset;
        const bal = acct.balances.find((b) => b.asset === baseAsset);
        const free = new Decimal(bal?.free ?? '0');
        const usable = free.mul(params.existingInventoryPct).div(100);
        const sellLevels = levels.filter((l) => new Decimal(l.price).gt(anchorPrice));
        if (usable.lte(0)) {
          ctx.logger.warn('useExistingInventory enabled but no free balance', { baseAsset });
          await ctx.emit('GRID_NO_INVENTORY',
            `No free ${baseAsset} balance — SELL side will be empty until BUYs fill`);
        } else if (sellLevels.length === 0) {
          ctx.logger.warn('No SELL levels above anchor to seed', { anchor: anchorPrice });
        } else {
          const qtyPerSell = roundToStepSize(
            usable.div(sellLevels.length), ctx.filters.stepSize,
          );
          for (const l of sellLevels) {
            l.hasInventory = true;
            l.quantity = qtyPerSell;
          }
          state.initialPositionDone = true;
          await ctx.emit('GRID_USE_EXISTING',
            `Using ${usable.toString()} ${baseAsset} (${params.existingInventoryPct}% of free balance) across ${sellLevels.length} SELL levels`,
            { baseAsset, freeBalance: free.toString(), usable: usable.toString(),
              sellLevels: sellLevels.length, qtyPerSell });
        }
      } catch (err) {
        ctx.logger.error('Failed to fetch balance for existing-inventory mode', { err: String(err) });
      }
    } else if (params.initialPositionPct > 0) {
      const initialQuote = new Decimal(params.totalQuoteInvestment)
        .mul(params.initialPositionPct).div(100);
      const buyPrice = roundToTickSize(liveTickerPrice, ctx.filters.tickSize);
      const buyQty = roundToStepSize(initialQuote.div(buyPrice), ctx.filters.stepSize);
      const v = validateOrder(ctx.filters, buyPrice, buyQty);
      if (v.ok) {
        const cid = `orca-${ctx.botId.slice(0, 8)}-init-${randomUUID().slice(0, 8)}`;
        try {
          const res = await ctx.client.placeOrder({
            symbol: ctx.symbol, side: 'BUY', type: 'LIMIT', timeInForce: 'GTC',
            price: buyPrice, quantity: buyQty, newClientOrderId: cid,
          });
          // Distribute initial inventory across SELL levels above anchor
          const sellLevels = levels.filter((l) => new Decimal(l.price).gt(anchorPrice));
          const qtyPerSell = sellLevels.length > 0
            ? new Decimal(buyQty).div(sellLevels.length)
            : new Decimal(0);
          for (const l of sellLevels) {
            l.hasInventory = true;
            l.quantity = roundToStepSize(qtyPerSell, ctx.filters.stepSize);
          }
          state.initialPositionDone = true;
          await ctx.emit('GRID_INITIAL_POSITION',
            `Initial market BUY ${buyQty} @ ${buyPrice} (${params.initialPositionPct}% of investment)`,
            { exchangeOrderId: res.orderId, willEnableSells: sellLevels.length });
        } catch (err) {
          ctx.logger.error('Initial position buy failed', { err: String(err) });
        }
      } else {
        ctx.logger.warn('Initial position skipped: validation failed', { reason: v.reason });
      }
    }

    await this.placeInitialOrders(ctx, params, state, anchorPrice);
    await ctx.saveState(state);
  }

  /**
   * Places BUY orders for levels below the anchor and SELL orders for levels
   * above the anchor that have inventory (from initial position bootstrap).
   * In 'short' mode, also places SELLs for levels above anchor (assuming user
   * already holds the base asset in their wallet).
   */
  private async placeInitialOrders(
    ctx: StrategyContext,
    params: GridParams,
    state: GridState,
    anchorPriceStr: string,
  ): Promise<void> {
    const anchor = new Decimal(anchorPriceStr);
    const specs: { level: GridLevel; side: 'BUY' | 'SELL'; qty: string }[] = [];

    // ─── Build all specs synchronously (no I/O) ───
    for (const level of state.levels) {
      const lvlPrice = new Decimal(level.price);
      const isAboveAnchor = lvlPrice.gt(anchor);
      const isBelowAnchor = lvlPrice.lt(anchor);

      if (isBelowAnchor && params.gridMode !== 'short' && !level.buyClientOrderId) {
        const qty = this.qtyAt(level.price, params, level.index, ctx);
        const v = validateOrder(ctx.filters, level.price, qty);
        if (!v.ok) {
          ctx.logger.warn('Skipping invalid BUY level', { price: level.price, reason: v.reason });
        } else {
          specs.push({ level, side: 'BUY', qty });
        }
      }

      if (isAboveAnchor && params.gridMode !== 'long' && !level.sellClientOrderId) {
        let sellQty = level.quantity;
        if (params.gridMode === 'short' && !level.hasInventory) {
          sellQty = this.qtyAt(level.price, params, level.index, ctx);
          level.hasInventory = true;
          level.quantity = sellQty;
        }
        if (new Decimal(sellQty).gt(0)) {
          const v = validateOrder(ctx.filters, level.price, sellQty);
          if (!v.ok) {
            ctx.logger.warn('Skipping invalid SELL level', { price: level.price, reason: v.reason });
          } else {
            specs.push({ level, side: 'SELL', qty: sellQty });
          }
        }
      }
    }

    if (specs.length === 0) return;

    // ─── Fire all orders in parallel (Binance allows ~50 orders/10s/symbol) ───
    // Chunk to stay under burst limits while keeping latency near ~1 RTT.
    const CHUNK_SIZE = 20;
    const t0 = Date.now();
    let placed = 0, failed = 0;
    for (let i = 0; i < specs.length; i += CHUNK_SIZE) {
      const chunk = specs.slice(i, i + CHUNK_SIZE);
      const results = await Promise.allSettled(
        chunk.map((s) => this.placeOrder(ctx, s.level, s.side, s.qty)),
      );
      for (const r of results) {
        if (r.status === 'fulfilled') placed++;
        else failed++;
      }
    }
    ctx.logger.info('Initial grid orders placed', {
      total: specs.length, placed, failed, ms: Date.now() - t0,
    });
  }

  private async placeOrder(
    ctx: StrategyContext,
    level: GridLevel,
    side: 'BUY' | 'SELL',
    qty: string,
  ): Promise<void> {
    const cid = `orca-${ctx.botId.slice(0, 8)}-${side === 'BUY' ? 'b' : 's'}${level.index}-${randomUUID().slice(0, 8)}`;
    // One short retry for transient errors (rate-limit, network); skip for terminal ones.
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await ctx.client.placeOrder({
          symbol: ctx.symbol, side, type: 'LIMIT', timeInForce: 'GTC',
          price: level.price, quantity: qty, newClientOrderId: cid,
        });
        if (side === 'BUY') level.buyClientOrderId = cid;
        else level.sellClientOrderId = cid;
        // Fire-and-forget emit so we don't serialize on log/socket I/O
        void ctx.emit('ORDER_PLACED', `${side} @ ${level.price}`, {
          level: level.index, side, price: level.price, quantity: qty,
          clientOrderId: cid, exchangeOrderId: res.orderId,
        });
        return;
      } catch (err) {
        lastErr = err;
        const msg = String(err);
        // Terminal errors — don't retry
        if (
          msg.includes('insufficient balance') ||
          msg.includes('-2010') || // INSUFFICIENT_BALANCE
          msg.includes('-1013') || // MIN_NOTIONAL / LOT_SIZE
          msg.includes('-1111') || // bad precision
          msg.includes('-2011')    // unknown order
        ) {
          break;
        }
        // Transient — short backoff then retry once
        if (attempt === 0) await new Promise((r) => setTimeout(r, 250));
      }
    }
    ctx.logger.error(`Failed to place ${side}`, {
      err: String(lastErr), level: level.index, price: level.price, qty,
    });
    throw lastErr;
  }

  async onOrderUpdate(
    ctx: StrategyContext,
    params: GridParams,
    event: StrategyOrderEvent,
  ): Promise<void> {
    if (event.status !== 'FILLED') return;
    const state = (await ctx.loadState<GridState>())!;
    const level = state.levels.find(
      (l) => l.buyClientOrderId === event.clientOrderId || l.sellClientOrderId === event.clientOrderId,
    );
    if (!level) return;

    if (event.side === 'BUY' && level.buyClientOrderId === event.clientOrderId) {
      level.hasInventory = true;
      level.quantity = event.executedQty;
      level.buyClientOrderId = undefined;
      await ctx.emit('BUY_FILLED', `BUY filled @ ${event.price}`, {
        level: level.index,
        price: event.price,
        quantity: event.executedQty,
      });
      // Place SELL one level above
      const upper = state.levels.find((l) => l.index === level.index + 1);
      if (upper) {
        const cid = `orca-${ctx.botId.slice(0, 8)}-s${upper.index}-${randomUUID().slice(0, 8)}`;
        try {
          const res = await ctx.client.placeOrder({
            symbol: ctx.symbol,
            side: 'SELL',
            type: 'LIMIT',
            timeInForce: 'GTC',
            price: upper.price,
            quantity: level.quantity,
            newClientOrderId: cid,
          });
          upper.sellClientOrderId = cid;
          await ctx.emit('ORDER_PLACED', `SELL @ ${upper.price}`, {
            level: upper.index,
            side: 'SELL',
            price: upper.price,
            quantity: level.quantity,
            exchangeOrderId: res.orderId,
          });
        } catch (err) {
          ctx.logger.error('Failed to place SELL after BUY fill', { err: String(err) });
        }
      }
    } else if (event.side === 'SELL' && level.sellClientOrderId === event.clientOrderId) {
      level.sellClientOrderId = undefined;
      level.hasInventory = false;
      level.quantity = '0';
      state.cyclesCompleted += 1;
      await ctx.emit('SELL_FILLED', `SELL filled @ ${event.price} (cycle #${state.cyclesCompleted})`, {
        level: level.index,
        price: event.price,
        quantity: event.executedQty,
        cyclesCompleted: state.cyclesCompleted,
      });
      // Stop after N cycles?
      if (params.stopAfterCycles && state.cyclesCompleted >= params.stopAfterCycles) {
        await ctx.emit('GRID_STOP_AFTER_CYCLES',
          `Reached ${state.cyclesCompleted}/${params.stopAfterCycles} cycles — stopping`);
        await ctx.cancelMyOrders();
        await ctx.saveState(null);
        return;
      }
      // Mark the level below as having no inventory & re-arm BUY
      const lower = state.levels.find((l) => l.index === level.index - 1);
      if (lower) {
        lower.hasInventory = false;
        lower.quantity = '0';
        const qty = this.qtyAt(lower.price, params, lower.index, ctx);
        const v = validateOrder(ctx.filters, lower.price, qty);
        if (v.ok) {
          const cid = `orca-${ctx.botId.slice(0, 8)}-b${lower.index}-${randomUUID().slice(0, 8)}`;
          try {
            const res = await ctx.client.placeOrder({
              symbol: ctx.symbol,
              side: 'BUY',
              type: 'LIMIT',
              timeInForce: 'GTC',
              price: lower.price,
              quantity: qty,
              newClientOrderId: cid,
            });
            lower.buyClientOrderId = cid;
            await ctx.emit('ORDER_PLACED', `BUY re-armed @ ${lower.price}`, {
              level: lower.index,
              side: 'BUY',
              price: lower.price,
              quantity: qty,
              exchangeOrderId: res.orderId,
            });
          } catch (err) {
            ctx.logger.error('Failed to re-arm BUY after SELL fill', { err: String(err) });
          }
        }
      }
    }

    await ctx.saveState(state);
  }

  async onTick(ctx: StrategyContext, params: GridParams, lastPrice: string): Promise<void> {
    const state = await ctx.loadState<GridState>();
    if (!state) return;

    // TP / SL hard exits
    if (params.takeProfitPrice && new Decimal(lastPrice).gte(params.takeProfitPrice)) {
      ctx.logger.warn('Take-profit triggered, stopping bot', { lastPrice });
      await ctx.emit('TAKE_PROFIT_HIT', `Last price ${lastPrice} >= TP ${params.takeProfitPrice}`);
      await this.stop(ctx, params);
      return;
    }
    if (params.stopLossPrice && new Decimal(lastPrice).lte(params.stopLossPrice)) {
      ctx.logger.warn('Stop-loss triggered, stopping bot', { lastPrice });
      await ctx.emit('STOP_LOSS_HIT', `Last price ${lastPrice} <= SL ${params.stopLossPrice}`);
      await this.stop(ctx, params);
      return;
    }

    // Trigger activation
    if (
      !state.active &&
      params.gridTriggerPrice &&
      new Decimal(lastPrice).gte(params.gridTriggerPrice)
    ) {
      state.active = true;
      state.triggered = true;
      await this.placeInitialOrders(ctx, params, state, lastPrice);
      await ctx.saveState(state);
      await ctx.emit('GRID_TRIGGERED', `Grid activated @ ${lastPrice}`);
    }

    // Update high-water mark
    const last = new Decimal(lastPrice);
    if (!state.highWaterPrice || last.gt(state.highWaterPrice)) {
      state.highWaterPrice = lastPrice;
      await ctx.saveState(state);
    }

    // Trailing stop: exit if price drops X% from running peak
    if (params.trailingStopPct && state.highWaterPrice) {
      const peak = new Decimal(state.highWaterPrice);
      const dropPct = peak.minus(last).div(peak).mul(100).toNumber();
      if (dropPct >= params.trailingStopPct) {
        ctx.logger.warn('Trailing stop triggered', { dropPct, peak: state.highWaterPrice, last: lastPrice });
        await ctx.emit('TRAILING_STOP_HIT',
          `Price dropped ${dropPct.toFixed(2)}% from peak ${state.highWaterPrice}`);
        await this.stop(ctx, params);
        return;
      }
    }
  }

  async stop(ctx: StrategyContext, _params: GridParams): Promise<void> {
    try {
      await ctx.cancelMyOrders();
      await ctx.emit('GRID_STOPPED', 'Cancelled all open orders');
    } catch (err) {
      ctx.logger.error('Failed to cancel orders on stop', { err: String(err) });
    }
    // Clear saved state so next start re-builds the grid from scratch
    // (otherwise resuming would skip placing orders since state thinks they exist).
    try { await ctx.saveState(null); } catch {}
  }
}

export const gridStrategy = new GridStrategy();
