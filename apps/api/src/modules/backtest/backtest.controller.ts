import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/guards';
import { CurrentUser, type CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod.pipe';
import { BacktestService } from './backtest.service';

const RunDto = z.object({
  strategyId: z.string().min(1),
  symbol: z.string().min(3),
  interval: z.enum(['1m', '5m', '15m', '1h', '4h', '1d']).default('1h'),
  days: z.coerce.number().min(1).max(180).default(30),
  params: z.record(z.unknown()).default({}),
});
type RunDto = z.infer<typeof RunDto>;

@Controller('backtest')
@UseGuards(JwtAuthGuard)
export class BacktestController {
  constructor(private readonly svc: BacktestService) {}

  @Post('run')
  run(
    @CurrentUser() u: CurrentUserPayload,
    @Body(new ZodValidationPipe(RunDto)) dto: RunDto,
  ) {
    return this.svc.run(u.sub, dto);
  }
}
