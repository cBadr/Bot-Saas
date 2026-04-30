import { Global, Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationDispatcher } from './notification-dispatcher.service';

@Global()
@Module({
  providers: [TelegramService, NotificationsService, NotificationDispatcher],
  controllers: [NotificationsController],
  exports: [TelegramService, NotificationsService],
})
export class NotificationsModule {}
