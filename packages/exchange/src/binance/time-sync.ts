import { request } from 'undici';
import { env } from '@orca/config';
import { createLogger } from '@orca/logger';
import { BINANCE_ENDPOINTS } from '@orca/shared';

const log = createLogger('BINANCE', { module: 'TimeSync' });

/**
 * Maintains a continuously refreshed offset between local clock and Binance server time.
 * All signed requests must use timestamp = Date.now() + offset.
 */
class BinanceTimeSync {
  private offset = 0;
  private lastSyncedAt = 0;
  private timer?: NodeJS.Timeout;
  private syncing = false;

  async start(): Promise<void> {
    await this.syncNow();
    this.timer = setInterval(() => {
      void this.syncNow().catch((err) => log.error('Time sync failed', { err: String(err) }));
    }, env.BINANCE_TIME_SYNC_INTERVAL_MS);
    if (this.timer.unref) this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async syncNow(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const url = `${env.BINANCE_BASE_URL}${BINANCE_ENDPOINTS.TIME}`;
      const t0 = Date.now();
      const res = await request(url, { method: 'GET' });
      const body = (await res.body.json()) as { serverTime: number };
      const t1 = Date.now();
      const rtt = t1 - t0;
      // Adjust serverTime by half the round-trip
      const estimatedServerTime = body.serverTime + Math.floor(rtt / 2);
      this.offset = estimatedServerTime - t1;
      this.lastSyncedAt = t1;
      log.debug('Time synced with Binance', {
        offsetMs: this.offset,
        rttMs: rtt,
        serverTime: body.serverTime,
      });
    } finally {
      this.syncing = false;
    }
  }

  getOffset(): number {
    return this.offset;
  }

  now(): number {
    return Date.now() + this.offset;
  }

  getLastSyncedAt(): number {
    return this.lastSyncedAt;
  }
}

export const binanceTimeSync = new BinanceTimeSync();
