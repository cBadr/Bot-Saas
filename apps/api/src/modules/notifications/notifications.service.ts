import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TelegramService } from './telegram.service';
import { EmailService } from './email.service';
import { DiscordService } from './discord.service';
import { WebPushService } from './web-push.service';

export type NotificationEvent =
  | 'BOT_STARTED' | 'BOT_STOPPED' | 'BOT_ERROR'
  | 'ORDER_FILLED' | 'CYCLE_COMPLETED'
  | 'TAKE_PROFIT_HIT' | 'STOP_LOSS_HIT'
  | 'PAYMENT_RECEIVED' | 'SUBSCRIPTION_EXPIRING'
  | 'STATUS_REPORT';

export const ALL_NOTIFICATION_EVENTS: NotificationEvent[] = [
  'BOT_STARTED', 'BOT_STOPPED', 'BOT_ERROR',
  'ORDER_FILLED', 'CYCLE_COMPLETED',
  'TAKE_PROFIT_HIT', 'STOP_LOSS_HIT',
  'PAYMENT_RECEIVED', 'SUBSCRIPTION_EXPIRING',
  'STATUS_REPORT',
];

export type NotificationChannel = 'TELEGRAM' | 'EMAIL' | 'DISCORD' | 'PUSH' | 'IN_APP';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
    private readonly email: EmailService,
    private readonly discord: DiscordService,
    private readonly push: WebPushService,
  ) {}

  async notify(userId: string, event: NotificationEvent, message: string, data?: Record<string, unknown>) {
    const prefs = await this.prisma.notificationPreference.findMany({
      where: { userId, eventType: event, enabled: true },
    });
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { telegramChatId: true, email: true, discordWebhookUrl: true },
    });

    const channels: NotificationChannel[] = prefs.length
      ? (prefs.map((p) => p.channel) as NotificationChannel[])
      : ['IN_APP', 'TELEGRAM'];

    const title = (data?.title as string | undefined) ?? this.titleFor(event);
    const url = (data?.url as string | undefined) ?? undefined;

    for (const channel of channels) {
      let success = false;
      let error: string | null = null;
      try {
        if (channel === 'TELEGRAM' && user?.telegramChatId) {
          success = await this.telegram.send(user.telegramChatId, `🐋 *Orca*\n${message}`);
        } else if (channel === 'EMAIL' && user?.email) {
          success = await this.email.send(user.email, title, message);
        } else if (channel === 'DISCORD' && user?.discordWebhookUrl) {
          success = await this.discord.send(user.discordWebhookUrl, message, { title });
        } else if (channel === 'PUSH') {
          const r = await this.push.sendToUser(userId, { title, body: message, url, tag: event });
          success = r.sent > 0;
        } else if (channel === 'IN_APP') {
          success = true;
        }
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
      await this.prisma.notificationLog.create({
        data: {
          userId,
          channel,
          eventType: event,
          payload: { message, ...(data ?? {}) } as object,
          success,
          error,
        },
      });
    }
  }

  private titleFor(event: NotificationEvent): string {
    switch (event) {
      case 'BOT_STARTED': return '✅ Bot started';
      case 'BOT_STOPPED': return '🛑 Bot stopped';
      case 'BOT_ERROR': return '⚠️ Bot error';
      case 'ORDER_FILLED': return '📈 Order filled';
      case 'CYCLE_COMPLETED': return '🎯 Cycle completed';
      case 'TAKE_PROFIT_HIT': return '💰 Take profit hit';
      case 'STOP_LOSS_HIT': return '🛡️ Stop loss hit';
      case 'PAYMENT_RECEIVED': return '💳 Payment received';
      case 'SUBSCRIPTION_EXPIRING': return '⏰ Subscription expiring';
      case 'STATUS_REPORT': return '📊 Orca status report';
      default: return '🐋 Orca';
    }
  }

  async listPreferences(userId: string) {
    return this.prisma.notificationPreference.findMany({ where: { userId } });
  }

  async setPreference(userId: string, channel: NotificationChannel, eventType: string, enabled: boolean) {
    return this.prisma.notificationPreference.upsert({
      where: { userId_channel_eventType: { userId, channel, eventType } },
      create: { userId, channel, eventType, enabled },
      update: { enabled },
    });
  }

  /** In-app inbox: list IN_APP notification logs (most recent first). */
  async inbox(userId: string, opts: { limit?: number; unreadOnly?: boolean } = {}) {
    const items = await this.prisma.notificationLog.findMany({
      where: {
        userId,
        channel: 'IN_APP',
        ...(opts.unreadOnly ? { error: null } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(100, opts.limit ?? 50),
    });
    const unreadCount = await this.prisma.notificationLog.count({
      where: { userId, channel: 'IN_APP', error: null },
    });
    return { items, unreadCount };
  }

  async markRead(userId: string, id: string) {
    await this.prisma.notificationLog.updateMany({
      where: { id, userId },
      data: { error: 'READ' },
    });
    return { success: true };
  }

  async markAllRead(userId: string) {
    const r = await this.prisma.notificationLog.updateMany({
      where: { userId, channel: 'IN_APP', error: null },
      data: { error: 'READ' },
    });
    return { updated: r.count };
  }
}
