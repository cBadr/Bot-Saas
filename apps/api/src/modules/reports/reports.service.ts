import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BotsService } from '../bots/bots.service';

/**
 * Reports service — uses the SAME authoritative live-stats path as the
 * dashboard / bots list. P&L numbers are sourced from each bot's strategy
 * state (`realizedPnlQuote`, `cyclesCompleted`) and computed unrealized,
 * NOT from `Bot.realizedPnlQuote` (which is legacy weighted-avg basis).
 *
 * Time series are derived from `BotEvent` cycle-close events
 * (BUY_FILLED / SELL_FILLED / DCA_*_FILLED with `data.cycleClosed=true`)
 * which carry the per-cycle PnL exactly as the strategy realized it.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bots: BotsService,
  ) {}

  // ─── Overview ────────────────────────────────────────────────────

  async overview(userId: string) {
    const enriched = await this.bots.list(userId);

    const sum = (selector: (b: typeof enriched[number]) => number) =>
      enriched.reduce((acc, b) => acc + (Number.isFinite(selector(b)) ? selector(b) : 0), 0);

    const realized = sum((b) => b.liveStats?.realized ?? 0);
    const unrealized = sum((b) => b.liveStats?.unrealized ?? 0);
    const total = realized + unrealized;
    const cycles = sum((b) => b.liveStats?.cyclesCompleted ?? 0);
    const investment = sum((b) => b.liveStats?.totalInvestment ?? 0);
    const volume = sum((b) => b.liveStats?.totalVolumeQuote ?? 0);
    const trades = sum((b) => b.liveStats?.tradeCount ?? 0);
    const heldQty = sum((b) => b.liveStats?.heldQty ?? 0);
    const running = enriched.filter((b) => b.status === 'RUNNING' || b.status === 'STARTING').length;
    const stopped = enriched.filter((b) => b.status === 'STOPPED').length;
    const errored = enriched.filter((b) => b.status === 'ERROR').length;

    // Win rate by counting closed-cycle BotEvents with positive cyclePnl.
    // We use BotEvents instead of Trade rows because the new strategies
    // record per-cycle PnL there (legacy Trade.realizedPnl is weighted-avg).
    const cycleEvents = await this.prisma.botEvent.findMany({
      where: {
        bot: { userId },
        type: { in: ['BUY_FILLED', 'SELL_FILLED', 'DCA_BUY_FILLED', 'DCA_SELL_FILLED'] },
      },
      select: { data: true },
      take: 10_000, // safety cap
    });
    let wins = 0;
    let losses = 0;
    for (const e of cycleEvents) {
      const data = (e.data ?? {}) as { cycleClosed?: boolean; cyclePnl?: string | number };
      if (!data.cycleClosed) continue;
      const pnl = Number(data.cyclePnl ?? 0);
      if (pnl > 0) wins++;
      else if (pnl < 0) losses++;
    }
    const decided = wins + losses;
    const winRate = decided > 0 ? (wins / decided) * 100 : null;

    const roiPct = investment > 0 ? (realized / investment) * 100 : null;
    const avgPerCycle = cycles > 0 ? realized / cycles : null;

    return {
      totals: {
        realized,
        unrealized,
        total,
        volume,
        trades,
        cycles,
        investment,
        heldQty,
        wins,
        losses,
        winRate,
        roiPct,
        avgPerCycle,
      },
      bots: { total: enriched.length, running, stopped, errored },
    };
  }

  // ─── Daily P&L series (cycle-close events) ───────────────────────

  /**
   * Daily aggregates over the last `days` days, derived from cycle-close
   * BotEvents. Each bucket includes:
   *   - pnl: sum of cycle PnLs that day
   *   - cycles: count of cycles closed
   *   - cumulative: running cumulative PnL up to and including this day
   * Days with no cycles are still emitted (with zeros) for a continuous chart.
   */
  async pnlSeries(userId: string, days = 30) {
    const since = new Date(Date.now() - days * 86_400_000);
    since.setHours(0, 0, 0, 0);

    const events = await this.prisma.botEvent.findMany({
      where: {
        bot: { userId },
        type: { in: ['BUY_FILLED', 'SELL_FILLED', 'DCA_BUY_FILLED', 'DCA_SELL_FILLED'] },
        createdAt: { gte: since },
      },
      select: { createdAt: true, data: true },
      orderBy: { createdAt: 'asc' },
    });

    // Volume / trade-count series — these come from Trade rows.
    const trades = await this.prisma.trade.findMany({
      where: { bot: { userId }, executedAt: { gte: since } },
      select: { executedAt: true, quoteQuantity: true },
    });

    // Bucket by day (YYYY-MM-DD).
    type Bucket = { date: string; pnl: number; cycles: number; volume: number; trades: number };
    const buckets = new Map<string, Bucket>();
    const dayKey = (d: Date) => d.toISOString().slice(0, 10);

    // Pre-fill empty days so the chart line is continuous.
    for (let i = 0; i < days; i++) {
      const d = new Date(since.getTime() + i * 86_400_000);
      const key = dayKey(d);
      buckets.set(key, { date: key, pnl: 0, cycles: 0, volume: 0, trades: 0 });
    }

    // Cycle PnLs.
    for (const e of events) {
      const data = (e.data ?? {}) as { cycleClosed?: boolean; cyclePnl?: string | number };
      if (!data.cycleClosed) continue;
      const key = dayKey(e.createdAt);
      const cur = buckets.get(key) ?? { date: key, pnl: 0, cycles: 0, volume: 0, trades: 0 };
      cur.pnl += Number(data.cyclePnl ?? 0);
      cur.cycles += 1;
      buckets.set(key, cur);
    }

    // Volume + trade count.
    for (const t of trades) {
      const key = dayKey(t.executedAt);
      const cur = buckets.get(key) ?? { date: key, pnl: 0, cycles: 0, volume: 0, trades: 0 };
      cur.volume += Number(t.quoteQuantity);
      cur.trades += 1;
      buckets.set(key, cur);
    }

    // Sort + add cumulative.
    const sorted = [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
    let running = 0;
    return sorted.map((b) => {
      running += b.pnl;
      return { ...b, cumulative: running };
    });
  }

  // ─── Per-bot breakdown ───────────────────────────────────────────

  /**
   * Compact per-bot performance row sourced from authoritative liveStats.
   * Used for the Reports table.
   */
  async perBotBreakdown(userId: string) {
    const enriched = await this.bots.list(userId);
    return enriched.map((b) => ({
      id: b.id,
      name: b.name,
      symbol: b.symbol,
      status: b.status,
      strategy: b.strategy?.name ?? null,
      direction: ((b.params as Record<string, unknown> | null | undefined)?.direction as string | undefined) ?? null,
      paperTrading: b.paperTrading ?? false,
      cycles: b.liveStats?.cyclesCompleted ?? 0,
      realized: b.liveStats?.realized ?? 0,
      unrealized: b.liveStats?.unrealized ?? 0,
      total: b.liveStats?.total ?? 0,
      volume: b.liveStats?.totalVolumeQuote ?? 0,
      trades: b.liveStats?.tradeCount ?? 0,
      investment: b.liveStats?.totalInvestment ?? 0,
      roi: b.liveStats?.totalInvestment
        ? ((b.liveStats?.realized ?? 0) / b.liveStats.totalInvestment) * 100
        : null,
      startedAt: b.startedAt,
      createdAt: b.createdAt,
    }));
  }

  // ─── Symbol breakdown ────────────────────────────────────────────

  /**
   * Aggregate by trading pair across all the user's bots: cycles, volume,
   * realized P&L. Useful to spot which pair is most profitable.
   */
  async symbolBreakdown(userId: string) {
    const enriched = await this.bots.list(userId);
    type Row = {
      symbol: string;
      bots: number;
      realized: number;
      total: number;
      volume: number;
      cycles: number;
    };
    const map = new Map<string, Row>();
    for (const b of enriched) {
      const cur = map.get(b.symbol) ?? {
        symbol: b.symbol, bots: 0, realized: 0, total: 0, volume: 0, cycles: 0,
      };
      cur.bots += 1;
      cur.realized += b.liveStats?.realized ?? 0;
      cur.total += b.liveStats?.total ?? 0;
      cur.volume += b.liveStats?.totalVolumeQuote ?? 0;
      cur.cycles += b.liveStats?.cyclesCompleted ?? 0;
      map.set(b.symbol, cur);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }

  // ─── Best / worst day ────────────────────────────────────────────

  /** Identifies the single best and worst PnL day in the requested window. */
  async bestWorstDay(userId: string, days = 30) {
    const series = await this.pnlSeries(userId, days);
    if (series.length === 0) return { best: null, worst: null };
    let best = series[0]!;
    let worst = series[0]!;
    for (const day of series) {
      if (day.pnl > best.pnl) best = day;
      if (day.pnl < worst.pnl) worst = day;
    }
    // Don't return zero-pnl days as best/worst when nothing happened.
    return {
      best: best.pnl > 0 ? best : null,
      worst: worst.pnl < 0 ? worst : null,
    };
  }

  // ─── Single-bot performance (existing) ───────────────────────────

  async botPerformance(userId: string, botId: string) {
    const bot = await this.prisma.bot.findFirst({ where: { id: botId, userId } });
    if (!bot) return null;

    // Pull cycle close events for this specific bot — same authoritative
    // source as the multi-bot series.
    const events = await this.prisma.botEvent.findMany({
      where: {
        botId,
        type: { in: ['BUY_FILLED', 'SELL_FILLED', 'DCA_BUY_FILLED', 'DCA_SELL_FILLED'] },
      },
      select: { createdAt: true, data: true },
      orderBy: { createdAt: 'asc' },
    });

    let runningPnl = 0;
    let peak = 0;
    let maxDrawdown = 0;
    let wins = 0;
    let losses = 0;
    const equityCurve: { ts: string; pnl: number }[] = [];
    for (const e of events) {
      const data = (e.data ?? {}) as { cycleClosed?: boolean; cyclePnl?: string | number };
      if (!data.cycleClosed) continue;
      const pnl = Number(data.cyclePnl ?? 0);
      runningPnl += pnl;
      peak = Math.max(peak, runningPnl);
      maxDrawdown = Math.max(maxDrawdown, peak - runningPnl);
      if (pnl > 0) wins++;
      else if (pnl < 0) losses++;
      equityCurve.push({ ts: e.createdAt.toISOString(), pnl: runningPnl });
    }

    const cycles = wins + losses;
    return {
      bot: { id: bot.id, name: bot.name, symbol: bot.symbol, status: bot.status },
      stats: {
        cycles,
        wins,
        losses,
        winRate: cycles > 0 ? (wins / cycles) * 100 : 0,
        finalPnl: runningPnl,
        maxDrawdown,
      },
      equityCurve,
    };
  }
}
