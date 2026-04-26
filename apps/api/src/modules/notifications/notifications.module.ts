import { Global, Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';

@Global()
@Module({
  providers: [TelegramService, NotificationsService],
  controllers: [NotificationsController],
  exports: [TelegramService, NotificationsService],
})
export class NotificationsModule {}
