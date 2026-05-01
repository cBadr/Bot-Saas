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

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
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
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
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
      notificationConfig?: {
        notifyOnBuyFills?: boolean;
        notifyOnSellFills?: boolean;
        minFillNotional?: number;
        minCyclePnl?: number;
      };
    },
  ) {
    return this.prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true, email: true, fullName: true, avatarUrl: true,
        telegramChatId: true, telegramUsername: true,
        discordWebhookUrl: true,
        fillFrequency: true, notificationConfig: true,
      },
    });
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
