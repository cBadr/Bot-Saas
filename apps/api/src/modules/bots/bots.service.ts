import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { getStrategy } from '@orca/strategies';
import { createPublicBinanceClient, extractFilters } from '@orca/exchange';
import { createLogger } from '@orca/logger';
import { Decimal } from '@orca/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ENGINE_COMMAND_CHANNEL, type EngineCommand } from './engine-bridge';

const log = createLogger('BOT', { module: 'BotsService' });

interface CreateBotInput {
  name: string;
  strategyId: string;
  apiKeyId: string;
  symbol: string;
  params: Record<string, unknown>;
  riskConfig?: Record<string, unknown>;
  paperTrading?: boolean;
  dailyLossLimit?: number;
  maxDrawdownPct?: number;
}

@Injectable()
export class BotsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(userId: string, opts: { includeArchived?: boolean } = {}) {
    const bots = await this.prisma.bot.findMany({
      where: {
        userId,
        ...(opts.includeArchived ? {} : { archivedAt: null }),
      },
      include: {
        strategy: { select: { id: true, name: true, type: true, builtinKey: true } },
        apiKey: { select: { id: true, label: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // ─── Enrich each bot with derived live stats (cycles, realized,
    //     unrealized, total profits, grid params summary) so the list
    //     page can render rich rows without N round-trips. ──────────
    //
    // We bulk-fetch ALL ticker prices in one Binance call so per-bot
    // unrealized calculation costs nothing extra.
    const symbols = [...new Set(bots.map((b) => b.symbol))];
    const priceMap = await this.bulkTickerPrices(symbols);

    // Bulk-aggregate volume per bot in a single query (groupBy).
    const volumeAgg = await this.prisma.trade.groupBy({
      by: ['botId'],
      where: { botId: { in: bots.map((b) => b.id) } },
      _sum: { quoteQuantity: true },
      _count: true,
    });
    const volumeByBot = new Map<string, { totalQuote: number; tradeCount: number }>();
    for (const v of volumeAgg) {
      volumeByBot.set(v.botId, {
        totalQuote: Number(v._sum.quoteQuantity ?? 0),
        tradeCount: v._count,
      });
    }

    return bots.map((b) => {
      const state = (b.state ?? {}) as {
        initialStartPrice?: string;
        // Grid Simple
        unmatched?: Array<{ side: 'BUY' | 'SELL'; price: string; quantity: string }>;
        unmatchedBuys?: Array<{ price: string; quantity: string }>;
        // DCA
        heldBase?: string;
        avgPrice?: string;
        // Common
        realizedPnlQuote?: string;
        cyclesCompleted?: number;
      };
      const params = (b.params ?? {}) as Record<string, unknown>;
      const builtinKey = b.strategy?.builtinKey ?? null;
      const isAnyDca = builtinKey === 'dca_simple';
      const dcaDirection = (params.direction === 'SELL' ? 'SELL' : 'BUY');

      // ─── Compute signed held inventory + weighted-avg cost ───
      // avgCost is the TRUE break-even and the correct basis for Unrealized P&L.
      // (Using initialStartPrice as a proxy is WRONG — startPrice is the grid
      // anchor, not the average price actually paid.)
      let heldQty = 0;
      let signedHeld = 0;
      let avgCost = 0;
      if (isAnyDca) {
        const dh = Number(state.heldBase ?? 0);
        heldQty = dh;
        signedHeld = dcaDirection === 'BUY' ? +dh : -dh;
        avgCost = Number(state.avgPrice ?? 0);
      } else {
        const unmatched = state.unmatched
          ?? (state.unmatchedBuys?.map((u) => ({ side: 'BUY' as const, price: u.price, quantity: u.quantity })) ?? []);
        let buyQty = 0, buyCost = 0, sellQty = 0, sellProceeds = 0;
        for (const u of unmatched) {
          const q = Number(u.quantity);
          const p = Number(u.price);
          if (u.side === 'BUY') { buyQty += q; buyCost += q * p; }
          else { sellQty += q; sellProceeds += q * p; }
        }
        heldQty = buyQty;
        signedHeld = buyQty - sellQty;
        // Long-dominant: weighted-avg BUY price. Short-dominant: weighted-avg SELL price.
        if (signedHeld > 0 && buyQty > 0) avgCost = buyCost / buyQty;
        else if (signedHeld < 0 && sellQty > 0) avgCost = sellProceeds / sellQty;
      }

      const startNum = Number(state.initialStartPrice ?? 0);
      const marketNum = Number(priceMap.get(b.symbol) ?? 0);
      const realized = Number(state.realizedPnlQuote ?? 0);
      // Unrealized = (market − avgCost) × signedHeld
      const unrealized = (avgCost > 0 && marketNum > 0 && signedHeld !== 0)
        ? (marketNum - avgCost) * signedHeld
        : 0;
      const total = realized + unrealized;
      const cycles = state.cyclesCompleted ?? 0;

      // Strategy-specific params readout
      const gridLevels = num(params.gridLevels);
      const gridSpread = num(params.gridSpread);
      const orderSize = num(params.orderSize);
      const totalInvestment = (gridLevels !== null && orderSize !== null)
        ? gridLevels * orderSize
        : num(params.totalQuoteInvestment);
      // Expected per-cycle profit:
      //   Grid:  spread × (orderSize / startPrice)
      //   DCA:   not well-defined (depends on TP%); skip
      const expectedPerCycle = (gridSpread !== null && orderSize !== null && startNum > 0)
        ? gridSpread * (orderSize / startNum)
        : null;

      const vol = volumeByBot.get(b.id) ?? { totalQuote: 0, tradeCount: 0 };

      return {
        ...b,
        marketPrice: marketNum > 0 ? marketNum.toString() : null,
        liveStats: {
          gridLevels, gridSpread, orderSize, totalInvestment, expectedPerCycle,
          cyclesCompleted: cycles,
          realized,
          unrealized,
          total,
          heldQty,
          startPrice: startNum > 0 ? startNum : null,
          totalVolumeQuote: vol.totalQuote,
          tradeCount: vol.tradeCount,
        },
        lifetimeStats: {
          totalRuns: b.totalRuns,
          realized: Number(b.lifetimeRealized),
          cycles: b.lifetimeCycles,
          volume: Number(b.lifetimeVolume),
          fees: Number(b.lifetimeFees),
        },
      };
    });
  }

  /**
   * Single Binance call to fetch all ticker prices, indexed by symbol.
   * Returns an empty Map on any error (UI handles missing prices gracefully).
   */
  private async bulkTickerPrices(symbols: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (symbols.length === 0) return map;
    try {
      const pub = createPublicBinanceClient();
      // Fetch ALL prices in a single call — much cheaper than per-symbol.
      const { request } = await import('undici');
      const r = await request(`https://api.binance.com/api/v3/ticker/price`);
      if (r.statusCode === 200) {
        const data = (await r.body.json()) as Array<{ symbol: string; price: string }>;
        for (const d of data) map.set(d.symbol, d.price);
      } else {
        // Fallback: one-by-one
        for (const s of symbols) {
          try {
            const t = await pub.getTickerPrice(s);
            map.set(s, t.price);
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      log.warn('bulkTickerPrices failed', { err: String(err) });
    }
    return map;
  }

  async get(userId: string, id: string) {
    const bot = await this.findOwned(userId, id, {
      strategy: true,
      apiKey: { select: { id: true, label: true, status: true } },
    });
    return bot;
  }

  // ─── Bot Runs (lifecycle sessions) ───
  async listRuns(userId: string, id: string) {
    await this.findOwned(userId, id);
    return this.prisma.botRun.findMany({
      where: { botId: id },
      orderBy: { runNumber: 'desc' },
      take: 200,
      select: {
        id: true, runNumber: true, status: true,
        startedAt: true, stoppedAt: true, stopReason: true,
        realizedPnl: true, unrealizedAtStop: true,
        cyclesCompleted: true, tradesCount: true,
        volumeQuote: true, fees: true,
        maxDrawdownAbs: true, durationMs: true,
        initialStartPrice: true, paramsSnapshot: true,
      },
    });
  }

  async getRun(userId: string, botId: string, runId: string) {
    await this.findOwned(userId, botId);
    const run = await this.prisma.botRun.findUnique({ where: { id: runId } });
    if (!run || run.botId !== botId) throw new NotFoundException('Run not found');
    // Pull events + a trade summary for the run for the detail view.
    const [events, tradeAgg] = await Promise.all([
      this.prisma.botEvent.findMany({
        where: { botRunId: runId },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: { id: true, type: true, message: true, createdAt: true, data: true },
      }),
      this.prisma.trade.aggregate({
        where: { botRunId: runId },
        _sum: { quoteQuantity: true, commission: true },
        _count: true,
      }),
    ]);
    return {
      run,
      events,
      tradeSummary: {
        count: tradeAgg._count,
        volume: Number(tradeAgg._sum.quoteQuantity ?? 0),
        fees: Number(tradeAgg._sum.commission ?? 0),
      },
    };
  }

  /**
   * Re-run the SAME params as a past run. Copies that run's paramsSnapshot to
   * the Bot.params and starts a new run. Bot must be STOPPED.
   */
  async replayRun(userId: string, botId: string, runId: string) {
    const bot = await this.findOwned(userId, botId);
    if (bot.status === 'RUNNING' || bot.status === 'STARTING') {
      throw new BadRequestException('Stop the bot before replaying a run');
    }
    const run = await this.prisma.botRun.findUnique({ where: { id: runId } });
    if (!run || run.botId !== botId) throw new NotFoundException('Run not found');
    await this.prisma.bot.update({
      where: { id: botId },
      data: { params: run.paramsSnapshot as object },
    });
    return this.start(userId, botId);
  }

  async archiveBot(userId: string, id: string) {
    const bot = await this.findOwned(userId, id);
    if (bot.status === 'RUNNING' || bot.status === 'STARTING') {
      throw new BadRequestException('Stop the bot before archiving');
    }
    return this.prisma.bot.update({
      where: { id },
      data: { archivedAt: new Date() },
      select: { id: true, archivedAt: true },
    });
  }

  async unarchiveBot(userId: string, id: string) {
    await this.findOwned(userId, id);
    return this.prisma.bot.update({
      where: { id },
      data: { archivedAt: null },
      select: { id: true, archivedAt: true },
    });
  }

  /** Update params — only allowed when bot is STOPPED. Changes take effect on next start. */
  async updateParams(userId: string, id: string, params: Record<string, unknown>) {
    const bot = await this.findOwned(userId, id, { strategy: true }) as { params: unknown; status: string; strategy?: { builtinKey?: string | null } };
    if (bot.status === 'RUNNING' || bot.status === 'STARTING') {
      throw new BadRequestException('Stop the bot before changing params. Changes will apply on the next run.');
    }
    // Re-validate via strategy.
    const engineKey = bot.strategy?.builtinKey ?? 'graph_v1';
    const impl = getStrategy(engineKey);
    if (impl) impl.validateParams(params);
    // Diff old vs new so the bot's event log shows what changed.
    const oldParams = (bot.params ?? {}) as Record<string, unknown>;
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const keys = new Set([...Object.keys(oldParams), ...Object.keys(params)]);
    for (const k of keys) {
      if (JSON.stringify(oldParams[k]) !== JSON.stringify(params[k])) {
        changes[k] = { from: oldParams[k], to: params[k] };
      }
    }
    const updated = await this.prisma.bot.update({
      where: { id },
      data: { params: params as object },
      select: { id: true, params: true },
    });
    // Audit trail as a bot event (visible in the activity tab + survives in DB).
    if (Object.keys(changes).length > 0) {
      await this.prisma.botEvent.create({
        data: {
          botId: id,
          type: 'PARAMS_UPDATED',
          message: `Params changed: ${Object.keys(changes).join(', ')}`,
          data: { changes } as object,
        },
      });
    }
    return updated;
  }

  async events(userId: string, id: string, limit = 100) {
    await this.findOwned(userId, id);
    return this.prisma.botEvent.findMany({
      where: { botId: id },
      orderBy: { createdAt: 'desc' },
      take: Math.min(500, limit),
    });
  }

  async orders(userId: string, id: string, limit = 100) {
    await this.findOwned(userId, id);
    return this.prisma.order.findMany({
      where: { botId: id },
      orderBy: { placedAt: 'desc' },
      take: Math.min(500, limit),
    });
  }

  /**
   * Live monitoring snapshot for the bot detail page:
   *   - current grid orders (from strategy state.orders, with status)
   *   - integrity summary (open / failed / total)
   *   - latest GRID_INTEGRITY event + when next is due
   *   - cycle stats + recent realized PnL series for the sparkline
   *
   * Designed to be polled at 5-10s intervals from the UI.
   */
  async live(userId: string, id: string) {
    const bot = await this.findOwned(userId, id, {
      strategy: { select: { builtinKey: true, name: true } },
    }) as { id: string; symbol: string; state: unknown; params: unknown; strategy?: { builtinKey?: string | null } };

    type StateOrder = {
      side: 'BUY' | 'SELL'; price: string; quantity: string; status: string;
      clientOrderId?: string; orderId?: number;
      lastError?: { code?: number; category?: string; msg?: string; ts: number };
    };
    const state = (bot.state ?? {}) as {
      initialStartPrice?: string;
      // ─ Grid Simple shape ─
      orders?: StateOrder[];
      unmatched?: Array<{ side: 'BUY' | 'SELL'; price: string; quantity: string }>;
      unmatchedBuys?: Array<{ price: string; quantity: string }>;  // legacy
      // ─ DCA Simple shape ─
      ladder?: StateOrder[];
      counter?: { side: 'BUY' | 'SELL'; price: string; quantity: string; status: string;
                  clientOrderId?: string; orderId?: number; type?: string } | null;
      // ─ DCA (legacy + simple) shape ─
      heldBase?: string;
      avgPrice?: string;
      ordersExecuted?: number;
      cooldownUntilMs?: number;
      cycleStartedAtMs?: number;
      fillsThisCycle?: number;
      // ─ Common ─
      realizedPnlQuote?: string;
      cyclesCompleted?: number;
      startedAtMs?: number;
      nextReconcileAtMs?: number;
      processedFills?: string[];
    };

    const strategyKey = bot.strategy?.builtinKey ?? null;
    const isDcaSimple = strategyKey === 'dca_simple';
    const isAnyDca = isDcaSimple;
    const params = (bot.params ?? {}) as Record<string, unknown>;
    const dcaDirection = (params.direction === 'SELL' ? 'SELL' : 'BUY') as 'BUY' | 'SELL';

    // For DCA Simple, expose ladder + counter as a unified `orders` array so
    // the LiveTradingChart can overlay them just like Grid Simple does.
    let orders: StateOrder[];
    if (isDcaSimple) {
      orders = [...(state.ladder ?? [])];
      if (state.counter) {
        orders.push({
          side: state.counter.side,
          price: state.counter.price,
          quantity: state.counter.quantity,
          status: state.counter.status,
          clientOrderId: state.counter.clientOrderId,
          orderId: state.counter.orderId,
        });
      }
    } else {
      orders = state.orders ?? [];
    }
    const breakdown: Record<string, number> = {};
    for (const o of orders) breakdown[o.status] = (breakdown[o.status] ?? 0) + 1;
    const open = breakdown['open'] ?? 0;

    // Latest integrity event
    const integrityEvent = await this.prisma.botEvent.findFirst({
      where: { botId: id, type: { in: ['GRID_INTEGRITY_OK', 'GRID_INTEGRITY_REPAIR', 'DCA_INTEGRITY_OK', 'DCA_INTEGRITY_REPAIR'] } },
      orderBy: { createdAt: 'desc' },
    });

    // ─── Inventory exposure (signed for unrealized math) ───
    let heldQty = 0;
    let soldQty = 0;
    let signedHeld = 0;

    // Weighted-average cost basis (TRUE break-even price). Used for Unrealized
    // P&L instead of initialStartPrice — startPrice is the grid anchor, NOT the
    // average price the bot actually paid for its open inventory.
    let avgCost = 0;
    if (isAnyDca) {
      // DCA (both legacy + simple) store a single positive heldBase; sign comes from direction.
      const dh = Number(state.heldBase ?? 0);
      if (dcaDirection === 'BUY') {
        heldQty = dh;
        signedHeld = +dh;
      } else {
        soldQty = dh;
        signedHeld = -dh;
      }
      avgCost = Number(state.avgPrice ?? 0);
    } else {
      // Grid Simple: derive from unmatched array (with legacy fallback).
      const unmatched = state.unmatched
        ?? (state.unmatchedBuys?.map((b) => ({
          side: 'BUY' as const, price: b.price, quantity: b.quantity,
        })) ?? []);
      let buyCost = 0, sellProceeds = 0;
      for (const u of unmatched) {
        const q = Number(u.quantity);
        const p = Number(u.price);
        if (u.side === 'BUY') { heldQty += q; buyCost += q * p; }
        else { soldQty += q; sellProceeds += q * p; }
      }
      signedHeld = heldQty - soldQty;
      // Long-dominant ⇒ avg BUY price; short-dominant ⇒ avg SELL price.
      if (signedHeld > 0 && heldQty > 0) avgCost = buyCost / heldQty;
      else if (signedHeld < 0 && soldQty > 0) avgCost = sellProceeds / soldQty;
    }

    // ─── P&L per project spec (see memory: PnL definitions) ───
    const realized = Number(state.realizedPnlQuote ?? 0);
    const cycles = state.cyclesCompleted ?? 0;

    // Live ticker + 24h stats for the prominent market banner.
    let marketPrice: string | null = null;
    let marketStats: {
      change24h: number; changePct24h: number;
      high24h: number; low24h: number;
      volume24h: number; quoteVolume24h: number;
    } | null = null;
    try {
      const { request } = await import('undici');
      const r = await request(`https://api.binance.com/api/v3/ticker/24hr?symbol=${bot.symbol}`);
      if (r.statusCode === 200) {
        const t = await r.body.json() as {
          lastPrice: string; priceChange: string; priceChangePercent: string;
          highPrice: string; lowPrice: string; volume: string; quoteVolume: string;
        };
        marketPrice = t.lastPrice;
        marketStats = {
          change24h: Number(t.priceChange),
          changePct24h: Number(t.priceChangePercent),
          high24h: Number(t.highPrice),
          low24h: Number(t.lowPrice),
          volume24h: Number(t.volume),
          quoteVolume24h: Number(t.quoteVolume),
        };
      }
    } catch {
      // Non-fatal — UI renders without 24h stats; fall back to price-only.
      try {
        const pub = createPublicBinanceClient();
        marketPrice = (await pub.getTickerPrice(bot.symbol)).price;
      } catch { /* ignore */ }
    }

    // Unrealized P&L (floating): (currentPrice − avgCost) × signedHeld.
    // avgCost is the true weighted-average price paid (BUY-dominant) or
    // received (SELL-dominant). Falls back to 0 (no unrealized) when there's
    // no open inventory yet.
    let unrealized = 0;
    const startNum = Number(state.initialStartPrice ?? 0);
    const mktNum = Number(marketPrice ?? 0);
    if (avgCost > 0 && mktNum > 0 && signedHeld !== 0) {
      unrealized = (mktNum - avgCost) * signedHeld;
    }

    const totalProfits = realized + unrealized;

    // ─── Volume + fees: total notional + commission paid across all trades ───
    const volumeAgg = await this.prisma.trade.aggregate({
      where: { botId: id },
      _sum: { quoteQuantity: true, commission: true },
      _count: true,
    });
    const totalVolume = Number(volumeAgg._sum.quoteQuantity ?? 0);
    const totalFees = Number(volumeAgg._sum.commission ?? 0);
    // Commission asset (most common one — Binance LIMIT_MAKER on FDUSD usually = 0).
    const feeAssetRow = await this.prisma.trade.findFirst({
      where: { botId: id, commissionAsset: { not: null } },
      select: { commissionAsset: true },
      orderBy: { executedAt: 'desc' },
    });
    const feeAsset = feeAssetRow?.commissionAsset ?? null;

    // Historical fill events — drive sparkline, win/loss stats, equity curve.
    //   Grid Simple: BUY_FILLED / SELL_FILLED
    //   DCA:         DCA_BUY_FILLED / DCA_SELL_FILLED
    const cycleEvents = await this.prisma.botEvent.findMany({
      where: {
        botId: id,
        type: { in: ['BUY_FILLED', 'SELL_FILLED', 'DCA_BUY_FILLED', 'DCA_SELL_FILLED'] },
      },
      orderBy: { createdAt: 'asc' },
      take: 1000,
      select: { createdAt: true, data: true },
    });
    const pnlSeries: Array<{ ts: number; pnl: number }> = [];
    let wins = 0, losses = 0;
    let grossWins = 0, grossLosses = 0;  // gross losses kept positive for profit factor
    let bestCycle = 0, worstCycle = 0;
    let peakRealized = 0, maxDrawdownAbs = 0;
    for (const e of cycleEvents) {
      const data = (e.data ?? {}) as {
        realizedPnlQuote?: string; cycleClosed?: boolean; cyclePnl?: string;
      };
      if (!data.cycleClosed) continue;
      const cumRealized = Number(data.realizedPnlQuote ?? 0);
      const cyclePnl = Number(data.cyclePnl ?? 0);
      pnlSeries.push({ ts: e.createdAt.getTime(), pnl: cumRealized });
      if (cyclePnl > 0) { wins++; grossWins += cyclePnl; if (cyclePnl > bestCycle) bestCycle = cyclePnl; }
      else if (cyclePnl < 0) { losses++; grossLosses += -cyclePnl; if (cyclePnl < worstCycle) worstCycle = cyclePnl; }
      if (cumRealized > peakRealized) peakRealized = cumRealized;
      const dd = peakRealized - cumRealized;
      if (dd > maxDrawdownAbs) maxDrawdownAbs = dd;
    }
    const wlCount = wins + losses;
    const winRate = wlCount > 0 ? wins / wlCount : null;
    const avgWin = wins > 0 ? grossWins / wins : 0;
    const avgLoss = losses > 0 ? -(grossLosses / losses) : 0;
    const profitFactor = grossLosses > 0 ? grossWins / grossLosses : (grossWins > 0 ? Number.POSITIVE_INFINITY : null);

    // Sharpe ratio over per-cycle PnL (annualized assuming ~365 cycles/year cadence).
    // Not financial-grade but useful for cross-bot comparison.
    let sharpe: number | null = null;
    const perCyclePnl: number[] = [];
    for (let i = 0; i < pnlSeries.length; i++) {
      const prev = i === 0 ? 0 : pnlSeries[i - 1].pnl;
      perCyclePnl.push(pnlSeries[i].pnl - prev);
    }
    if (perCyclePnl.length >= 2) {
      const mean = perCyclePnl.reduce((a, b) => a + b, 0) / perCyclePnl.length;
      const variance = perCyclePnl.reduce((s, v) => s + (v - mean) ** 2, 0) / (perCyclePnl.length - 1);
      const stdev = Math.sqrt(variance);
      sharpe = stdev > 0 ? (mean / stdev) * Math.sqrt(365) : null;
    }

    // Actual capital deployed = Σ buy cost of currently open inventory.
    let actualInvested = 0;
    if (isAnyDca) {
      // openCostBasis is tracked by DCA Simple directly.
      actualInvested = Number((state as { openCostBasis?: string }).openCostBasis ?? 0);
      if (actualInvested <= 0 && avgCost > 0) actualInvested = avgCost * heldQty;
    } else {
      // Grid Simple: sum unmatched buy notional (long) or sell notional (short).
      const unmatched = state.unmatched
        ?? (state.unmatchedBuys?.map((b) => ({ side: 'BUY' as const, price: b.price, quantity: b.quantity })) ?? []);
      for (const u of unmatched) {
        actualInvested += Number(u.price) * Number(u.quantity);
      }
    }
    const trueROI = actualInvested > 0 ? ((realized + unrealized) / actualInvested) * 100 : null;
    const maxDrawdownPct = peakRealized > 0 ? (maxDrawdownAbs / peakRealized) * 100 : 0;
    // Capital utilization: what % of the planned ladder is actually working.
    // (totalInvestment is computed further below; we re-compute a stub here.)

    // Recent events for the timeline (any type, latest first).
    const recentEventsRaw = await this.prisma.botEvent.findMany({
      where: { botId: id },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { id: true, type: true, message: true, createdAt: true, data: true },
    });
    const recentEvents = recentEventsRaw.map((e) => ({
      id: e.id,
      type: e.type,
      message: e.message,
      createdAt: e.createdAt,
      cyclePnl: (() => {
        const d = (e.data ?? {}) as { cyclePnl?: string };
        return d.cyclePnl ? Number(d.cyclePnl) : null;
      })(),
    }));
    // Heartbeat: when did the engine last touch this bot? > 90s = stale.
    const lastEventAtMs = recentEventsRaw[0]?.createdAt.getTime() ?? null;
    const heartbeat = {
      lastEventAtMs,
      stale: lastEventAtMs ? (Date.now() - lastEventAtMs) > 90_000 : true,
    };

    // Open-position breakdown: each unmatched fill that contributes to avgCost.
    // For Grid: list `unmatched[]` directly. For DCA: synthesize a single
    // weighted row from heldBase × avgPrice (rung-level history isn't kept).
    type OpenLeg = { side: 'BUY' | 'SELL'; price: number; qty: number; notional: number };
    const openLegs: OpenLeg[] = [];
    if (isAnyDca) {
      if (heldQty > 0 && avgCost > 0) {
        openLegs.push({
          side: dcaDirection,
          price: avgCost,
          qty: heldQty,
          notional: avgCost * heldQty,
        });
      }
    } else {
      const unmatched = state.unmatched
        ?? (state.unmatchedBuys?.map((b) => ({ side: 'BUY' as const, price: b.price, quantity: b.quantity })) ?? []);
      for (const u of unmatched) {
        const price = Number(u.price);
        const qty = Number(u.quantity);
        openLegs.push({ side: u.side, price, qty, notional: price * qty });
      }
      openLegs.sort((a, b) => b.price - a.price);
    }

    // ─── Strategy-specific derived metrics ───
    const gridLevels = num(params.gridLevels);
    const gridSpread = num(params.gridSpread);
    const orderSize = num(params.orderSize);
    const takeProfit = num(params.takeProfit);
    const priceMultMode = (params.priceMultiplierMode as string | undefined) ?? 'flat';
    const priceMultValue = num(params.priceMultiplier) ?? 0;
    const sizeMultMode = (params.sizeMultiplierMode as string | undefined) ?? 'flat';
    const sizeMultValue = num(params.sizeMultiplier) ?? 0;

    // Helper: compute (offset, sizeQuote) for ladder rung i (mirrors strategy._rungSpec)
    const rungSpec = (i: number) => {
      let offset: number;
      if (priceMultMode === 'percent') {
        const r = 1 + priceMultValue / 100;
        offset = r === 1 ? gridSpread! * i
          : gridSpread! * (Math.pow(r, i) - 1) / (r - 1);
      } else if (priceMultMode === 'dollar') {
        offset = i * gridSpread! + priceMultValue * i * (i - 1) / 2;
      } else {
        offset = gridSpread! * i;
      }
      let sizeQuote: number;
      const k = i - 1;
      if (sizeMultMode === 'percent') sizeQuote = orderSize! * Math.pow(1 + sizeMultValue / 100, k);
      else if (sizeMultMode === 'dollar') sizeQuote = orderSize! + sizeMultValue * k;
      else sizeQuote = orderSize!;
      if (sizeQuote <= 0) sizeQuote = orderSize!;
      return { offset, sizeQuote };
    };

    // Total investment (capital required for the full ladder).
    let totalInvestment: number | null = null;
    if (gridLevels !== null && orderSize !== null) {
      if (sizeMultMode === 'flat' || sizeMultValue === 0) {
        totalInvestment = gridLevels * orderSize;
      } else {
        let sum = 0;
        for (let i = 1; i <= gridLevels; i++) sum += rungSpec(i).sizeQuote;
        totalInvestment = sum;
      }
    }

    // Bot price range (low / high boundaries of the ladder around start).
    let priceRange: { low: number; high: number } | null = null;
    if (startNum > 0 && gridLevels !== null && gridSpread !== null) {
      const maxOffset = rungSpec(gridLevels).offset;
      const direction = (params.direction as string | undefined)?.toUpperCase();
      // Grid Simple is symmetric; DCA Simple ladder is one-sided.
      if (isDcaSimple) {
        if (direction === 'SELL') {
          priceRange = { low: startNum, high: startNum + maxOffset };
        } else {
          priceRange = { low: Math.max(0, startNum - maxOffset), high: startNum };
        }
      } else {
        // Grid Simple — symmetric
        priceRange = {
          low: Math.max(0, startNum - maxOffset),
          high: startNum + maxOffset,
        };
      }
    }

    // Expected profit per cycle.
    let expectedPerCycle: number | null = null;
    if (isDcaSimple && takeProfit !== null && totalInvestment !== null && startNum > 0) {
      // DCA Simple: TP × estimated total qty if all rungs fill at avg of expected fills.
      // Simpler approximation matching the form's preview: takeProfit × (totalInvestment/start).
      expectedPerCycle = takeProfit * (totalInvestment / startNum);
    } else if (!isAnyDca && gridSpread !== null && orderSize !== null && startNum > 0) {
      // Grid Simple: spread × (orderSize/start).
      expectedPerCycle = gridSpread * (orderSize / startNum);
    }

    // Estimated profit if ALL rungs fill (DCA Simple — full-ladder TP scenario).
    let estimatedProfitAllFill: number | null = null;
    if (isDcaSimple && takeProfit !== null && gridLevels !== null && orderSize !== null && startNum > 0) {
      let totalQty = 0;
      for (let i = 1; i <= gridLevels; i++) {
        const { offset, sizeQuote } = rungSpec(i);
        const direction = (params.direction as string | undefined)?.toUpperCase();
        const rungPrice = direction === 'SELL' ? startNum + offset : startNum - offset;
        if (rungPrice > 0) totalQty += sizeQuote / rungPrice;
      }
      estimatedProfitAllFill = takeProfit * totalQty;
    }

    // Break-even = weighted-avg cost basis of currently open inventory.
    //   • Long-dominant position: avg BUY price.
    //   • Short-dominant position: avg SELL proceeds (market ≤ price = profit).
    // Computed for ALL strategies (Grid Simple included — previously this was
    // gated on isAnyDca which left Grid users without a break-even readout).
    const avgPrice = avgCost > 0 ? avgCost : null;

    // Open BUY / SELL counts (current open orders only).
    const openBuyCount = orders.filter((o) => o.side === 'BUY' && o.status === 'open').length;
    const openSellCount = orders.filter((o) => o.side === 'SELL' && o.status === 'open').length;

    // Closest open rungs above/below market — useful for "how far until next fill".
    let nextBuy: { price: number; distance: number; distancePct: number } | null = null;
    let nextSell: { price: number; distance: number; distancePct: number } | null = null;
    if (mktNum > 0) {
      const openOrders = orders.filter((o) => o.status === 'open');
      const buysBelow = openOrders
        .filter((o) => o.side === 'BUY' && Number(o.price) < mktNum)
        .map((o) => Number(o.price));
      const sellsAbove = openOrders
        .filter((o) => o.side === 'SELL' && Number(o.price) > mktNum)
        .map((o) => Number(o.price));
      if (buysBelow.length) {
        const closest = Math.max(...buysBelow);
        nextBuy = { price: closest, distance: mktNum - closest, distancePct: ((mktNum - closest) / mktNum) * 100 };
      }
      if (sellsAbove.length) {
        const closest = Math.min(...sellsAbove);
        nextSell = { price: closest, distance: closest - mktNum, distancePct: ((closest - mktNum) / mktNum) * 100 };
      }
    }

    return {
      botId: bot.id,
      symbol: bot.symbol,
      strategyKey: bot.strategy?.builtinKey ?? null,
      initialStartPrice: state.initialStartPrice ?? null,
      marketPrice,
      orders: orders.map((o) => ({
        side: o.side,
        price: o.price,
        quantity: o.quantity,
        status: o.status,
        orderId: o.orderId ?? null,
        clientOrderId: o.clientOrderId ?? null,
        errorCategory: o.lastError?.category ?? null,
        errorMsg: o.lastError?.msg ?? null,
        errorCode: o.lastError?.code ?? null,
      })),
      integrity: {
        total: orders.length,
        open,
        failed: orders.length - open,
        breakdown,
        startedAtMs: state.startedAtMs ?? null,
        nextReconcileAtMs: state.nextReconcileAtMs ?? null,
        latestEvent: integrityEvent ? {
          type: integrityEvent.type,
          message: integrityEvent.message,
          createdAt: integrityEvent.createdAt,
        } : null,
      },
      currentRunId: (bot as { currentRunId?: string | null }).currentRunId ?? null,
      lifetime: {
        totalRuns: (bot as { totalRuns?: number }).totalRuns ?? 0,
        realized: Number((bot as { lifetimeRealized?: unknown }).lifetimeRealized ?? 0),
        cycles: (bot as { lifetimeCycles?: number }).lifetimeCycles ?? 0,
        volume: Number((bot as { lifetimeVolume?: unknown }).lifetimeVolume ?? 0),
        fees: Number((bot as { lifetimeFees?: unknown }).lifetimeFees ?? 0),
      },
      pnl: {
        realized,
        unrealized,
        total: totalProfits,
        cyclesCompleted: cycles,
        avgPerCycle: cycles > 0 ? realized / cycles : 0,
        series: pnlSeries,
        heldQty,
        soldQty,
        signedHeld,
        breakEvenPrice: avgPrice,
        // ─── New: true cost basis + ROI based on actually-deployed capital ───
        actualInvested,
        roi: trueROI,
        // ─── New: win/loss analytics from closed-cycle events ───
        wins,
        losses,
        winRate,
        avgWin,
        avgLoss,
        profitFactor: profitFactor === Number.POSITIVE_INFINITY ? null : profitFactor,
        bestCycle,
        worstCycle,
        maxDrawdownAbs,
        maxDrawdownPct,
        sharpe,
        // ─── New: per-leg open inventory contributing to avgCost ───
        openLegs,
      },
      volume: {
        totalQuote: totalVolume,
        tradeCount: volumeAgg._count,
        totalFees,
        feeAsset,
      },
      events: { recent: recentEvents },
      heartbeat,
      // ─── New: detailed config + derived metrics for the UI cards ───
      config: {
        direction: (params.direction as string | undefined) ?? null,
        gridLevels,
        gridSpread,
        orderSize,
        takeProfit,
        priceMultiplierMode: priceMultMode,
        priceMultiplier: priceMultValue,
        sizeMultiplierMode: sizeMultMode,
        sizeMultiplier: sizeMultValue,
        cooldownMinutes: num(params.cooldownMinutes),
        recenterAfterMinutes: num(params.recenterAfterMinutes),
        durationMinutes: num(params.durationMinutes),
        customStartPrice: num(params.customStartPrice),
      },
      derived: {
        priceRange,
        totalInvestment,
        expectedPerCycle,
        estimatedProfitAllFill,
        openBuyCount,
        openSellCount,
        nextBuy,
        nextSell,
      },
      market: marketStats,
      // Cooldown status (DCA Simple only — null for other strategies).
      cooldown: state.cooldownUntilMs && state.cooldownUntilMs > Date.now()
        ? {
            untilMs: state.cooldownUntilMs,
            secondsRemaining: Math.max(0, Math.round((state.cooldownUntilMs - Date.now()) / 1000)),
          }
        : null,
    };
  }

  async create(userId: string, dto: CreateBotInput) {
    const [strategy, apiKey] = await Promise.all([
      this.prisma.strategy.findUnique({ where: { id: dto.strategyId } }),
      this.prisma.exchangeApiKey.findUnique({ where: { id: dto.apiKeyId } }),
    ]);
    if (!strategy) throw new NotFoundException('Strategy not found');
    if (strategy.visibility === 'PRIVATE' && strategy.ownerId !== userId) {
      throw new ForbiddenException('Strategy not accessible');
    }
    if (!apiKey || apiKey.userId !== userId) throw new NotFoundException('API key not found');

    // Determine the engine key: built-in or custom (graph_v1 default for CUSTOM type).
    const engineKey = strategy.builtinKey
      ?? ((strategy.definition as Record<string, unknown> | null)?.engine as string | undefined)
      ?? 'graph_v1';

    // For graph_v1 strategies, merge the saved graph into params so the engine
    // can interpret it without re-fetching the strategy.
    let runtimeParams: Record<string, unknown> = { ...dto.params };
    if (engineKey === 'graph_v1') {
      const def = (strategy.definition ?? {}) as Record<string, unknown>;
      if (def.nodes && def.edges) {
        runtimeParams.graph = { nodes: def.nodes, edges: def.edges };
      }
    }

    // Validate via the registered strategy implementation.
    const impl = getStrategy(engineKey);
    if (impl) impl.validateParams(runtimeParams);

    // Resolve symbol metadata
    const symbol = dto.symbol.toUpperCase();
    const pub = createPublicBinanceClient();
    const ex = await pub.getExchangeInfo([symbol]);
    if (!ex.symbols.length) {
      throw new NotFoundException(`Symbol ${symbol} not found on Binance`);
    }
    const filters = extractFilters(ex.symbols[0]!);

    // Cache symbol info
    await this.prisma.exchangeSymbol.upsert({
      where: { exchange_symbol: { exchange: 'BINANCE', symbol } },
      create: {
        exchange: 'BINANCE',
        symbol,
        baseAsset: filters.baseAsset,
        quoteAsset: filters.quoteAsset,
        status: 'TRADING',
        baseAssetPrecision: filters.baseAssetPrecision,
        quoteAssetPrecision: filters.quoteAssetPrecision,
        tickSize: filters.tickSize,
        stepSize: filters.stepSize,
        minNotional: filters.minNotional,
        minQty: filters.minQty,
        maxQty: filters.maxQty,
        rawFilters: ex.symbols[0]!.filters as object,
      },
      update: {
        tickSize: filters.tickSize,
        stepSize: filters.stepSize,
        minNotional: filters.minNotional,
        minQty: filters.minQty,
        maxQty: filters.maxQty,
        rawFilters: ex.symbols[0]!.filters as object,
      },
    });

    const bot = await this.prisma.bot.create({
      data: {
        userId,
        apiKeyId: dto.apiKeyId,
        strategyId: dto.strategyId,
        name: dto.name,
        symbol,
        baseAsset: filters.baseAsset,
        quoteAsset: filters.quoteAsset,
        params: runtimeParams as object,
        ...(dto.riskConfig ? { riskConfig: dto.riskConfig as object } : {}),
        ...(dto.dailyLossLimit !== undefined ? { dailyLossLimit: String(dto.dailyLossLimit) } : {}),
        ...(dto.maxDrawdownPct !== undefined ? { maxDrawdownPct: String(dto.maxDrawdownPct) } : {}),
        paperTrading: dto.paperTrading ?? false,
        status: 'CREATED',
      },
    });
    log.info('Bot created', { userId, botId: bot.id, symbol });
    return bot;
  }

  async start(userId: string, id: string) {
    const bot = await this.findOwned(userId, id);
    if (bot.status === 'RUNNING' || bot.status === 'STARTING') return bot;
    await this.prisma.bot.update({ where: { id }, data: { status: 'STARTING' } });
    await this.publishCommand({ type: 'START', botId: id });
    void this.notifications.notify(userId, 'BOT_STARTED', `Bot "${bot.name}" started on ${bot.symbol}.`, { botId: id });
    return { ...bot, status: 'STARTING' as const };
  }

  async stop(userId: string, id: string) {
    const bot = await this.findOwned(userId, id);
    if (bot.status === 'STOPPED' || bot.status === 'STOPPING') return bot;
    await this.prisma.bot.update({ where: { id }, data: { status: 'STOPPING' } });
    await this.publishCommand({ type: 'STOP', botId: id });
    void this.notifications.notify(userId, 'BOT_STOPPED', `Bot "${bot.name}" stopped.`, { botId: id });
    return { ...bot, status: 'STOPPING' as const };
  }

  /**
   * Duplicate an existing bot. New bot is created in CREATED status with the
   * same strategy / API key / params / symbol but a new name suffix. State
   * is NOT copied (the new bot starts fresh).
   */
  async clone(userId: string, id: string, overrides?: { name?: string; symbol?: string }) {
    const src = await this.findOwned(userId, id, { strategy: true });
    const newName = overrides?.name ?? `${src.name} (copy)`;
    const newSymbol = (overrides?.symbol ?? src.symbol).toUpperCase();

    return this.create(userId, {
      name: newName,
      strategyId: src.strategyId,
      apiKeyId: src.apiKeyId,
      symbol: newSymbol,
      params: (src.params ?? {}) as Record<string, unknown>,
      riskConfig: (src.riskConfig ?? undefined) as Record<string, unknown> | undefined,
      paperTrading: src.paperTrading,
      dailyLossLimit: src.dailyLossLimit ? Number(src.dailyLossLimit) : undefined,
      maxDrawdownPct: src.maxDrawdownPct ? Number(src.maxDrawdownPct) : undefined,
    });
  }

  /**
   * Snapshot: returns a complete JSON dump (bot + state + recent events + recent trades)
   * for offline debugging or hand-off.
   */
  async snapshot(userId: string, id: string) {
    const bot = await this.findOwned(userId, id, {
      strategy: { select: { id: true, name: true, builtinKey: true } },
      apiKey: { select: { id: true, label: true } },
    });
    const [events, trades, orders] = await Promise.all([
      this.prisma.botEvent.findMany({ where: { botId: id }, orderBy: { createdAt: 'desc' }, take: 500 }),
      this.prisma.trade.findMany({ where: { botId: id }, orderBy: { executedAt: 'desc' }, take: 500 }),
      this.prisma.order.findMany({ where: { botId: id }, orderBy: { placedAt: 'desc' }, take: 500 }),
    ]);
    return {
      exportedAt: new Date().toISOString(),
      bot,
      events,
      trades,
      orders,
    };
  }

  /**
   * Export trades to CSV — common analyst format. Columns: time, side, price,
   * qty, quoteQty, commission, commissionAsset, isMaker, realizedPnl, orderId.
   */
  async exportTradesCsv(userId: string, id: string): Promise<string> {
    await this.findOwned(userId, id);
    const trades = await this.prisma.trade.findMany({
      where: { botId: id }, orderBy: { executedAt: 'asc' },
    });
    const header = ['executedAt', 'side', 'price', 'quantity', 'quoteQuantity',
      'commission', 'commissionAsset', 'isMaker', 'realizedPnl', 'exchangeTradeId'].join(',');
    const rows = trades.map((t) => [
      t.executedAt.toISOString(),
      t.side,
      t.price.toString(),
      t.quantity.toString(),
      t.quoteQuantity.toString(),
      t.commission.toString(),
      t.commissionAsset ?? '',
      t.isMaker ? '1' : '0',
      t.realizedPnl?.toString() ?? '',
      t.exchangeTradeId,
    ].map((v) => csvEscape(String(v))).join(','));
    return [header, ...rows].join('\n');
  }

  /**
   * Cancel all currently-pending orders for the bot via the engine. Useful
   * when failed orders pile up and the user wants a clean slate without
   * fully stopping the bot.
   */
  async cancelPendingOrders(userId: string, id: string) {
    const bot = await this.findOwned(userId, id);
    await this.publishCommand({ type: 'CANCEL_PENDING', botId: id });
    return { ok: true, botId: bot.id };
  }

  async remove(userId: string, id: string) {
    const bot = await this.findOwned(userId, id);
    if (bot.status === 'RUNNING' || bot.status === 'STARTING') {
      throw new ForbiddenException('Stop the bot before deleting');
    }
    await this.prisma.bot.delete({ where: { id } });
    return { success: true };
  }

  /** Emergency stop: stops ALL of a user's bots immediately. */
  async emergencyStopAll(userId: string) {
    const running = await this.prisma.bot.findMany({
      where: { userId, status: { in: ['RUNNING', 'STARTING', 'PAUSED'] } },
      select: { id: true, name: true },
    });
    await this.prisma.bot.updateMany({
      where: { id: { in: running.map((b) => b.id) } },
      data: { status: 'STOPPING' },
    });
    // Tell engine to halt them all
    await this.publishCommand({ type: 'EMERGENCY_STOP_USER', userId });
    void this.notifications.notify(
      userId,
      'BOT_STOPPED',
      `🛑 Kill switch activated — stopping ${running.length} bot(s)`,
      { kill_switch: true, count: running.length },
    );
    return { stopped: running.length, bots: running };
  }

  /** Update risk config (daily loss limit, max drawdown %) on a single bot. */
  async updateRiskConfig(
    userId: string,
    id: string,
    dto: { dailyLossLimit?: number | null; maxDrawdownPct?: number | null },
  ) {
    await this.findOwned(userId, id);
    return this.prisma.bot.update({
      where: { id },
      data: {
        dailyLossLimit:
          dto.dailyLossLimit === null ? null
          : dto.dailyLossLimit !== undefined ? String(dto.dailyLossLimit)
          : undefined,
        maxDrawdownPct:
          dto.maxDrawdownPct === null ? null
          : dto.maxDrawdownPct !== undefined ? String(dto.maxDrawdownPct)
          : undefined,
      },
      select: { id: true, dailyLossLimit: true, maxDrawdownPct: true },
    });
  }

  /** Recompute aggregate stats for a single bot from its Trade history. */
  async recomputeStats(userId: string, id: string) {
    await this.findOwned(userId, id);
    return this.recompute(id);
  }

  /** Recompute stats for ALL bots owned by a user. */
  async recomputeAllForUser(userId: string) {
    const bots = await this.prisma.bot.findMany({ where: { userId }, select: { id: true } });
    for (const b of bots) await this.recompute(b.id);
    return { updated: bots.length };
  }

  /** Internal: weighted-average cost stats computation. */
  private async recompute(botId: string) {
    const trades = await this.prisma.trade.findMany({
      where: { botId },
      orderBy: { executedAt: 'asc' },
    });

    let baseHeld = new Decimal(0);
    let avgCost = new Decimal(0);
    let realized = new Decimal(0);
    let volume = new Decimal(0);
    const updates: { id: string; pnl: string }[] = [];

    for (const t of trades) {
      const qty = new Decimal(t.quantity.toString());
      const price = new Decimal(t.price.toString());
      const quote = new Decimal(t.quoteQuantity.toString());
      volume = volume.plus(quote);

      if (t.side === 'BUY') {
        const newHeld = baseHeld.plus(qty);
        avgCost = newHeld.gt(0)
          ? baseHeld.mul(avgCost).plus(qty.mul(price)).div(newHeld)
          : price;
        baseHeld = newHeld;
        updates.push({ id: t.id, pnl: '0' });
      } else {
        const pnl = price.minus(avgCost).mul(qty);
        realized = realized.plus(pnl);
        baseHeld = baseHeld.minus(qty);
        updates.push({ id: t.id, pnl: pnl.toFixed(18) });
      }
    }

    if (updates.length > 0) {
      await this.prisma.$transaction(
        updates.map((u) =>
          this.prisma.trade.update({
            where: { id: u.id },
            data: { realizedPnl: u.pnl },
          }),
        ),
      );
    }

    const updated = await this.prisma.bot.update({
      where: { id: botId },
      data: {
        totalTrades: trades.length,
        totalVolumeQuote: volume.toFixed(18),
        realizedPnlQuote: realized.toFixed(18),
      },
      select: {
        id: true, totalTrades: true, totalVolumeQuote: true, realizedPnlQuote: true,
      },
    });
    return updated;
  }

  private async findOwned(userId: string, id: string, include?: object) {
    const bot = await this.prisma.bot.findUnique({ where: { id }, include: include as never });
    if (!bot) throw new NotFoundException('Bot not found');
    if (bot.userId !== userId) throw new ForbiddenException();
    return bot;
  }

  private async publishCommand(cmd: EngineCommand) {
    await this.redis.publisher.publish(ENGINE_COMMAND_CHANNEL, JSON.stringify(cmd));
  }
}

/** Escape a CSV field — quote when it contains comma, quote, or newline. */
function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

/** Coerce an unknown JSON value to a finite number, or null. */
function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
