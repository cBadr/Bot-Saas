import { Controller, Get } from '@nestjs/common';
import { binanceTimeSync } from '@orca/exchange';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  async overall() {
    const [db, rds] = await Promise.allSettled([this.checkDb(), this.checkRedis()]);
    const checks = {
      db: db.status === 'fulfilled' ? db.value : { ok: false, error: String(db.reason) },
      redis: rds.status === 'fulfilled' ? rds.value : { ok: false, error: String(rds.reason) },
      binance: { ok: binanceTimeSync.getLastSyncedAt() > 0, offsetMs: binanceTimeSync.getOffset() },
    };
    const ok = Object.values(checks).every((c) => c.ok);
    return { ok, checks, ts: new Date().toISOString() };
  }

  private async checkDb() {
    const t0 = Date.now();
    await this.prisma.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - t0 };
  }

  private async checkRedis() {
    const t0 = Date.now();
    const r = await this.redis.client.ping();
    return { ok: r === 'PONG', latencyMs: Date.now() - t0 };
  }
}
