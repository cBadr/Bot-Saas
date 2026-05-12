import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import argon2 from 'argon2';
import { authenticator } from 'otplib';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TelegramService } from '../notifications/telegram.service';
import { EmailService } from '../notifications/email.service';
import { DiscordService } from '../notifications/discord.service';
import { WebPushService } from '../notifications/web-push.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
    private readonly email: EmailService,
    private readonly discord: DiscordService,
    private readonly push: WebPushService,
  ) {}

  // ─── 2FA ───
  async setup2FA(userId: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u) throw new NotFoundException('User not found');
    if (u.twoFactorEnabled) throw new BadRequestException('2FA already enabled');
    const secret = authenticator.generateSecret();
    // Store secret but don't enable yet — user must verify a code first.
    await this.prisma.user.update({ where: { id: userId }, data: { twoFactorSecret: secret } });
    const otpauthUrl = authenticator.keyuri(u.email, 'Orca', secret);
    return { secret, otpauthUrl };
  }

  async verify2FA(userId: string, code: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u || !u.twoFactorSecret) throw new BadRequestException('2FA not initialized');
    const ok = authenticator.verify({ token: code, secret: u.twoFactorSecret });
    if (!ok) throw new BadRequestException('Invalid code');
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: true },
    });
    return { success: true };
  }

  async disable2FA(userId: string, code: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u || !u.twoFactorEnabled || !u.twoFactorSecret) {
      throw new BadRequestException('2FA not enabled');
    }
    const ok = authenticator.verify({ token: code, secret: u.twoFactorSecret });
    if (!ok) throw new BadRequestException('Invalid code');
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: false, twoFactorSecret: null },
    });
    return { success: true };
  }

  /**
   * Submit an NPS / feedback response. `score` 0..10 is required for NPS;
   * `category` is auto-computed (promoter / passive / detractor).
   */
  async submitSurvey(userId: string, input: {
    surveyKey?: string; score?: number; comment?: string;
    metadata?: Record<string, unknown>;
  }) {
    const surveyKey = input.surveyKey ?? 'nps';
    let category: string | null = null;
    if (typeof input.score === 'number') {
      if (input.score >= 9) category = 'promoter';
      else if (input.score >= 7) category = 'passive';
      else category = 'detractor';
    }
    return this.prisma.surveyResponse.create({
      data: {
        userId,
        surveyKey,
        score: input.score ?? null,
        category,
        comment: input.comment,
        metadata: (input.metadata ?? {}) as object,
      },
      select: { id: true, createdAt: true },
    });
  }

  async getProfile(userId: string) {
    const [user, announcement] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true, email: true, fullName: true, avatarUrl: true,
          role: true, status: true, twoFactorEnabled: true,
          telegramChatId: true, telegramUsername: true,
          discordWebhookUrl: true, pushSubscriptions: true,
          fillFrequency: true, notificationConfig: true, lastStatusReportAt: true,
          trialEndsAt: true,
          referralCode: true, createdAt: true, lastLoginAt: true,
        },
      }),
      this.prisma.appSetting.findUnique({ where: { key: 'ANNOUNCEMENT_BANNER' } }),
    ]);
    if (!user) throw new NotFoundException('User not found');
    // Surface admin announcement so the dashboard layout can render a banner
    // without an extra round trip. Only an enabled announcement is exposed.
    const ann = announcement?.value as null | {
      enabled?: boolean; message?: string; severity?: string;
      startsAt?: string; endsAt?: string;
    };
    let activeAnnouncement: { message: string; severity: 'info' | 'warning' | 'critical' } | null = null;
    if (ann?.enabled && ann.message) {
      const now = Date.now();
      const startsOk = !ann.startsAt || new Date(ann.startsAt).getTime() <= now;
      const endsOk = !ann.endsAt || new Date(ann.endsAt).getTime() >= now;
      if (startsOk && endsOk) {
        activeAnnouncement = {
          message: ann.message,
          severity: (ann.severity ?? 'info') as 'info' | 'warning' | 'critical',
        };
      }
    }
    return { ...user, announcement: activeAnnouncement };
  }

  async updateProfile(
    userId: string,
    data: {
      fullName?: string;
      avatarUrl?: string;
      telegramChatId?: string | null;
      telegramUsername?: string | null;
      discordWebhookUrl?: string | null;
      fillFrequency?: 'OFF' | 'PER_CYCLE' | 'PER_FILL' | 'CUSTOM';
      notificationConfig?: Record<string, unknown>;
    },
  ) {
    return this.prisma.user.update({
      where: { id: userId },
      data: data as never,
      select: {
        id: true, email: true, fullName: true, avatarUrl: true,
        telegramChatId: true, telegramUsername: true,
        discordWebhookUrl: true,
        fillFrequency: true, notificationConfig: true,
      },
    });
  }

  /** List the user's active (non-revoked, non-expired) sessions. */
  async listSessions(userId: string) {
    const now = new Date();
    return this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, userAgent: true, ipAddress: true,
        expiresAt: true, createdAt: true,
      },
    });
  }

  async revokeSession(userId: string, sessionId: string) {
    const s = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!s || s.userId !== userId) throw new NotFoundException('Session not found');
    if (s.revokedAt) return { ok: true };
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  }

  async revokeAllSessions(userId: string) {
    const r = await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { revoked: r.count };
  }

  /** Recent audit log entries for the user (last 200). */
  async auditLog(userId: string) {
    return this.prisma.auditLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true, action: true, actorType: true,
        targetType: true, targetId: true,
        ipAddress: true, userAgent: true,
        metadata: true, createdAt: true,
      },
    });
  }

  /** Referral counts + share link. */
  async referralStats(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { referralCode: true },
    });
    if (!user) throw new NotFoundException('User not found');
    const count = await this.prisma.user.count({ where: { referredById: userId } });
    const recent = await this.prisma.user.findMany({
      where: { referredById: userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, email: true, createdAt: true },
    });
    // Mask emails to avoid full PII exposure (e.g., j***@example.com).
    const maskedRecent = recent.map((r) => ({
      id: r.id,
      email: maskEmail(r.email),
      createdAt: r.createdAt,
    }));
    return { code: user.referralCode, count, recent: maskedRecent };
  }

  /**
   * GDPR data export — full JSON dump of every record tied to the user.
   * Volume can be large, so prefer the dedicated CSV exports for trades.
   */
  async exportData(userId: string) {
    const [user, bots, apiKeys, sessions, audit, payments, subscriptions, trades, events] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.bot.findMany({ where: { userId } }),
      this.prisma.exchangeApiKey.findMany({ where: { userId }, select: { id: true, exchange: true, label: true, status: true, createdAt: true } }),
      this.prisma.session.findMany({ where: { userId }, select: { id: true, userAgent: true, ipAddress: true, expiresAt: true, createdAt: true, revokedAt: true } }),
      this.prisma.auditLog.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 1000 }),
      this.prisma.payment.findMany({ where: { userId } }),
      this.prisma.subscription.findMany({ where: { userId } }),
      this.prisma.trade.findMany({ where: { bot: { userId } }, take: 5000, orderBy: { executedAt: 'desc' } }),
      this.prisma.botEvent.findMany({ where: { bot: { userId } }, take: 5000, orderBy: { createdAt: 'desc' } }),
    ]);
    // Strip sensitive fields before returning.
    const safeUser = user ? {
      ...user,
      passwordHash: undefined,
      twoFactorSecret: undefined,
    } : null;
    return {
      exportedAt: new Date().toISOString(),
      user: safeUser,
      bots, apiKeys, sessions, audit, payments, subscriptions,
      trades: trades.length,
      events: events.length,
      tradesSample: trades.slice(0, 100),
      eventsSample: events.slice(0, 100),
      note: 'For full trade history, use the per-bot CSV export endpoint.',
    };
  }

  /**
   * Account deletion. Requires the user to type their email to confirm.
   * This is a hard delete via Prisma cascade — bots, trades, events, etc. all go.
   * Production-grade would soft-delete with a 30-day grace period; for now,
   * we go straight delete to keep scope contained.
   */
  async deleteAccount(userId: string, confirmEmail: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, status: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.email.toLowerCase() !== confirmEmail.toLowerCase()) {
      throw new BadRequestException('Email confirmation does not match');
    }
    // Block deletion while bots are running — user must stop them first.
    const running = await this.prisma.bot.count({
      where: { userId, status: { in: ['RUNNING', 'STARTING', 'PAUSED'] } },
    });
    if (running > 0) {
      throw new BadRequestException(`Stop all ${running} active bot(s) before deleting your account.`);
    }
    await this.prisma.user.delete({ where: { id: userId } });
    return { deleted: true };
  }

  /** Send a test message via Resend to the user's email. */
  async sendTestEmail(userId: string): Promise<{ ok: true }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, fullName: true },
    });
    if (!user) throw new NotFoundException('User not found');
    const ok = await this.email.send(
      user.email,
      '🐋 Orca — Test Email',
      [
        `Hello ${user.fullName ?? user.email}!`,
        '',
        'If you can read this, your Orca email notifications are wired up correctly. 🎉',
        '',
        'You can adjust which events trigger emails in Settings → Notifications.',
      ].join('\n'),
    );
    if (!ok) {
      throw new BadRequestException(
        'Email failed to send. Verify RESEND_API_KEY is configured on the server.',
      );
    }
    return { ok: true };
  }

  /** Send a test message via Discord webhook. */
  async sendTestDiscord(userId: string): Promise<{ ok: true }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { discordWebhookUrl: true, fullName: true, email: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (!user.discordWebhookUrl) {
      throw new BadRequestException('No Discord webhook URL set. Save it first, then try again.');
    }
    const ok = await this.discord.send(
      user.discordWebhookUrl,
      `Hello ${user.fullName ?? user.email}! Your Discord webhook is wired up correctly. 🎉`,
      { title: '🐋 Orca — Test Message' },
    );
    if (!ok) {
      throw new BadRequestException(
        'Discord webhook failed. Double-check the URL — it must start with https://discord.com/api/webhooks/...',
      );
    }
    return { ok: true };
  }

  /** Send a test web-push notification to all subscribed devices. */
  async sendTestPush(userId: string): Promise<{ sent: number; failed: number }> {
    if (!this.push.isConfigured()) {
      throw new BadRequestException('Web push is not configured on the server (VAPID keys missing).');
    }
    const r = await this.push.sendToUser(userId, {
      title: '🐋 Orca — Test Push',
      body: 'Web push is wired up correctly. 🎉',
      tag: 'test',
    });
    if (r.sent === 0) {
      throw new BadRequestException(
        'No active push subscriptions. Enable browser notifications in Settings first.',
      );
    }
    return r;
  }

  async addPushSubscription(
    userId: string,
    sub: { endpoint: string; keys: { p256dh: string; auth: string }; ua?: string },
  ): Promise<{ ok: true }> {
    await this.push.addSubscription(userId, sub);
    return { ok: true };
  }

  async removePushSubscription(userId: string, endpoint: string): Promise<{ ok: true }> {
    await this.push.removeSubscription(userId, endpoint);
    return { ok: true };
  }

  /**
   * Send a test message to the user's saved Telegram chat ID. Returns
   * `{ ok: true }` on success, throws BadRequest with a friendly hint
   * when the chat ID is missing or Telegram rejects.
   */
  async sendTestTelegram(userId: string): Promise<{ ok: true }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { telegramChatId: true, fullName: true, email: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (!user.telegramChatId) {
      throw new BadRequestException(
        'No Telegram chat ID set. Save your chat ID first, then try again.',
      );
    }
    const ok = await this.telegram.send(
      user.telegramChatId,
      [
        '🐋 *Orca — Test Message*',
        '',
        `Hello ${user.fullName ?? user.email}!`,
        '',
        'If you can read this, your Telegram notifications are wired up correctly. 🎉',
        '',
        '_You can adjust which events trigger Telegram messages in Settings → Notifications._',
      ].join('\n'),
    );
    if (!ok) {
      throw new BadRequestException(
        'Telegram failed to send. Verify the chat ID is correct and that you have started a chat with the bot.',
      );
    }
    return { ok: true };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u) throw new NotFoundException('User not found');
    const ok = await argon2.verify(u.passwordHash, currentPassword);
    if (!ok) throw new NotFoundException('Current password incorrect');
    const passwordHash = await argon2.hash(newPassword);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { success: true };
  }
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const head = local.slice(0, 1);
  return `${head}${'*'.repeat(Math.max(1, local.length - 1))}@${domain}`;
}
