import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { BinanceRateLimiter, createBinanceClient } from '@orca/exchange';
import { createLogger } from '@orca/logger';
import { encryptSecret, decryptSecret } from '@orca/shared';
import { env } from '@orca/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';

const log = createLogger('AUTH', { module: 'ExchangeKeys' });
const encSecret = env.ENCRYPTION_SECRET ?? env.AUTH_SECRET;

@Injectable()
export class ExchangeKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  list(userId: string) {
    return this.prisma.exchangeApiKey.findMany({
      where: { userId },
      select: {
        id: true, label: true, exchange: true, status: true,
        permissions: true, lastCheckedAt: true, lastError: true,
        createdAt: true,
        // Mask API key for display
        apiKey: true,
      },
      orderBy: { createdAt: 'desc' },
    }).then((rows) =>
      rows.map((r) => ({
        ...r,
        apiKey: maskKey(safeDecrypt(r.apiKey)),
      })),
    );
  }

  async create(userId: string, dto: { label: string; apiKey: string; apiSecret: string }) {
    const created = await this.prisma.exchangeApiKey.create({
      data: {
        userId,
        label: dto.label,
        apiKey: encryptSecret(dto.apiKey, encSecret),
        apiSecret: encryptSecret(dto.apiSecret, encSecret),
        exchange: 'BINANCE',
      },
      select: {
        id: true, label: true, status: true, createdAt: true, apiKey: true,
      },
    });
    log.info('API key added (encrypted)', { userId, apiKeyId: created.id });
    return { ...created, apiKey: maskKey(dto.apiKey) };
  }

  async remove(userId: string, id: string) {
    const k = await this.prisma.exchangeApiKey.findUnique({ where: { id } });
    if (!k) throw new NotFoundException('API key not found');
    if (k.userId !== userId) throw new ForbiddenException();
    const inUse = await this.prisma.bot.count({
      where: { apiKeyId: id, status: { in: ['RUNNING', 'STARTING', 'PAUSED'] } },
    });
    if (inUse > 0) {
      throw new ForbiddenException(`API key in use by ${inUse} active bot(s)`);
    }
    await this.prisma.exchangeApiKey.delete({ where: { id } });
    return { success: true };
  }

  async test(userId: string, id: string) {
    const k = await this.prisma.exchangeApiKey.findUnique({ where: { id } });
    if (!k || k.userId !== userId) throw new NotFoundException('API key not found');
    const limiter = new BinanceRateLimiter(this.redis.client);
    const client = createBinanceClient(
      {
        apiKeyId: k.id,
        apiKey: decryptSecret(k.apiKey, encSecret),
        apiSecret: decryptSecret(k.apiSecret, encSecret),
      },
      limiter,
    );
    try {
      const acct = await client.getAccount();
      const nonZero = acct.balances.filter((b) => Number(b.free) + Number(b.locked) > 0);
      await this.prisma.exchangeApiKey.update({
        where: { id },
        data: {
          status: 'ACTIVE',
          lastCheckedAt: new Date(),
          lastError: null,
          permissions: { canTrade: acct.canTrade, accountType: acct.accountType },
        },
      });
      return {
        ok: true,
        canTrade: acct.canTrade,
        accountType: acct.accountType,
        balances: nonZero,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.prisma.exchangeApiKey.update({
        where: { id },
        data: { status: 'INVALID', lastCheckedAt: new Date(), lastError: message },
      });
      return { ok: false, error: message };
    }
  }

  /** Returns the free balance of a specific asset for this API key. */
  async assetBalance(userId: string, id: string, asset: string) {
    const k = await this.prisma.exchangeApiKey.findUnique({ where: { id } });
    if (!k || k.userId !== userId) throw new NotFoundException('API key not found');
    const limiter = new BinanceRateLimiter(this.redis.client);
    const client = createBinanceClient(
      {
        apiKeyId: k.id,
        apiKey: decryptSecret(k.apiKey, encSecret),
        apiSecret: decryptSecret(k.apiSecret, encSecret),
      },
      limiter,
    );
    const acct = await client.getAccount();
    const bal = acct.balances.find((b) => b.asset === asset);
    return {
      asset,
      free: bal?.free ?? '0',
      locked: bal?.locked ?? '0',
    };
  }
}

function maskKey(k: string): string {
  if (k.length <= 8) return '***';
  return `${k.slice(0, 4)}...${k.slice(-4)}`;
}

function safeDecrypt(v: string): string {
  try { return decryptSecret(v, encSecret); } catch { return v; }
}
