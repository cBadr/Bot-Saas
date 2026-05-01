import { Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards';
import { CurrentUser, type CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { StatusReportService } from './status-report.service';

@Controller('status-report')
@UseGuards(JwtAuthGuard)
export class StatusReportController {
  constructor(private readonly svc: StatusReportService) {}

  /**
   * Manually trigger a status report for the current user — useful for
   * previewing what the periodic report will look like, or for an
   * on-demand snapshot.
   */
  @Post('send-now')
  sendNow(@CurrentUser() u: CurrentUserPayload) {
    return this.svc.sendNow(u.sub);
  }
}
