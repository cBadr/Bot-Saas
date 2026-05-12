import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { nanoid } from 'nanoid';
import { env } from '@orca/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { AuthService } from '../auth/auth.service';
import { ENGINE_COMMAND_CHANNEL, type EngineCommand } from '../bots/engine-bridge';
import type { UserRole, UserStatus } from '@orca/db';

type DateRange = { from?: Date; to?: Date };
const DAY_MS = 86_400_000;

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly auth: AuthService,
  ) {}

  // ─────────────────────────── Impersonation ───────────────────────────

  async impersonate(adminUserId: string, targetUserId: string) {
    if (adminUserId === targetUserId) {
      throw new BadRequestException('Cannot impersonate yourself');
    }
    return this.auth.issueImpersonationToken(adminUserId, targetUserId);
  }

  // ─────────────────────────── Bulk user ops ───────────────────────────

  async bulkUpdateUsers(ids: string[], patch: { role?: UserRole; status?: UserStatus }) {
    if (!ids.length) return { updated: 0 };
    if (!patch.role && !patch.status) throw new BadRequestException('No fields to update');
    // If suspending, stop all their running bots too.
    if (patch.status === 'SUSPENDED') {
      const running = await this.prisma.bot.findMany({
        where: { userId: { in: ids }, status: { in: ['RUNNING', 'STARTING'] } },
        select: { id: true },
      });
      for (const b of running) await this.publishCommand({ type: 'STOP', botId: b.id });
      if (running.length) {
        await this.prisma.bot.updateMany({
          where: { id: { in: running.map((b) => b.id) } },
          data: { status: 'STOPPING' },
        });
      }
    }
    const r = await this.prisma.user.updateMany({
      where: { id: { in: ids } },
      data: patch,
    });
    return { updated: r.count };
  }

  // ─────────────────────────── Announcements ───────────────────────────

  async getAnnouncement() {
    const row = await this.prisma.appSetting.findUnique({ where: { key: 'ANNOUNCEMENT_BANNER' } });
    return (row?.value ?? null) as null | {
      enabled: boolean;
      message: string;
      severity: 'info' | 'warning' | 'critical';
      startsAt?: string;
      endsAt?: string;
    };
  }

  async setAnnouncement(input: {
    enabled: boolean;
    message: string;
    severity: 'info' | 'warning' | 'critical';
    startsAt?: string;
    endsAt?: string;
  }) {
    return this.prisma.appSetting.upsert({
      where: { key: 'ANNOUNCEMENT_BANNER' },
      create: { key: 'ANNOUNCEMENT_BANNER', value: input as object, isPublic: true, category: 'system' },
      update: { value: input as object, isPublic: true },
    });
  }

  // ─────────────────────────── Error feed ───────────────────────────

  async errorFeed(opts: { limit?: number; since?: string; level?: string } = {}) {
    const limit = Math.min(500, opts.limit ?? 100);
    const since = opts.since ? new Date(opts.since) : new Date(Date.now() - 24 * 3_600_000);

    const [systemErrors, botErrors] = await Promise.all([
      this.prisma.systemLog.findMany({
        where: {
          level: (opts.level as never) ?? { in: ['ERROR', 'FATAL'] },
          createdAt: { gte: since },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true, level: true, category: true, message: true,
          service: true, userId: true, botId: true,
          createdAt: true, data: true,
        },
      }),
      this.prisma.botEvent.findMany({
        where: {
          type: { contains: 'ERROR' },
          createdAt: { gte: since },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true, type: true, message: true, botId: true,
          createdAt: true, data: true,
          bot: { select: { name: true, symbol: true, user: { select: { email: true } } } },
        },
      }),
    ]);

    return { systemErrors, botErrors };
  }

  // ─────────────────────────── Binance API health ───────────────────────────

  async binanceHealth() {
    const since = new Date(Date.now() - 60 * 60 * 1000); // last hour
    const since24h = new Date(Date.now() - 24 * 3_600_000);

    const [recent, recent24h, slowest, recentErrors] = await Promise.all([
      this.prisma.binanceApiCallLog.aggregate({
        where: { createdAt: { gte: since } },
        _count: true,
        _avg: { durationMs: true },
        _max: { weightUsed: true },
      }),
      this.prisma.binanceApiCallLog.count({ where: { createdAt: { gte: since24h } } }),
      this.prisma.binanceApiCallLog.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { durationMs: 'desc' },
        take: 5,
        select: { endpoint: true, method: true, durationMs: true, statusCode: true, createdAt: true },
      }),
      this.prisma.binanceApiCallLog.findMany({
        where: { createdAt: { gte: since }, errorCode: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { endpoint: true, errorCode: true, errorMessage: true, createdAt: true },
      }),
    ]);

    const errorRate1h = recent._count > 0 ? (recentErrors.length / recent._count) * 100 : 0;
    return {
      calls1h: recent._count,
      calls24h: recent24h,
      avgLatencyMs: Math.round(Number(recent._avg.durationMs ?? 0)),
      maxWeight1h: recent._max.weightUsed ?? 0,
      errorRate1h,
      slowest,
      recentErrors,
    };
  }

  // ─────────────────────────── Revenue export ───────────────────────────

  async revenueExportRows() {
    const payments = await this.prisma.payment.findMany({
      where: { status: 'COMPLETED' },
      orderBy: { paidAt: 'desc' },
      include: {
        user: { select: { email: true } },
        subscription: { include: { plan: { select: { code: true, name: true } } } },
      },
      take: 10_000,
    });
    return payments.map((p) => ({
      date: p.paidAt?.toISOString() ?? p.createdAt.toISOString(),
      email: p.user.email,
      amountUsd: Number(p.amountUsd),
      cryptoCurrency: p.cryptoCurrency ?? '',
      amountCrypto: p.amountCrypto ? Number(p.amountCrypto) : '',
      provider: p.provider,
      providerTxnId: p.providerTxnId ?? '',
      planCode: p.subscription?.plan?.code ?? '',
      planName: p.subscription?.plan?.name ?? '',
    }));
  }

  // ─────────────────────────── Overview ───────────────────────────

  /**
   * Comprehensive admin KPIs. Single endpoint to avoid 8 round-trips
   * from the overview page.
   */
  async stats() {
    const now = Date.now();
    const d1 = new Date(now - DAY_MS);
    const d7 = new Date(now - 7 * DAY_MS);
    const d30 = new Date(now - 30 * DAY_MS);
    const d60 = new Date(now - 60 * DAY_MS);
    const hour1 = new Date(now - 3_600_000);

    const [
      users, signups1, signups7, signups30,
      botsTotal, botsRunning, botsStuck,
      paymentsTotal, paymentsCompleted, paymentsFailed24h, paymentsPending,
      activeSubs,
      tradeVolume24h, errors1h,
      trialsActive, trialsConverted30, churned30, retained30,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { createdAt: { gte: d1 } } }),
      this.prisma.user.count({ where: { createdAt: { gte: d7 } } }),
      this.prisma.user.count({ where: { createdAt: { gte: d30 } } }),
      this.prisma.bot.count(),
      this.prisma.bot.count({ where: { status: 'RUNNING' } }),
      // Bots that should be running but the engine hasn't touched in 10 minutes.
      this.prisma.bot.count({
        where: {
          status: 'RUNNING',
          // Heuristic: lastEventAt within state.startedAtMs; we approximate via updatedAt staleness.
          updatedAt: { lt: new Date(now - 600_000) },
        },
      }),
      this.prisma.payment.count(),
      this.prisma.payment.count({ where: { status: 'COMPLETED' } }),
      this.prisma.payment.count({ where: { status: 'FAILED', createdAt: { gte: d1 } } }),
      this.prisma.payment.count({ where: { status: 'PENDING' } }),
      this.prisma.subscription.findMany({
        where: { status: 'ACTIVE' },
        include: { plan: { select: { priceUsd: true, billingCycleDays: true } } },
      }),
      this.prisma.trade.aggregate({
        where: { executedAt: { gte: d1 } },
        _sum: { quoteQuantity: true },
        _count: true,
      }),
      this.prisma.botEvent.count({ where: { type: { contains: 'ERROR' }, createdAt: { gte: hour1 } } }),
      this.prisma.subscription.count({ where: { status: 'TRIAL', endsAt: { gt: new Date() } } }),
      this.prisma.subscription.count({
        where: { status: 'ACTIVE', createdAt: { gte: d30 } },
      }),
      this.prisma.subscription.count({
        where: { status: 'CANCELED', canceledAt: { gte: d30 } },
      }),
      this.prisma.subscription.count({
        where: { status: 'ACTIVE', createdAt: { lt: d30, gte: d60 } },
      }),
    ]);

    const monthlyRecurring = activeSubs.reduce((sum, s) => {
      const monthly = (Number(s.plan.priceUsd) * 30) / s.plan.billingCycleDays;
      return sum + monthly;
    }, 0);

    // Churn rate over 30 days: canceled / (active_at_start + new_active).
    const denom = retained30 + churned30;
    const churnRate = denom > 0 ? (churned30 / denom) * 100 : 0;

    return {
      ts: new Date().toISOString(),
      users: {
        total: users,
        signups24h: signups1,
        signups7d: signups7,
        signups30d: signups30,
      },
      bots: {
        total: botsTotal,
        running: botsRunning,
        stuck: botsStuck,
      },
      payments: {
        total: paymentsTotal,
        completed: paymentsCompleted,
        pending: paymentsPending,
        failed24h: paymentsFailed24h,
      },
      revenue: {
        mrr: monthlyRecurring,
        activeSubs: activeSubs.length,
      },
      trading: {
        volume24h: Number(tradeVolume24h._sum.quoteQuantity ?? 0),
        trades24h: tradeVolume24h._count,
      },
      health: {
        errors1h,
        botsStuck,
      },
      growth: {
        trialsActive,
        trialsConverted30d: trialsConverted30,
        churned30d: churned30,
        churnRate,
      },
    };
  }

  /** Last 90 days revenue + signups, bucketed by day. */
  async dailyTimeseries(days = 90) {
    const from = new Date(Date.now() - days * DAY_MS);
    const [signups, payments] = await Promise.all([
      this.prisma.user.findMany({
        where: { createdAt: { gte: from } },
        select: { createdAt: true },
      }),
      this.prisma.payment.findMany({
        where: { status: 'COMPLETED', paidAt: { gte: from } },
        select: { paidAt: true, amountUsd: true },
      }),
    ]);
    const days_: Record<string, { signups: number; revenue: number }> = {};
    const dateKey = (d: Date) => d.toISOString().slice(0, 10);
    for (let i = 0; i < days; i++) {
      const d = new Date(from.getTime() + i * DAY_MS);
      days_[dateKey(d)] = { signups: 0, revenue: 0 };
    }
    for (const s of signups) {
      const k = dateKey(s.createdAt);
      if (days_[k]) days_[k].signups++;
    }
    for (const p of payments) {
      if (!p.paidAt) continue;
      const k = dateKey(p.paidAt);
      if (days_[k]) days_[k].revenue += Number(p.amountUsd);
    }
    return Object.entries(days_).map(([date, v]) => ({ date, ...v }));
  }

  /** Action-needed alerts: items that should bubble up at the top of the dashboard. */
  async alerts() {
    const alerts: Array<{
      id: string; severity: 'critical' | 'warning' | 'info';
      title: string; detail: string; href?: string;
    }> = [];

    const [pendingPayments, failedPayments24h, suspendedActive, stuckBots] = await Promise.all([
      this.prisma.payment.count({ where: { status: 'PENDING', createdAt: { lt: new Date(Date.now() - 24 * 3_600_000) } } }),
      this.prisma.payment.count({ where: { status: 'FAILED', createdAt: { gte: new Date(Date.now() - DAY_MS) } } }),
      this.prisma.user.count({ where: { status: 'SUSPENDED', bots: { some: { status: 'RUNNING' } } } }),
      this.prisma.bot.findMany({
        where: { status: 'RUNNING', updatedAt: { lt: new Date(Date.now() - 600_000) } },
        select: { id: true, name: true, symbol: true },
        take: 10,
      }),
    ]);
    if (pendingPayments > 0) alerts.push({
      id: 'pending-payments', severity: 'warning',
      title: `${pendingPayments} pending payment(s) > 24h`,
      detail: 'Reconcile with the payment provider.',
      href: '/admin/payments?status=PENDING',
    });
    if (failedPayments24h > 0) alerts.push({
      id: 'failed-payments', severity: 'critical',
      title: `${failedPayments24h} payment(s) failed in 24h`,
      detail: 'Review and contact affected users.',
      href: '/admin/payments?status=FAILED',
    });
    if (suspendedActive > 0) alerts.push({
      id: 'suspended-active', severity: 'critical',
      title: `${suspendedActive} suspended user(s) with running bots`,
      detail: 'Stop their bots manually.',
      href: '/admin/users?status=SUSPENDED',
    });
    if (stuckBots.length > 0) alerts.push({
      id: 'stuck-bots', severity: 'warning',
      title: `${stuckBots.length} bot(s) stuck (no heartbeat > 10m)`,
      detail: stuckBots.map((b) => `${b.name} (${b.symbol})`).slice(0, 3).join(', ') + (stuckBots.length > 3 ? '…' : ''),
      href: '/admin/bots?filter=stuck',
    });
    return alerts;
  }

  /** Acquisition funnel over the last 30 days. */
  async funnel() {
    const from = new Date(Date.now() - 30 * DAY_MS);
    const [signups, activated, paying, retained] = await Promise.all([
      this.prisma.user.count({ where: { createdAt: { gte: from } } }),
      this.prisma.user.count({ where: { createdAt: { gte: from }, bots: { some: {} } } }),
      this.prisma.user.count({
        where: { createdAt: { gte: from }, subscriptions: { some: { status: { in: ['ACTIVE'] } } } },
      }),
      this.prisma.user.count({
        where: {
          createdAt: { gte: from },
          lastLoginAt: { gte: new Date(Date.now() - 7 * DAY_MS) },
        },
      }),
    ]);
    return [
      { step: 'Signups', count: signups },
      { step: 'Activated (≥1 bot)', count: activated },
      { step: 'Paying', count: paying },
      { step: 'Active (login 7d)', count: retained },
    ];
  }

  /** Top lists for the overview page. */
  async topLists() {
    const [topVolume, topBots, topSymbols] = await Promise.all([
      this.prisma.trade.groupBy({
        by: ['botId'], _sum: { quoteQuantity: true }, _count: true,
        orderBy: { _sum: { quoteQuantity: 'desc' } }, take: 10,
      }).then(async (rows) => {
        const ids = rows.map((r) => r.botId);
        const bots = await this.prisma.bot.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, symbol: true, user: { select: { email: true } } },
        });
        const byId = new Map(bots.map((b) => [b.id, b]));
        return rows.map((r) => ({
          botId: r.botId,
          name: byId.get(r.botId)?.name ?? '—',
          symbol: byId.get(r.botId)?.symbol ?? '—',
          owner: byId.get(r.botId)?.user?.email ?? '—',
          volume: Number(r._sum.quoteQuantity ?? 0),
          trades: r._count,
        }));
      }),
      this.prisma.bot.findMany({
        where: { realizedPnlQuote: { gt: 0 } },
        orderBy: { realizedPnlQuote: 'desc' },
        take: 10,
        select: {
          id: true, name: true, symbol: true,
          realizedPnlQuote: true,
          user: { select: { email: true } },
        },
      }).then((rows) => rows.map((b) => ({
        id: b.id, name: b.name, symbol: b.symbol,
        pnl: Number(b.realizedPnlQuote),
        owner: b.user.email,
      }))),
      this.prisma.bot.groupBy({
        by: ['symbol'], _count: true,
        orderBy: { _count: { symbol: 'desc' } }, take: 10,
      }).then((rows) => rows.map((r) => ({ symbol: r.symbol, count: r._count }))),
    ]);
    return { topVolume, topBots, topSymbols };
  }

  /** Stats by strategy. */
  async strategyUsage() {
    const rows = await this.prisma.bot.groupBy({
      by: ['strategyId'], _count: true,
      orderBy: { _count: { strategyId: 'desc' } },
    });
    const ids = rows.map((r) => r.strategyId);
    const strategies = await this.prisma.strategy.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, builtinKey: true, type: true },
    });
    const byId = new Map(strategies.map((s) => [s.id, s]));
    return rows.map((r) => ({
      strategyId: r.strategyId,
      name: byId.get(r.strategyId)?.name ?? '—',
      builtinKey: byId.get(r.strategyId)?.builtinKey ?? null,
      type: byId.get(r.strategyId)?.type ?? null,
      count: r._count,
    }));
  }

  // ─────────────────────────── Users ───────────────────────────

  async listUsers(opts: {
    search?: string;
    role?: UserRole;
    status?: UserStatus;
    hasBots?: boolean;
    twoFactor?: boolean;
    limit?: number; offset?: number;
  } = {}) {
    const where: Record<string, unknown> = {};
    if (opts.search) {
      where.OR = [
        { email: { contains: opts.search, mode: 'insensitive' } },
        { fullName: { contains: opts.search, mode: 'insensitive' } },
      ];
    }
    if (opts.role) where.role = opts.role;
    if (opts.status) where.status = opts.status;
    if (opts.hasBots !== undefined) {
      where.bots = opts.hasBots ? { some: {} } : { none: {} };
    }
    if (opts.twoFactor !== undefined) where.twoFactorEnabled = opts.twoFactor;

    const limit = Math.min(200, opts.limit ?? 50);
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where: where as never,
        select: {
          id: true, email: true, fullName: true, role: true, status: true,
          twoFactorEnabled: true, createdAt: true, lastLoginAt: true, lastLoginIp: true,
          notificationConfig: true,
          _count: { select: { bots: true, apiKeys: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: opts.offset ?? 0,
      }),
      this.prisma.user.count({ where: where as never }),
    ]);
    // Expose admin tags out of notificationConfig.admin.tags (no schema change).
    const enriched = rows.map((r) => {
      const cfg = (r.notificationConfig ?? {}) as { admin?: { tags?: string[]; notes?: string } };
      const tags = cfg.admin?.tags ?? [];
      return { ...r, adminTags: tags, notificationConfig: undefined };
    });
    return { rows: enriched, total, limit, offset: opts.offset ?? 0 };
  }

  /** Full user detail for the admin user page. */
  async getUser(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true, email: true, fullName: true, avatarUrl: true,
        role: true, status: true, twoFactorEnabled: true,
        telegramChatId: true, discordWebhookUrl: true,
        referralCode: true, referredById: true,
        trialEndsAt: true, lastLoginAt: true, lastLoginIp: true,
        notificationConfig: true,
        createdAt: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    const [bots, apiKeys, payments, subscriptions, sessions, recentAudit] = await Promise.all([
      this.prisma.bot.findMany({
        where: { userId: id },
        select: { id: true, name: true, symbol: true, status: true, createdAt: true, realizedPnlQuote: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.exchangeApiKey.findMany({
        where: { userId: id },
        select: { id: true, label: true, exchange: true, status: true, createdAt: true },
      }),
      this.prisma.payment.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, amountUsd: true, status: true, provider: true, createdAt: true, paidAt: true },
      }),
      this.prisma.subscription.findMany({
        where: { userId: id },
        include: { plan: { select: { code: true, name: true, priceUsd: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.session.findMany({
        where: { userId: id, revokedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true, userAgent: true, ipAddress: true, createdAt: true, expiresAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.auditLog.findMany({
        where: { OR: [{ userId: id }, { targetType: 'user', targetId: id }] },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
    ]);
    const totalVolume = await this.prisma.trade.aggregate({
      where: { bot: { userId: id } },
      _sum: { quoteQuantity: true },
      _count: true,
    });
    return {
      user,
      bots,
      apiKeys,
      payments,
      subscriptions,
      sessions,
      recentAudit,
      totals: {
        volume: Number(totalVolume._sum.quoteQuantity ?? 0),
        trades: totalVolume._count,
      },
    };
  }

  async setUserRole(id: string, role: UserRole) {
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u) throw new NotFoundException('User not found');
    return this.prisma.user.update({ where: { id }, data: { role }, select: { id: true, role: true } });
  }

  async setUserStatus(id: string, status: UserStatus) {
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u) throw new NotFoundException('User not found');
    // When suspending a user, also stop their running bots.
    if (status === 'SUSPENDED') {
      const running = await this.prisma.bot.findMany({
        where: { userId: id, status: { in: ['RUNNING', 'STARTING'] } },
        select: { id: true },
      });
      for (const b of running) {
        await this.publishCommand({ type: 'STOP', botId: b.id });
      }
      await this.prisma.bot.updateMany({
        where: { id: { in: running.map((b) => b.id) } },
        data: { status: 'STOPPING' },
      });
    }
    return this.prisma.user.update({ where: { id }, data: { status }, select: { id: true, status: true } });
  }

  /**
   * Generate a one-hour password reset token for any user. Returns the raw
   * token so the admin can copy + share it (DM, support ticket, etc.). The
   * token is also delivered via Telegram if linked.
   */
  async adminResetPassword(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true },
    });
    if (!user) throw new NotFoundException('User not found');
    const rawToken = nanoid(48);
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    const resetUrl = `${env.AUTH_URL}/reset-password?token=${rawToken}`;
    return { resetUrl, expiresInMinutes: 60, email: user.email };
  }

  /** Change a user's email (admin override). Use cautiously. */
  async adminChangeEmail(id: string, newEmail: string) {
    const exists = await this.prisma.user.findUnique({ where: { email: newEmail } });
    if (exists && exists.id !== id) throw new BadRequestException('Email already in use');
    return this.prisma.user.update({
      where: { id },
      data: { email: newEmail, emailVerifiedAt: null },
      select: { id: true, email: true },
    });
  }

  /**
   * Admin notes/tags on a user. Stored inside `notificationConfig.admin` to
   * avoid a schema migration. `notes` is free-text; `tags` is a string array.
   */
  async setUserNotes(id: string, input: { notes?: string; tags?: string[] }) {
    const u = await this.prisma.user.findUnique({
      where: { id },
      select: { notificationConfig: true },
    });
    if (!u) throw new NotFoundException('User not found');
    const cfg = (u.notificationConfig ?? {}) as Record<string, unknown>;
    const admin = (cfg.admin ?? {}) as { notes?: string; tags?: string[] };
    const nextAdmin = {
      ...admin,
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
    };
    return this.prisma.user.update({
      where: { id },
      data: { notificationConfig: { ...cfg, admin: nextAdmin } as object },
      select: { id: true },
    });
  }

  /** Force a 2FA reset — admin path for users who lost their authenticator. */
  async resetUserMfa(id: string) {
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u) throw new NotFoundException('User not found');
    return this.prisma.user.update({
      where: { id },
      data: { twoFactorEnabled: false, twoFactorSecret: null },
      select: { id: true, twoFactorEnabled: true },
    });
  }

  // ─────────────────────────── Bots ───────────────────────────

  async listBotsAdmin(opts: {
    search?: string; status?: string; strategy?: string; symbol?: string;
    stuck?: boolean; limit?: number; offset?: number;
  } = {}) {
    const where: Record<string, unknown> = {};
    if (opts.search) where.OR = [
      { name: { contains: opts.search, mode: 'insensitive' } },
      { symbol: { contains: opts.search, mode: 'insensitive' } },
    ];
    if (opts.status) where.status = opts.status;
    if (opts.symbol) where.symbol = opts.symbol;
    if (opts.strategy) where.strategy = { builtinKey: opts.strategy };
    if (opts.stuck) {
      where.status = 'RUNNING';
      where.updatedAt = { lt: new Date(Date.now() - 600_000) };
    }
    const limit = Math.min(200, opts.limit ?? 50);
    const [rows, total] = await Promise.all([
      this.prisma.bot.findMany({
        where: where as never,
        select: {
          id: true, name: true, symbol: true, status: true,
          realizedPnlQuote: true, unrealizedPnlQuote: true,
          createdAt: true, updatedAt: true, startedAt: true,
          paperTrading: true,
          user: { select: { id: true, email: true } },
          strategy: { select: { name: true, builtinKey: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: opts.offset ?? 0,
      }),
      this.prisma.bot.count({ where: where as never }),
    ]);
    return { rows, total, limit, offset: opts.offset ?? 0 };
  }

  /** Force-stop any bot in the system (admin override). */
  async forceStopBot(botId: string, reason: string) {
    const bot = await this.prisma.bot.findUnique({ where: { id: botId } });
    if (!bot) throw new NotFoundException('Bot not found');
    await this.publishCommand({ type: 'STOP', botId });
    await this.prisma.bot.update({ where: { id: botId }, data: { status: 'STOPPING' } });
    await this.prisma.botEvent.create({
      data: {
        botId, type: 'ADMIN_FORCE_STOP',
        message: `Admin force-stop: ${reason}`,
        data: { reason },
      },
    });
    return { ok: true };
  }

  /** Bots with realized PnL > 0 (top winners) and < 0 (top losers). */
  async topBots(limit = 10) {
    const [winners, losers] = await Promise.all([
      this.prisma.bot.findMany({
        where: { realizedPnlQuote: { gt: 0 } },
        orderBy: { realizedPnlQuote: 'desc' }, take: limit,
        select: { id: true, name: true, symbol: true, realizedPnlQuote: true, user: { select: { email: true } } },
      }),
      this.prisma.bot.findMany({
        where: { realizedPnlQuote: { lt: 0 } },
        orderBy: { realizedPnlQuote: 'asc' }, take: limit,
        select: { id: true, name: true, symbol: true, realizedPnlQuote: true, user: { select: { email: true } } },
      }),
    ]);
    const fmt = (b: typeof winners[0]) => ({
      id: b.id, name: b.name, symbol: b.symbol,
      pnl: Number(b.realizedPnlQuote), owner: b.user.email,
    });
    return { winners: winners.map(fmt), losers: losers.map(fmt) };
  }

  // ─────────────────────────── Payments ───────────────────────────

  async listPayments(opts: {
    search?: string; status?: string; provider?: string;
    from?: string; to?: string;
    limit?: number; offset?: number;
  } = {}) {
    const where: Record<string, unknown> = {};
    if (opts.status) where.status = opts.status;
    if (opts.provider) where.provider = opts.provider;
    if (opts.from || opts.to) {
      where.createdAt = {
        ...(opts.from ? { gte: new Date(opts.from) } : {}),
        ...(opts.to ? { lte: new Date(opts.to) } : {}),
      };
    }
    if (opts.search) {
      where.OR = [
        { providerTxnId: { contains: opts.search, mode: 'insensitive' } },
        { user: { email: { contains: opts.search, mode: 'insensitive' } } },
      ];
    }
    const limit = Math.min(200, opts.limit ?? 50);
    const [rows, total, totals] = await Promise.all([
      this.prisma.payment.findMany({
        where: where as never,
        select: {
          id: true, amountUsd: true, amountCrypto: true, cryptoCurrency: true,
          status: true, provider: true, providerTxnId: true,
          createdAt: true, paidAt: true,
          user: { select: { id: true, email: true } },
          subscription: { select: { id: true, plan: { select: { code: true, name: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: opts.offset ?? 0,
      }),
      this.prisma.payment.count({ where: where as never }),
      this.prisma.payment.aggregate({
        where: { ...where, status: 'COMPLETED' } as never,
        _sum: { amountUsd: true },
        _count: true,
      }),
    ]);
    return {
      rows, total, limit, offset: opts.offset ?? 0,
      summary: {
        completedTotalUsd: Number(totals._sum.amountUsd ?? 0),
        completedCount: totals._count,
      },
    };
  }

  /**
   * Mark a payment as REFUNDED. Does NOT actually transfer funds back —
   * that must be done via the payment provider's dashboard. This is the
   * bookkeeping side: payment is flagged + subscription canceled if linked.
   */
  async refundPayment(id: string, reason: string) {
    const p = await this.prisma.payment.findUnique({
      where: { id },
      include: { subscription: true },
    });
    if (!p) throw new NotFoundException('Payment not found');
    if (p.status === 'REFUNDED') throw new BadRequestException('Already refunded');
    await this.prisma.payment.update({
      where: { id },
      data: {
        status: 'REFUNDED',
        ipnRaw: { ...((p.ipnRaw as object) ?? {}), refund: { reason, at: new Date().toISOString() } } as object,
      },
    });
    if (p.subscription) {
      await this.prisma.subscription.update({
        where: { id: p.subscription.id },
        data: { status: 'CANCELED', canceledAt: new Date() },
      });
    }
    return { ok: true };
  }

  /** Extend an active subscription by N days. */
  async extendSubscription(id: string, days: number) {
    if (days <= 0 || days > 3650) throw new BadRequestException('days must be 1..3650');
    const s = await this.prisma.subscription.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Subscription not found');
    const newEnd = new Date(Math.max(s.endsAt.getTime(), Date.now()) + days * DAY_MS);
    return this.prisma.subscription.update({
      where: { id },
      data: { endsAt: newEnd, status: 'ACTIVE' },
      select: { id: true, endsAt: true, status: true },
    });
  }

  // ─────────────────────────── System health ───────────────────────────

  async systemHealth() {
    const [usersCount, botsCount, redisOk, dbLatencyMs] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.bot.count(),
      this.pingRedis(),
      this.measureDbLatency(),
    ]);
    // Recent engine activity: a fresh BotEvent within 60s indicates the engine is alive.
    const lastEvent = await this.prisma.botEvent.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    const engineLastEventAgoMs = lastEvent ? Date.now() - lastEvent.createdAt.getTime() : null;

    // AppSetting MAINTENANCE_MODE.
    const maintenance = await this.prisma.appSetting.findUnique({
      where: { key: 'MAINTENANCE_MODE' },
      select: { value: true },
    });
    const maintenanceMode = (maintenance?.value as { enabled?: boolean } | null)?.enabled === true;

    return {
      ts: new Date().toISOString(),
      db: { ok: dbLatencyMs !== null, latencyMs: dbLatencyMs, users: usersCount, bots: botsCount },
      redis: { ok: redisOk },
      engine: {
        ok: engineLastEventAgoMs !== null && engineLastEventAgoMs < 120_000,
        lastEventAgoMs: engineLastEventAgoMs,
      },
      maintenanceMode,
    };
  }

  async setMaintenanceMode(enabled: boolean) {
    return this.prisma.appSetting.upsert({
      where: { key: 'MAINTENANCE_MODE' },
      create: { key: 'MAINTENANCE_MODE', value: { enabled }, isPublic: true, category: 'system' },
      update: { value: { enabled } },
    });
  }

  // ─────────────────────────── Analytics ───────────────────────────

  /**
   * Churn breakdown by plan + monthly cohort. Returns:
   *   - per-plan: active, canceled, churnRate
   *   - month-by-month: cohort signups vs survivals
   */
  async churnAnalytics() {
    const since = new Date(Date.now() - 180 * DAY_MS);
    const subs = await this.prisma.subscription.findMany({
      where: { createdAt: { gte: since } },
      include: { plan: { select: { code: true, name: true } } },
    });
    const byPlan: Record<string, { code: string; name: string; active: number; canceled: number; trial: number }> = {};
    for (const s of subs) {
      const key = s.plan.code;
      const e = byPlan[key] ??= { code: s.plan.code, name: s.plan.name, active: 0, canceled: 0, trial: 0 };
      if (s.status === 'CANCELED') e.canceled++;
      else if (s.status === 'TRIAL') e.trial++;
      else if (s.status === 'ACTIVE') e.active++;
    }
    const perPlan = Object.values(byPlan).map((p) => ({
      ...p,
      churnRate: p.active + p.canceled > 0 ? (p.canceled / (p.active + p.canceled)) * 100 : 0,
    }));

    // Cohort: group subs by signup month
    const cohorts: Record<string, { month: string; total: number; canceled: number }> = {};
    for (const s of subs) {
      const m = s.createdAt.toISOString().slice(0, 7);
      const e = cohorts[m] ??= { month: m, total: 0, canceled: 0 };
      e.total++;
      if (s.status === 'CANCELED') e.canceled++;
    }
    const cohortList = Object.values(cohorts).sort((a, b) => a.month.localeCompare(b.month));

    return { perPlan, cohorts: cohortList };
  }

  /**
   * Bot fleet heatmap: matrix of (strategy × symbol) → count.
   * Helps spot concentration risk (e.g. 80% of bots on one symbol).
   */
  async fleetHeatmap() {
    const rows = await this.prisma.bot.findMany({
      select: {
        symbol: true,
        strategy: { select: { name: true, builtinKey: true } },
      },
    });
    const cells: Record<string, Record<string, number>> = {};
    const symbols = new Set<string>();
    const strategies = new Set<string>();
    for (const b of rows) {
      const strat = b.strategy?.builtinKey ?? b.strategy?.name ?? 'unknown';
      strategies.add(strat);
      symbols.add(b.symbol);
      cells[strat] ??= {};
      cells[strat][b.symbol] = (cells[strat][b.symbol] ?? 0) + 1;
    }
    return {
      strategies: [...strategies].sort(),
      symbols: [...symbols].sort(),
      cells,
      total: rows.length,
    };
  }

  /**
   * Symbol watchlist: per-symbol stats — bot count, total PnL, volume,
   * concentration % (share of total fleet).
   */
  async symbolWatchlist() {
    const [byBots, byTrades] = await Promise.all([
      this.prisma.bot.groupBy({
        by: ['symbol'],
        _count: true,
        _sum: { realizedPnlQuote: true },
      }),
      this.prisma.trade.groupBy({
        by: ['symbol'],
        _sum: { quoteQuantity: true },
        _count: true,
      }),
    ]);
    const totalBots = byBots.reduce((s, r) => s + r._count, 0);
    const volBy = new Map(byTrades.map((r) => [r.symbol, { volume: Number(r._sum.quoteQuantity ?? 0), trades: r._count }]));
    return byBots
      .map((r) => ({
        symbol: r.symbol,
        bots: r._count,
        concentrationPct: totalBots > 0 ? (r._count / totalBots) * 100 : 0,
        realizedPnl: Number(r._sum.realizedPnlQuote ?? 0),
        volume: volBy.get(r.symbol)?.volume ?? 0,
        trades: volBy.get(r.symbol)?.trades ?? 0,
      }))
      .sort((a, b) => b.bots - a.bots);
  }

  // ─────────────────────────── Security Settings ───────────────────────────

  async getSecuritySettings() {
    const [mfaCfg, ipCfg] = await Promise.all([
      this.prisma.appSetting.findUnique({ where: { key: 'ADMIN_REQUIRE_MFA' } }),
      this.prisma.appSetting.findUnique({ where: { key: 'ADMIN_IP_ALLOWLIST' } }),
    ]);
    return {
      requireMfaForAdmin: ((mfaCfg?.value ?? { enabled: false }) as { enabled?: boolean }).enabled === true,
      ipAllowlist: ((ipCfg?.value ?? { ips: [] }) as { ips?: string[] }).ips ?? [],
    };
  }

  async setSecuritySettings(input: { requireMfaForAdmin?: boolean; ipAllowlist?: string[] }) {
    if (input.requireMfaForAdmin !== undefined) {
      await this.prisma.appSetting.upsert({
        where: { key: 'ADMIN_REQUIRE_MFA' },
        create: { key: 'ADMIN_REQUIRE_MFA', value: { enabled: input.requireMfaForAdmin }, category: 'security' },
        update: { value: { enabled: input.requireMfaForAdmin } },
      });
    }
    if (input.ipAllowlist !== undefined) {
      // Basic validation: only allow CIDR or IPv4-like strings.
      for (const ip of input.ipAllowlist) {
        if (!/^[0-9.]+(\/\d{1,2})?$/.test(ip) && !/^[0-9a-f:]+(\/\d{1,3})?$/i.test(ip)) {
          throw new BadRequestException(`Invalid IP/CIDR: ${ip}`);
        }
      }
      await this.prisma.appSetting.upsert({
        where: { key: 'ADMIN_IP_ALLOWLIST' },
        create: { key: 'ADMIN_IP_ALLOWLIST', value: { ips: input.ipAllowlist }, category: 'security' },
        update: { value: { ips: input.ipAllowlist } },
      });
    }
    return this.getSecuritySettings();
  }

  // ─────────────────────────── Coupons (Sprint 4) ───────────────────────────

  async listCoupons() {
    return this.prisma.coupon.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async createCoupon(input: {
    code: string; description?: string;
    discountType: 'PERCENT' | 'FIXED'; discountValue: number;
    applicablePlans?: string[];
    maxRedemptions?: number;
    perUserLimit?: number;
    validFrom?: string; validUntil?: string;
    isActive?: boolean;
  }) {
    if (input.discountType === 'PERCENT' && (input.discountValue < 0 || input.discountValue > 100)) {
      throw new BadRequestException('PERCENT discount must be between 0 and 100');
    }
    if (input.discountType === 'FIXED' && input.discountValue < 0) {
      throw new BadRequestException('FIXED discount must be non-negative');
    }
    return this.prisma.coupon.create({
      data: {
        code: input.code.toUpperCase(),
        description: input.description,
        discountType: input.discountType,
        discountValue: input.discountValue,
        applicablePlans: input.applicablePlans ?? [],
        maxRedemptions: input.maxRedemptions ?? null,
        perUserLimit: input.perUserLimit ?? 1,
        validFrom: input.validFrom ? new Date(input.validFrom) : new Date(),
        validUntil: input.validUntil ? new Date(input.validUntil) : null,
        isActive: input.isActive ?? true,
      },
    });
  }

  async updateCoupon(id: string, patch: Partial<{
    description: string;
    applicablePlans: string[];
    maxRedemptions: number | null;
    perUserLimit: number;
    validUntil: string | null;
    isActive: boolean;
  }>) {
    return this.prisma.coupon.update({
      where: { id },
      data: {
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.applicablePlans !== undefined ? { applicablePlans: patch.applicablePlans } : {}),
        ...(patch.maxRedemptions !== undefined ? { maxRedemptions: patch.maxRedemptions } : {}),
        ...(patch.perUserLimit !== undefined ? { perUserLimit: patch.perUserLimit } : {}),
        ...(patch.validUntil !== undefined ? { validUntil: patch.validUntil ? new Date(patch.validUntil) : null } : {}),
        ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
      },
    });
  }

  async deleteCoupon(id: string) {
    await this.prisma.coupon.delete({ where: { id } });
    return { ok: true };
  }

  async listCouponRedemptions(couponId: string) {
    return this.prisma.couponRedemption.findMany({
      where: { couponId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { user: { select: { email: true } } },
    });
  }

  // ─────────────────────────── Email Templates (Sprint 4) ───────────────────────────

  listEmailTemplates() {
    return this.prisma.emailTemplate.findMany({ orderBy: { key: 'asc' } });
  }

  async upsertEmailTemplate(input: {
    key: string; name: string; subject: string; body: string;
    variables?: string[]; description?: string; isActive?: boolean;
  }) {
    return this.prisma.emailTemplate.upsert({
      where: { key: input.key },
      create: {
        key: input.key,
        name: input.name,
        subject: input.subject,
        body: input.body,
        variables: input.variables ?? [],
        description: input.description,
        isActive: input.isActive ?? true,
      },
      update: {
        name: input.name,
        subject: input.subject,
        body: input.body,
        variables: input.variables ?? [],
        description: input.description,
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
  }

  async deleteEmailTemplate(id: string) {
    await this.prisma.emailTemplate.delete({ where: { id } });
    return { ok: true };
  }

  // ─────────────────────────── Surveys / NPS (Sprint 4) ───────────────────────────

  async listSurveyResponses(opts: { surveyKey?: string; limit?: number } = {}) {
    const limit = Math.min(500, opts.limit ?? 100);
    return this.prisma.surveyResponse.findMany({
      where: opts.surveyKey ? { surveyKey: opts.surveyKey } : undefined,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { user: { select: { email: true, fullName: true } } },
    });
  }

  /** NPS rollup: promoters / passives / detractors + score. */
  async npsSummary(days = 90) {
    const since = new Date(Date.now() - days * DAY_MS);
    const rows = await this.prisma.surveyResponse.findMany({
      where: { surveyKey: 'nps', createdAt: { gte: since } },
      select: { score: true },
    });
    let promoters = 0, passives = 0, detractors = 0;
    for (const r of rows) {
      if (r.score === null || r.score === undefined) continue;
      if (r.score >= 9) promoters++;
      else if (r.score >= 7) passives++;
      else detractors++;
    }
    const total = promoters + passives + detractors;
    const nps = total > 0 ? Math.round(((promoters - detractors) / total) * 100) : null;
    return { total, promoters, passives, detractors, nps, days };
  }

  // ─────────────────────────── Two-person approvals (Sprint 4) ───────────────────────────

  /**
   * Actions that always require a second admin's approval.
   * Add/remove items here to expand the policy.
   */
  static readonly APPROVAL_REQUIRED_ACTIONS = new Set([
    'user.role.change.elevate',  // promoting to ADMIN/SUPER_ADMIN
    'user.delete',
    'payment.refund.large',       // > $500
    'system.maintenance',
  ]);

  /** Request approval for a sensitive action. Returns the pending approval id. */
  async requestApproval(input: {
    requestedBy: string;
    action: string;
    targetType?: string;
    targetId?: string;
    payload: Record<string, unknown>;
    reason?: string;
    ttlHours?: number;
  }) {
    return this.prisma.pendingApproval.create({
      data: {
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        payload: input.payload as object,
        requestedBy: input.requestedBy,
        reason: input.reason,
        expiresAt: new Date(Date.now() + (input.ttlHours ?? 24) * 3_600_000),
      },
    });
  }

  async listPendingApprovals(opts: { status?: 'pending' | 'completed' | 'rejected' | 'all' } = {}) {
    const status = opts.status ?? 'pending';
    const now = new Date();
    const where: Record<string, unknown> = {};
    if (status === 'pending') {
      where.approvedAt = null; where.rejectedAt = null;
      where.expiresAt = { gt: now };
    } else if (status === 'completed') where.approvedAt = { not: null };
    else if (status === 'rejected') where.rejectedAt = { not: null };
    return this.prisma.pendingApproval.findMany({
      where: where as never,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { requestedByUser: { select: { email: true } } },
    });
  }

  async approveAction(approvalId: string, approverId: string) {
    const a = await this.prisma.pendingApproval.findUnique({ where: { id: approvalId } });
    if (!a) throw new NotFoundException('Approval not found');
    if (a.approvedAt || a.rejectedAt) throw new BadRequestException('Already resolved');
    if (a.expiresAt < new Date()) throw new BadRequestException('Approval expired');
    if (a.requestedBy === approverId) {
      throw new BadRequestException('Two-person approval: approver must differ from requester');
    }
    await this.prisma.pendingApproval.update({
      where: { id: approvalId },
      data: { approvedBy: approverId, approvedAt: new Date() },
    });
    // Caller is responsible for replaying the payload after approval.
    return { ok: true, action: a.action, payload: a.payload };
  }

  async rejectAction(approvalId: string, rejecterId: string, reason?: string) {
    const a = await this.prisma.pendingApproval.findUnique({ where: { id: approvalId } });
    if (!a) throw new NotFoundException('Approval not found');
    if (a.approvedAt || a.rejectedAt) throw new BadRequestException('Already resolved');
    return this.prisma.pendingApproval.update({
      where: { id: approvalId },
      data: { rejectedBy: rejecterId, rejectedAt: new Date(), rejectionReason: reason },
    });
  }

  async markApprovalExecuted(approvalId: string, result: Record<string, unknown>) {
    return this.prisma.pendingApproval.update({
      where: { id: approvalId },
      data: { executedAt: new Date(), executionResult: result as object },
    });
  }

  // ─────────────────────────── Plans ───────────────────────────

  listPlansAll() { return this.prisma.plan.findMany({ orderBy: { sortOrder: 'asc' } }); }

  async createPlan(data: {
    code: string; name: string; description?: string;
    priceUsd: number; billingCycleDays: number;
    maxBots: number; maxApiKeys: number; maxCustomStrategies: number;
    sortOrder?: number; isActive?: boolean;
  }) { return this.prisma.plan.create({ data }); }

  updatePlan(id: string, data: Partial<{
    name: string; description: string; priceUsd: number; billingCycleDays: number;
    maxBots: number; maxApiKeys: number; maxCustomStrategies: number;
    sortOrder: number; isActive: boolean;
  }>) { return this.prisma.plan.update({ where: { id }, data }); }

  // ─────────────────────────── Settings ───────────────────────────

  listSettings() { return this.prisma.appSetting.findMany({ orderBy: { key: 'asc' } }); }

  setSetting(key: string, value: unknown, isPublic = false, category?: string) {
    return this.prisma.appSetting.upsert({
      where: { key },
      create: { key, value: value as object, isPublic, category },
      update: { value: value as object, isPublic, category },
    });
  }

  // ─────────────────────────── Feature Flags ───────────────────────────

  listFlags() { return this.prisma.featureFlag.findMany({ orderBy: { key: 'asc' } }); }

  setFlagExtended(input: {
    key: string;
    enabled?: boolean;
    rolloutPct?: number;
    allowList?: string[];
    description?: string;
    targeting?: Record<string, unknown>;
  }) {
    return this.prisma.featureFlag.upsert({
      where: { key: input.key },
      create: {
        key: input.key,
        enabled: input.enabled ?? false,
        rolloutPct: input.rolloutPct ?? 0,
        allowList: input.allowList ?? [],
        description: input.description,
        ...(input.targeting ? { targeting: input.targeting as object } : {}),
      },
      update: {
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.rolloutPct !== undefined ? { rolloutPct: input.rolloutPct } : {}),
        ...(input.allowList !== undefined ? { allowList: input.allowList } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.targeting ? { targeting: input.targeting as object } : {}),
      },
    });
  }

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

  // ─────────────────────────── Internals ───────────────────────────

  private async publishCommand(cmd: EngineCommand) {
    await this.redis.publisher.publish(ENGINE_COMMAND_CHANNEL, JSON.stringify(cmd));
  }

  private async pingRedis(): Promise<boolean> {
    try {
      const r = await this.redis.client.ping();
      return r === 'PONG';
    } catch { return false; }
  }

  private async measureDbLatency(): Promise<number | null> {
    try {
      const t = Date.now();
      await this.prisma.$queryRaw`SELECT 1`;
      return Date.now() - t;
    } catch { return null; }
  }
}
