import { prisma } from '@orca/db';
import { BinanceRateLimiter } from '@orca/exchange';
import { createLogger } from '@orca/logger';
import { env } from '@orca/config';
import type Redis from 'ioredis';
import { BotRunner } from './bot-runner';

const log = createLogger('BOT', { module: 'RunnerManager' });

export class RunnerManager {
  private readonly runners = new Map<string, BotRunner>();
  private readonly rateLimiter: BinanceRateLimiter;

  constructor(private readonly redis: Redis) {
    this.rateLimiter = new BinanceRateLimiter(redis);
  }

  size(): number {
    return this.runners.size;
  }

  /** On engine boot: resume any bots that were RUNNING/STARTING. */
  async resumeAll(): Promise<void> {
    const bots = await prisma.bot.findMany({
      where: { status: { in: ['RUNNING', 'STARTING'] } },
      select: { id: true, name: true },
    });
    log.info(`Resuming ${bots.length} bot(s)`);
    for (const bot of bots) {
      await this.startBot(bot.id).catch((err) =>
        log.error('Resume failed', { botId: bot.id, err: String(err) }),
      );
    }
  }

  async startBot(botId: string): Promise<void> {
    if (this.runners.has(botId)) {
      log.warn('Bot already running', { botId });
      return;
    }
    if (this.runners.size >= env.ENGINE_MAX_BOTS_PER_WORKER) {
      throw new Error(`Worker capacity reached (${env.ENGINE_MAX_BOTS_PER_WORKER})`);
    }
    const runner = new BotRunner(botId, this.redis, this.rateLimiter);
    this.runners.set(botId, runner);
    try {
      await runner.start();
    } catch (err) {
      this.runners.delete(botId);
      await runner.fail(err);
      throw err;
    }
  }

  async stopBot(botId: string, reason = 'Manual stop'): Promise<void> {
    const runner = this.runners.get(botId);
    if (!runner) {
      log.warn('Stop requested for non-running bot', { botId });
      // Still update DB to STOPPED if it was stuck
      await prisma.bot.updateMany({
        where: { id: botId, status: { in: ['RUNNING', 'STARTING', 'PAUSED', 'STOPPING'] } },
        data: { status: 'STOPPED', stoppedAt: new Date() },
      });
      return;
    }
    await runner.stop(reason);
    this.runners.delete(botId);
  }

  async stopUserBots(userId: string, reason = 'User emergency stop'): Promise<void> {
    const bots = await prisma.bot.findMany({
      where: { userId },
      select: { id: true },
    });
    await Promise.allSettled(bots.map((b: { id: string }) => this.stopBot(b.id, reason)));
  }

  async stopAll(reason = 'Engine shutdown'): Promise<void> {
    const ids = Array.from(this.runners.keys());
    log.info(`Stopping all (${ids.length})`);
    await Promise.allSettled(ids.map((id) => this.stopBot(id, reason)));
  }
}
