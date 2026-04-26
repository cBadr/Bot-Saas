import 'reflect-metadata';
import http from 'node:http';
import Redis from 'ioredis';
import { env } from '@orca/config';
import { binanceTimeSync } from '@orca/exchange';
import { createLogger } from '@orca/logger';
import { prisma } from '@orca/db';
import { RunnerManager } from './runners/runner-manager';
import { CommandListener } from './listeners/command-listener';

process.env.ORCA_SERVICE_NAME = 'orca-engine';
const log = createLogger('SYSTEM', { module: 'EngineBootstrap' });

async function main() {
  log.info('Orca Engine starting...');

  // ─── Time Sync ───
  await binanceTimeSync.start();
  log.info('Time sync ready', { offsetMs: binanceTimeSync.getOffset() });

  // ─── Redis ───
  const subscriber = new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
    db: env.REDIS_DB,
    maxRetriesPerRequest: null,
  });
  const publisher = new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
    db: env.REDIS_DB,
  });
  await Promise.all([
    new Promise<void>((res) => subscriber.once('ready', () => res())),
    new Promise<void>((res) => publisher.once('ready', () => res())),
  ]);
  log.info('Redis connected');

  // ─── Runner Manager ───
  const manager = new RunnerManager(publisher);
  const listener = new CommandListener(subscriber, manager);
  await listener.start();

  // ─── Resume previously running bots ───
  await manager.resumeAll();

  // ─── Health HTTP server (for monitoring + Nginx checks) ───
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        service: 'orca-engine',
        runningBots: manager.size(),
        binanceOffsetMs: binanceTimeSync.getOffset(),
        ts: new Date().toISOString(),
      }));
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(env.ENGINE_PORT, () => {
    log.info(`🤖 Engine ready on port ${env.ENGINE_PORT}`);
  });

  // ─── Graceful shutdown ───
  const shutdown = async (signal: string) => {
    log.warn(`Received ${signal}, shutting down...`);
    server.close();
    await manager.stopAll('Engine shutdown');
    binanceTimeSync.stop();
    await subscriber.quit();
    await publisher.quit();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    log.error('Unhandled rejection', { reason: String(reason) });
  });
  process.on('uncaughtException', (err) => {
    log.fatal('Uncaught exception', { err: err.message, stack: err.stack });
  });
}

main().catch((err) => {
  log.fatal('Bootstrap failed', { err: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
