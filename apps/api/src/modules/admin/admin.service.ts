import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { UserRole, UserStatus } from '@orca/db';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Stats ───
  async stats() {
    const [users, bots, runningBots, totalPayments, completedPayments, mrr] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.bot.count(),
      this.prisma.bot.count({ where: { status: 'RUNNING' } }),
      this.prisma.payment.count(),
      this.prisma.payment.count({ where: { status: 'COMPLETED' } }),
      this.prisma.subscription.findMany({
        where: { status: 'ACTIVE' },
        include: { plan: { select: { priceUsd: true, billingCycleDays: true } } },
      }),
    ]);
    const monthlyRecurring = mrr.reduce((sum, s) => {
      const monthly = (Number(s.plan.priceUsd) * 30) / s.plan.billingCycleDays;
      return sum + monthly;
    }, 0);
    return {
      users,
      bots: { total: bots, running: runningBots },
      payments: { total: totalPayments, completed: completedPayments },
      mrr: monthlyRecurring,
      ts: new Date().toISOString(),
    };
  }

  // ─── Users ───
  listUsers(opts: { search?: string; limit?: number; offset?: number } = {}) {
    return this.prisma.user.findMany({
      where: opts.search
        ? { OR: [{ email: { contains: opts.search, mode: 'insensitive' } }, { fullName: { contains: opts.search, mode: 'insensitive' } }] }
        : undefined,
      select: {
        id: true, email: true, fullName: true, role: true, status: true,
        createdAt: true, lastLoginAt: true,
        _count: { select: { bots: true, apiKeys: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(200, opts.limit ?? 50),
      skip: opts.offset ?? 0,
    });
  }

  async setUserRole(id: string, role: UserRole) {
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u) throw new NotFoundException('User not found');
    return this.prisma.user.update({ where: { id }, data: { role }, select: { id: true, role: true } });
  }

  async setUserStatus(id: string, status: UserStatus) {
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u) throw new NotFoundException('User not found');
    return this.prisma.user.update({ where: { id }, data: { status }, select: { id: true, status: true } });
  }

  // ─── Plans ───
  listPlansAll() {
    return this.prisma.plan.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  async createPlan(data: {
    code: string; name: string; description?: string;
    priceUsd: number; billingCycleDays: number;
    maxBots: number; maxApiKeys: number; maxCustomStrategies: number;
    sortOrder?: number; isActive?: boolean;
  }) {
    return this.prisma.plan.create({ data });
  }

  updatePlan(id: string, data: Partial<{
    name: string; description: string; priceUsd: number; billingCycleDays: number;
    maxBots: number; maxApiKeys: number; maxCustomStrategies: number;
    sortOrder: number; isActive: boolean;
  }>) {
    return this.prisma.plan.update({ where: { id }, data });
  }

  // ─── Settings ───
  listSettings() { return this.prisma.appSetting.findMany({ orderBy: { key: 'asc' } }); }

  setSetting(key: string, value: unknown, isPublic = false, category?: string) {
    return this.prisma.appSetting.upsert({
      where: { key },
      create: { key, value: value as object, isPublic, category },
      update: { value: value as object, isPublic, category },
    });
  }

  // ─── Feature Flags ───
  listFlags() { return this.prisma.featureFlag.findMany({ orderBy: { key: 'asc' } }); }

  setFlag(key: string, data: { enabled?: boolean; rolloutPct?: number; allowList?: string[]; description?: string }) {
    return this.prisma.featureFlag.upsert({
      where: { key },
      create: {
        key,
        enabled: data.enabled ?? false,
        rolloutPct: data.rolloutPct ?? 0,
        allowList: data.allowList ?? [],
        description: data.description,
      },
      update: data,
    });
  }
}
