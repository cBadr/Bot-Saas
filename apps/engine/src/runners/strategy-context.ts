import type { BinanceClient, SymbolFilters } from '@orca/exchange';
import type { OrcaLogger } from '@orca/logger';
import type { StrategyContext } from '@orca/strategies';
import { prisma, Prisma } from '@orca/db';
import type Redis from 'ioredis';
import { ENGINE_EVENT_CHANNEL, type EngineEvent } from '../bridge/channels';

interface BuildContextArgs {
  botId: string;
  symbol: string;
  filters: SymbolFilters;
  client: BinanceClient;
  logger: OrcaLogger;
  redis: Redis;
}

export function buildStrategyContext(args: BuildContextArgs): StrategyContext {
  const { botId, symbol, filters, client, logger, redis } = args;

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
     * Returns the number cancelled.
     */
    async cancelMyOrders(): Promise<number> {
      const open = await prisma.order.findMany({
        where: {
          botId,
          status: { in: ['NEW', 'PARTIALLY_FILLED', 'PENDING_CANCEL'] },
        },
        select: { clientOrderId: true, symbol: true },
      });
      let cancelled = 0;
      for (const o of open) {
        try {
          await client.cancelOrder({ symbol: o.symbol, origClientOrderId: o.clientOrderId });
          cancelled++;
        } catch (err) {
          // Order might already be gone (filled/cancelled out-of-band)
          logger.debug('cancelOrder failed (may already be gone)', {
            clientOrderId: o.clientOrderId,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return cancelled;
    },

    async emit(type: string, message: string, data?: Record<string, unknown>) {
      logger.info(`[evt] ${type}: ${message}`, data);
      await prisma.botEvent.create({
        data: {
          botId,
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
