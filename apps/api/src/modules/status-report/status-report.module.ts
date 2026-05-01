import { Module } from '@nestjs/common';
import { BotsModule } from '../bots/bots.module';
import { StatusReportService } from './status-report.service';
import { StatusReportController } from './status-report.controller';

/**
 * Owns the periodic status report scheduler. Imports BotsModule so we can
 * reuse the enriched `BotsService.list()` output (which already has all
 * the live-stats math we need to format the report).
 *
 * NotificationsService is globally available (NotificationsModule is @Global),
 * so no explicit import needed for it.
 */
@Module({
  imports: [BotsModule],
  providers: [StatusReportService],
  controllers: [StatusReportController],
  exports: [StatusReportService],
})
export class StatusReportModule {}
