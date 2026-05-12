/**
 * One-time data backfill: for every existing Bot, create a synthetic Run #1
 * that captures its current lifetime stats. All historical Trades and BotEvents
 * are reassigned to this Run. The lifetime aggregates on Bot are populated
 * from the existing per-bot stats.
 *
 * Idempotent: skips bots that already have at least one BotRun.
 *
 *   pnpm --filter @orca/db tsx scripts/backfill-runs.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const bots = await prisma.bot.findMany({
    select: {
      id: true, status: true,
      params: true, startedAt: true, stoppedAt: true,
      realizedPnlQuote: true, totalTrades: true, totalVolumeQuote: true,
      _count: { select: { runs: true } },
    },
  });

  let created = 0, skipped = 0;
  for (const b of bots) {
    if (b._count.runs > 0) { skipped++; continue; }

    const startedAt = b.startedAt ?? new Date();
    const stoppedAt = b.status === 'STOPPED' ? (b.stoppedAt ?? new Date()) : null;
    const durationMs = stoppedAt && startedAt ? BigInt(stoppedAt.getTime() - startedAt.getTime()) : null;

    const aggTrades = await prisma.trade.aggregate({
      where: { botId: b.id },
      _sum: { quoteQuantity: true, commission: true },
      _count: true,
    });

    const run = await prisma.botRun.create({
      data: {
        botId: b.id,
        runNumber: 1,
        paramsSnapshot: b.params as object,
        status: b.status === 'RUNNING' ? 'RUNNING'
          : b.status === 'ERROR' ? 'ERROR' : 'STOPPED',
        startedAt,
        stoppedAt,
        stopReason: stoppedAt ? 'migration_backfill' : null,
        realizedPnl: b.realizedPnlQuote,
        cyclesCompleted: 0,
        tradesCount: aggTrades._count,
        volumeQuote: aggTrades._sum.quoteQuantity ?? 0,
        fees: aggTrades._sum.commission ?? 0,
        durationMs,
      },
    });

    // Attribute historical trades and events to this synthetic run.
    await prisma.trade.updateMany({
      where: { botId: b.id, botRunId: null },
      data: { botRunId: run.id },
    });
    await prisma.botEvent.updateMany({
      where: { botId: b.id, botRunId: null },
      data: { botRunId: run.id },
    });

    // Seed lifetime aggregates from existing bot stats.
    await prisma.bot.update({
      where: { id: b.id },
      data: {
        totalRuns: 1,
        lifetimeRealized: b.realizedPnlQuote,
        lifetimeVolume: b.totalVolumeQuote,
        lifetimeFees: aggTrades._sum.commission ?? 0,
        // Make active runs the current run (engine will pick it up on restart).
        ...(b.status === 'RUNNING' || b.status === 'STARTING'
          ? { currentRunId: run.id }
          : {}),
      },
    });

    created++;
  }

  console.log(`Backfill complete: ${created} run(s) created, ${skipped} bot(s) skipped (already had runs).`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
