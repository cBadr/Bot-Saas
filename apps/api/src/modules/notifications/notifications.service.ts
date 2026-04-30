import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TelegramService } from './telegram.service';

export type NotificationEvent =
  | 'BOT_STARTED' | 'BOT_STOPPED' | 'BOT_ERROR'
  | 'ORDER_FILLED' | 'CYCLE_COMPLETED'
  | 'TAKE_PROFIT_HIT' | 'STOP_LOSS_HIT'
  | 'PAYMENT_RECEIVED' | 'SUBSCRIPTION_EXPIRING';

export const ALL_NOTIFICATION_EVENTS: NotificationEvent[] = [
  'BOT_STARTED', 'BOT_STOPPED', 'BOT_ERROR',
  'ORDER_FILLED', 'CYCLE_COMPLETED',
  'TAKE_PROFIT_HIT', 'STOP_LOSS_HIT',
  'PAYMENT_RECEIVED', 'SUBSCRIPTION_EXPIRING',
];

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
  ) {}

  async notify(userId: string, event: NotificationEvent, message: string, data?: Record<string, unknown>) {
    const prefs = await this.prisma.notificationPreference.findMany({
      where: { userId, eventType: event, enabled: true },
    });
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { telegramChatId: true },
    });

    const channels = prefs.length ? prefs.map((p) => p.channel) : (['IN_APP', 'TELEGRAM'] as const);

    for (const channel of channels) {
      let success = false;
      let error: string | null = null;
      try {
        if (channel === 'TELEGRAM' && user?.telegramChatId) {
          success = await this.telegram.send(user.telegramChatId, `🐋 *Orca*\n${message}`);
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

  async listPreferences(userId: string) {
    return this.prisma.notificationPreference.findMany({ where: { userId } });
  }

  async setPreference(userId: string, channel: 'TELEGRAM' | 'EMAIL' | 'DISCORD' | 'IN_APP', eventType: string, enabled: boolean) {
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
