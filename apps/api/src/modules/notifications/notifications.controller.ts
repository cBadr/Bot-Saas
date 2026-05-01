import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/guards';
import { CurrentUser, type CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod.pipe';
import { NotificationsService } from './notifications.service';

const PrefDto = z.object({
  channel: z.enum(['TELEGRAM', 'EMAIL', 'DISCORD', 'PUSH', 'IN_APP']),
  eventType: z.string().min(1),
  enabled: z.boolean(),
});
type PrefDto = z.infer<typeof PrefDto>;

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get('preferences')
  prefs(@CurrentUser() u: CurrentUserPayload) {
    return this.svc.listPreferences(u.sub);
  }

  @Patch('preferences')
  setPref(@CurrentUser() u: CurrentUserPayload, @Body(new ZodValidationPipe(PrefDto)) dto: PrefDto) {
    return this.svc.setPreference(u.sub, dto.channel, dto.eventType, dto.enabled);
  }

  @Get('inbox')
  inbox(@CurrentUser() u: CurrentUserPayload, @Query('unread') unread?: string) {
    return this.svc.inbox(u.sub, { unreadOnly: unread === 'true' });
  }

  @Patch(':id/read')
  markRead(@CurrentUser() u: CurrentUserPayload, @Param('id') id: string) {
    return this.svc.markRead(u.sub, id);
  }

  @Post('mark-all-read')
  markAllRead(@CurrentUser() u: CurrentUserPayload) {
    return this.svc.markAllRead(u.sub);
  }
}
