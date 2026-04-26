import { Controller, Delete, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards';
import { CurrentUser, type CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { SubscriptionsService } from './subscriptions.service';

@Controller('subscriptions')
@UseGuards(JwtAuthGuard)
export class SubscriptionsController {
  constructor(private readonly svc: SubscriptionsService) {}

  @Get('current')
  current(@CurrentUser() u: CurrentUserPayload) {
    return this.svc.getCurrent(u.sub);
  }

  @Get()
  list(@CurrentUser() u: CurrentUserPayload) {
    return this.svc.list(u.sub);
  }

  @Delete(':id')
  cancel(@CurrentUser() u: CurrentUserPayload, @Param('id') id: string) {
    return this.svc.cancel(u.sub, id);
  }
}
