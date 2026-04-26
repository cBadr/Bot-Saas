import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(userId: string) {
    const bots = await this.prisma.bot.findMany({
      where: { userId },
      select: {
        id: true, name: true, symbol: true, status: true,
        totalTrades: true, totalVolumeQuote: true,
        realizedPnlQuote: true, unrealizedPnlQuote: true,
      },
    });
    const totalPnl = bots.reduce((s, b) => s + Number(b.realizedPnlQuote), 0);
    const totalUnrealized = bots.reduce((s, b) => s + Number(b.unrealizedPnlQuote), 0);
    const totalVolume = bots.reduce((s, b) => s + Number(b.totalVolumeQuote), 0);
    const totalTrades = bots.reduce((s, b) => s + b.totalTrades, 0);
    const running = bots.filter((b) => b.status === 'RUNNING').length;
    return {
      totals: { realizedPnl: totalPnl, unrealizedPnl: totalUnrealized, volume: totalVolume, trades: totalTrades },
      bots: { total: bots.length, running },
      perBot: bots,
    };
  }

  /** Daily P&L over last N days using trade timestamps. */
  async pnlSeries(userId: string, days = 30) {
    const since = new Date(Date.now() - days * 86_400_000);
    const trades = await this.prisma.trade.findMany({
      where: { bot: { userId }, executedAt: { gte: since } },
      select: { executedAt: true, side: true, quoteQuantity: true, realizedPnl: true },
      orderBy: { executedAt: 'asc' },
    });
    const buckets = new Map<string, { date: string; pnl: number; volume: number; count: number }>();
    for (const t of trades) {
      const day = t.executedAt.toISOString().slice(0, 10);
      const cur = buckets.get(day) ?? { date: day, pnl: 0, volume: 0, count: 0 };
      cur.pnl += Number(t.realizedPnl ?? 0);
      cur.volume += Number(t.quoteQuantity);
      cur.count += 1;
      buckets.set(day, cur);
    }
    return Array.from(buckets.values());
  }

  async botPerformance(userId: string, botId: string) {
    const bot = await this.prisma.bot.findFirst({ where: { id: botId, userId } });
    if (!bot) return null;
    const trades = await this.prisma.trade.findMany({
      where: { botId },
      orderBy: { executedAt: 'asc' },
    });
    const winCount = trades.filter((t) => Number(t.realizedPnl ?? 0) > 0).length;
    const lossCount = trades.filter((t) => Number(t.realizedPnl ?? 0) < 0).length;
    const winRate = trades.length ? (winCount / trades.length) * 100 : 0;
    let runningPnl = 0;
    let peak = 0;
    let maxDrawdown = 0;
    const equityCurve = trades.map((t) => {
      runningPnl += Number(t.realizedPnl ?? 0);
      peak = Math.max(peak, runningPnl);
      maxDrawdown = Math.max(maxDrawdown, peak - runningPnl);
      return { ts: t.executedAt.toISOString(), pnl: runningPnl };
    });
    return {
      bot: { id: bot.id, name: bot.name, symbol: bot.symbol, status: bot.status },
      stats: {
        totalTrades: trades.length,
        winCount, lossCount, winRate,
        finalPnl: runningPnl,
        maxDrawdown,
      },
      equityCurve,
    };
  }
}
