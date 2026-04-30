import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { env } from '@orca/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { ENGINE_EVENT_CHANNEL, type EngineEvent } from '../bots/engine-bridge';
import { NotificationsService } from './notifications.service';
import { mapBotEvent, type FillFrequency, type NotificationConfig } from './event-types';

/**
 * Subscribes to the engine's BotEvent firehose on Redis and routes
 * notification-worthy events through `NotificationsService`.
 *
 * Adds a SECOND `message` listener to the shared Redis subscriber that
 * `RealtimeGateway` already uses — both fire on each message. We don't
 * `subscribe()` to the channel ourselves because RealtimeGateway already
 * does that on boot; the listener simply receives the broadcast.
 */
@Injectable()
export class NotificationDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(NotificationDispatcher.name);
  private readonly handler = (channel: string, raw: string) => {
    if (channel !== ENGINE_EVENT_CHANNEL) return;
    void this.handleEngineEvent(raw);
  };

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async onModuleInit() {
    // Idempotent: subscribing twice on ioredis is a no-op when already subscribed.
    // RealtimeGateway also subscribes — both listeners receive every message.
    await this.redis.subscriber.subscribe(ENGINE_EVENT_CHANNEL);
    this.redis.subscriber.on('message', this.handler);
    this.log.log(`Listening for BotEvents on ${ENGINE_EVENT_CHANNEL}`);
  }

  onModuleDestroy() {
    this.redis.subscriber.off('message', this.handler);
  }

  private async handleEngineEvent(raw: string): Promise<void> {
    let evt: EngineEvent;
    try {
      evt = JSON.parse(raw) as EngineEvent;
    } catch {
      return;
    }
    // We only care about BOT_EVENT (named events with payloads). BOT_STATUS
    // (RUNNING/STOPPED transitions) is handled separately by bots.service.ts
    // which already sends BOT_STARTED / BOT_STOPPED notifications.
    if (evt.type !== 'BOT_EVENT') return;
    if (!('botId' in evt) || !evt.botId) return;

    try {
      const bot = await this.prisma.bot.findUnique({
        where: { id: evt.botId },
        select: {
          id: true, name: true, symbol: true, paperTrading: true,
          userId: true, quoteAsset: true,
          strategy: { select: { name: true, builtinKey: true } },
        },
      });
      if (!bot) return;

      const user = await this.prisma.user.findUnique({
        where: { id: bot.userId },
        select: { fillFrequency: true, notificationConfig: true },
      });
      const fillFrequency = (user?.fillFrequency ?? 'PER_CYCLE') as FillFrequency;
      const notificationConfig =
        (user?.notificationConfig as NotificationConfig | null) ?? undefined;

      const formatted = mapBotEvent(evt.event, {
        data: evt.data ?? {},
        bot: {
          id: bot.id,
          name: bot.name,
          symbol: bot.symbol,
          paperTrading: bot.paperTrading,
          quoteAsset: bot.quoteAsset,
          strategy: bot.strategy,
        },
        fillFrequency,
        notificationConfig,
        webBaseUrl: env.PUBLIC_WEB_URL,
      });

      if (!formatted || !formatted.send) return;

      await this.notifications.notify(
        bot.userId,
        formatted.notificationEvent,
        formatted.body,
        {
          botId: bot.id,
          botEventType: evt.event,
          title: formatted.title,
          ...(evt.data ?? {}),
        },
      );
    } catch (err) {
      this.log.warn(`Failed to dispatch notification for ${evt.event}: ${
        err instanceof Error ? err.message : String(err)
      }`);
    }
  }
}
