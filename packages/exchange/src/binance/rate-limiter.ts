import type Redis from 'ioredis';
import { env } from '@orca/config';
import { RateLimitError } from '@orca/shared';

/**
 * Distributed Sliding Window Rate Limiter using Redis sorted sets.
 * Three independent buckets per API key:
 *   - REQUESTS:   per minute  (Binance default 1200, we use 1100 for safety)
 *   - ORDERS_10S: per 10 seconds
 *   - ORDERS_DAY: per 24 hours
 */
export type RateLimitScope = 'REQUEST' | 'ORDER';

interface BucketDef {
  windowMs: number;
  limit: number;
  key: string;
}

export class BinanceRateLimiter {
  constructor(private readonly redis: Redis) {}

  private buckets(apiKeyId: string, scope: RateLimitScope): BucketDef[] {
    if (scope === 'REQUEST') {
      return [
        {
          windowMs: 60_000,
          limit: env.BINANCE_REQUESTS_PER_MINUTE,
          key: `rl:bnc:req:1m:${apiKeyId}`,
        },
      ];
    }
    return [
      {
        windowMs: 10_000,
        limit: env.BINANCE_ORDERS_PER_10_SECONDS,
        key: `rl:bnc:ord:10s:${apiKeyId}`,
      },
      {
        windowMs: 86_400_000,
        limit: env.BINANCE_ORDERS_PER_DAY,
        key: `rl:bnc:ord:1d:${apiKeyId}`,
      },
      {
        windowMs: 60_000,
        limit: env.BINANCE_REQUESTS_PER_MINUTE,
        key: `rl:bnc:req:1m:${apiKeyId}`,
      },
    ];
  }

  async consume(apiKeyId: string, scope: RateLimitScope, weight = 1): Promise<void> {
    const now = Date.now();
    for (const bucket of this.buckets(apiKeyId, scope)) {
      const cutoff = now - bucket.windowMs;
      const member = `${now}:${Math.random().toString(36).slice(2, 8)}`;
      const pipeline = this.redis.multi();
      pipeline.zremrangebyscore(bucket.key, 0, cutoff);
      pipeline.zcard(bucket.key);
      pipeline.zadd(bucket.key, now, member);
      pipeline.pexpire(bucket.key, bucket.windowMs + 1000);
      const results = await pipeline.exec();
      if (!results) throw new Error('Rate limiter pipeline failed');
      const count = Number(results[1]?.[1] ?? 0) + weight;
      if (count > bucket.limit) {
        await this.redis.zrem(bucket.key, member);
        throw new RateLimitError(bucket.key, bucket.windowMs);
      }
    }
  }

  async getUsage(apiKeyId: string): Promise<Record<string, number>> {
    const buckets = [
      ...this.buckets(apiKeyId, 'REQUEST'),
      ...this.buckets(apiKeyId, 'ORDER'),
    ];
    const out: Record<string, number> = {};
    const now = Date.now();
    for (const b of buckets) {
      await this.redis.zremrangebyscore(b.key, 0, now - b.windowMs);
      out[b.key] = await this.redis.zcard(b.key);
    }
    return out;
  }
}
