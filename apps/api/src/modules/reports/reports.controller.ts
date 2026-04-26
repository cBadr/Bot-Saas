import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards';
import { CurrentUser, type CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { ReportsService } from './reports.service';

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly svc: ReportsService) {}

  @Get('overview')
  overview(@CurrentUser() u: CurrentUserPayload) {
    return this.svc.overview(u.sub);
  }

  @Get('pnl-series')
  pnl(@CurrentUser() u: CurrentUserPayload, @Query('days') days?: string) {
    return this.svc.pnlSeries(u.sub, days ? Number(days) : 30);
  }

  @Get('bots/:id')
  perf(@CurrentUser() u: CurrentUserPayload, @Param('id') id: string) {
    return this.svc.botPerformance(u.sub, id);
  }
}
