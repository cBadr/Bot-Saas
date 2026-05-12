import type { BinanceClient, SymbolFilters } from '@orca/exchange';
import type { OrcaLogger } from '@orca/logger';
import type { StrategyContext } from '@orca/strategies';
import { prisma, Prisma } from '@orca/db';
import type Redis from 'ioredis';
import { ENGINE_EVENT_CHANNEL, type EngineEvent } from '../bridge/channels';

interface BuildContextArgs {
  botId: string;
  /** Active run id — events and state version key derived from this. */
  botRunId?: string;
  symbol: string;
  filters: SymbolFilters;
  client: BinanceClient;
  logger: OrcaLogger;
  redis: Redis;
}

export function buildStrategyContext(args: BuildContextArgs): StrategyContext {
  const { botId, botRunId, symbol, filters, client, logger, redis } = args;

  return {
    botId,
    symbol,
    filters,
    client,
    logger,

    async saveState(state: unknown) {
      await prisma.bot.update({
        where: { id: botId },
        // Setting state to null clears the saved state (used on stop()).
        data: { state: state === null ? Prisma.JsonNull : (state as object) },
      });
    },

    async loadState<T = unknown>(): Promise<T | undefined> {
      const bot = await prisma.bot.findUnique({
        where: { id: botId },
        select: { state: true },
      });
      return (bot?.state as T | null) ?? undefined;
    },

    /**
     * Cancel ONLY orders this bot placed (tracked in DB), not all symbol orders.
     * Uses batchCancelOrders (parallel HTTP, concurrency=20) so even a 100-order
     * grid takes <1s instead of >30s sequential.
     *
     * NOTE: Spot has no native batch cancel + we deliberately do NOT use
     * DELETE /api/v3/openOrders (which would also kill manual trades / other bots).
     */
    async cancelMyOrders(): Promise<number> {
      const open = await prisma.order.findMany({
        where: {
          botId,
          status: { in: ['NEW', 'PARTIALLY_FILLED', 'PENDING_CANCEL'] },
        },
        select: { clientOrderId: true, symbol: true },
      });
      if (open.length === 0) return 0;

      // Group by symbol (typically just one).
      const bySymbol = new Map<string, string[]>();
      for (const o of open) {
        const arr = bySymbol.get(o.symbol) ?? [];
        arr.push(o.clientOrderId);
        bySymbol.set(o.symbol, arr);
      }

      const t0 = Date.now();
      let cancelled = 0;
      let alreadyGone = 0;
      let failed = 0;
      for (const [symbol, cids] of bySymbol) {
        const results = await client.batchCancelOrders(symbol, cids, { concurrency: 20 });
        for (let i = 0; i < results.length; i++) {
          const r = results[i]!;
          if (r.ok) {
            cancelled++;
          } else {
            // -2011 "Unknown order sent" = order was already filled/cancelled.
            // -2013 = same. Either way, not a real failure for our purposes.
            const err = r.error as { response?: { data?: { code?: number } } };
            const code = err.response?.data?.code;
            if (code === -2011 || code === -2013) {
              alreadyGone++;
            } else {
              failed++;
              logger.warn('Cancel failed', {
                clientOrderId: cids[i],
                err: r.error instanceof Error ? r.error.message : String(r.error),
              });
            }
          }
        }
      }
      logger.info('Bot orders cancellation summary', {
        total: open.length, cancelled, alreadyGone, failed, ms: Date.now() - t0,
      });
      return cancelled;
    },

    async emit(type: string, message: string, data?: Record<string, unknown>) {
      logger.info(`[evt] ${type}: ${message}`, data);
      await prisma.botEvent.create({
        data: {
          botId,
          ...(botRunId ? { botRunId } : {}),
          type,
          message,
          ...(data ? { data: data as object } : {}),
        },
      });
      const evt: EngineEvent = { type: 'BOT_EVENT', botId, event: type, data };
      await redis.publish(ENGINE_EVENT_CHANNEL, JSON.stringify(evt));
    },
  };
}
