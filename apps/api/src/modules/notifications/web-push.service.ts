import { Injectable, OnModuleInit } from '@nestjs/common';
import webpush from 'web-push';
import { env } from '@orca/config';
import { createLogger } from '@orca/logger';
import { PrismaService } from '../../common/prisma/prisma.service';

const log = createLogger('SYSTEM', { module: 'WebPush' });

export interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  ua?: string;
  createdAt?: string;
}

@Injectable()
export class WebPushService implements OnModuleInit {
  private configured = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
      try {
        webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
        this.configured = true;
      } catch (err) {
        log.error('Invalid VAPID keys', { err: err instanceof Error ? err.message : String(err) });
      }
    } else {
      log.warn('VAPID keys not configured, web push disabled');
    }
  }

  isConfigured(): boolean {
    return this.configured;
  }

  /** Sends a push to all stored subscriptions for the user. Prunes invalid (404/410) endpoints. */
  async sendToUser(
    userId: string,
    payload: { title: string; body: string; url?: string; tag?: string },
  ): Promise<{ sent: number; failed: number }> {
    if (!this.configured) return { sent: 0, failed: 0 };
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { pushSubscriptions: true },
    });
    const subs = (user?.pushSubscriptions as unknown as PushSub[]) ?? [];
    if (!subs.length) return { sent: 0, failed: 0 };

    const body = JSON.stringify(payload);
    let sent = 0;
    let failed = 0;
    const stillValid: PushSub[] = [];

    for (const sub of subs) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, body);
        sent++;
        stillValid.push(sub);
      } catch (err: unknown) {
        const status = (err as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) {
          // expired/unsubscribed — drop it
        } else {
          stillValid.push(sub);
        }
        failed++;
        log.warn('Push send failed', { status, endpoint: sub.endpoint.slice(0, 50) });
      }
    }

    if (stillValid.length !== subs.length) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { pushSubscriptions: stillValid as unknown as object },
      });
    }

    return { sent, failed };
  }

  async addSubscription(userId: string, sub: PushSub): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { pushSubscriptions: true },
    });
    const existing = (user?.pushSubscriptions as unknown as PushSub[]) ?? [];
    if (existing.some((s) => s.endpoint === sub.endpoint)) return;
    const next = [
      ...existing,
      { endpoint: sub.endpoint, keys: sub.keys, ua: sub.ua, createdAt: new Date().toISOString() },
    ];
    await this.prisma.user.update({
      where: { id: userId },
      data: { pushSubscriptions: next as unknown as object },
    });
  }

  async removeSubscription(userId: string, endpoint: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { pushSubscriptions: true },
    });
    const existing = (user?.pushSubscriptions as unknown as PushSub[]) ?? [];
    const next = existing.filter((s) => s.endpoint !== endpoint);
    await this.prisma.user.update({
      where: { id: userId },
      data: { pushSubscriptions: next as unknown as object },
    });
  }
}
