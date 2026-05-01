import { Global, Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { EmailService } from './email.service';
import { DiscordService } from './discord.service';
import { WebPushService } from './web-push.service';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationDispatcher } from './notification-dispatcher.service';

@Global()
@Module({
  providers: [
    TelegramService,
    EmailService,
    DiscordService,
    WebPushService,
    NotificationsService,
    NotificationDispatcher,
  ],
  controllers: [NotificationsController],
  exports: [TelegramService, EmailService, DiscordService, WebPushService, NotificationsService],
})
export class NotificationsModule {}
