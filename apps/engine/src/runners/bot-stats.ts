import { prisma } from '@orca/db';
import { Decimal } from '@orca/shared';

/**
 * Recompute bot aggregate stats from full Trade history using
 * weighted-average cost basis. Persists realizedPnl per Trade row.
 *
 * - On BUY:  newAvgCost = (held*avg + qty*price) / (held+qty)
 * - On SELL: pnl = (sellPrice - avgCost) * qty;  avgCost stays
 *
 * This is correct enough for spot trading; more accurate FIFO/LIFO
 * could be implemented later if needed for tax reporting.
 */
export async function updateBotStats(botId: string): Promise<void> {
  const trades = await prisma.trade.findMany({
    where: { botId },
    orderBy: { executedAt: 'asc' },
  });

  let baseHeld = new Decimal(0);
  let avgCost = new Decimal(0);
  let realized = new Decimal(0);
  let volume = new Decimal(0);

  // Track which trades need realizedPnl persisted
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
      // BUY trades have no realized PnL
      if (t.realizedPnl === null || !new Decimal(t.realizedPnl.toString()).eq(0)) {
        updates.push({ id: t.id, pnl: '0' });
      }
    } else {
      // SELL: P&L = (sellPrice - avgCost) * qty
      const pnl = price.minus(avgCost).mul(qty);
      realized = realized.plus(pnl);
      baseHeld = baseHeld.minus(qty);
      const pnlStr = pnl.toFixed(18);
      if (t.realizedPnl === null || !new Decimal(t.realizedPnl.toString()).eq(pnlStr)) {
        updates.push({ id: t.id, pnl: pnlStr });
      }
    }
  }

  // Persist per-trade realizedPnl in batch
  if (updates.length > 0) {
    await prisma.$transaction(
      updates.map((u) =>
        prisma.trade.update({
          where: { id: u.id },
          data: { realizedPnl: u.pnl },
        }),
      ),
    );
  }

  // Update bot aggregates
  await prisma.bot.update({
    where: { id: botId },
    data: {
      totalTrades: trades.length,
      totalVolumeQuote: volume.toFixed(18),
      realizedPnlQuote: realized.toFixed(18),
    },
  });
}

/**
 * Recompute stats for all bots that have trades. Useful for migrations
 * or one-off backfills (e.g. after upgrading the stats algorithm).
 */
export async function recomputeAllBotStats(): Promise<{ updated: number }> {
  const botIds = await prisma.trade.findMany({
    distinct: ['botId'],
    select: { botId: true },
  });
  for (const { botId } of botIds) {
    await updateBotStats(botId);
  }
  return { updated: botIds.length };
}
