import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/guards';
import { CurrentUser, type CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod.pipe';
import { BotsService } from './bots.service';

const CreateBotDto = z.object({
  name: z.string().min(2).max(100),
  strategyId: z.string().min(1),
  apiKeyId: z.string().min(1),
  symbol: z.string().min(3).max(20),
  params: z.record(z.unknown()),
  riskConfig: z.record(z.unknown()).optional(),
  paperTrading: z.boolean().optional(),
  dailyLossLimit: z.coerce.number().positive().optional(),
  maxDrawdownPct: z.coerce.number().positive().max(100).optional(),
});
type CreateBotDto = z.infer<typeof CreateBotDto>;

const RiskConfigDto = z.object({
  dailyLossLimit: z.coerce.number().positive().nullable().optional(),
  maxDrawdownPct: z.coerce.number().positive().max(100).nullable().optional(),
});
type RiskConfigDto = z.infer<typeof RiskConfigDto>;

@Controller('bots')
@UseGuards(JwtAuthGuard)
export class BotsController {
  constructor(private readonly bots: BotsService) {}

  @Get()
  list(@CurrentUser() u: CurrentUserPayload) {
    return this.bots.list(u.sub);
  }

  @Get(':id')
  get(@CurrentUser() u: CurrentUserPayload, @Param('id') id: string) {
    return this.bots.get(u.sub, id);
  }

  @Get(':id/events')
  events(@CurrentUser() u: CurrentUserPayload, @Param('id') id: string, @Query('limit') limit?: string) {
    return this.bots.events(u.sub, id, limit ? Number(limit) : 100);
  }

  @Get(':id/orders')
  orders(@CurrentUser() u: CurrentUserPayload, @Param('id') id: string, @Query('limit') limit?: string) {
    return this.bots.orders(u.sub, id, limit ? Number(limit) : 100);
  }

  @Get(':id/live')
  live(@CurrentUser() u: CurrentUserPayload, @Param('id') id: string) {
    return this.bots.live(u.sub, id);
  }

  @Post()
  create(@CurrentUser() u: CurrentUserPayload, @Body(new ZodValidationPipe(CreateBotDto)) dto: CreateBotDto) {
    return this.bots.create(u.sub, dto);
  }

  @Post(':id/start')
  start(@CurrentUser() u: CurrentUserPayload, @Param('id') id: string) {
    return this.bots.start(u.sub, id);
  }

  @Post(':id/stop')
  stop(@CurrentUser() u: CurrentUserPayload, @Param('id') id: string) {
    return this.bots.stop(u.sub, id);
  }

  @Post(':id/recompute-stats')
  recomputeStats(@CurrentUser() u: CurrentUserPayload, @Param('id') id: string) {
    return this.bots.recomputeStats(u.sub, id);
  }

  /** 🛑 Kill Switch — stops ALL of this user's bots immediately. */
  @Post('emergency-stop')
  emergencyStop(@CurrentUser() u: CurrentUserPayload) {
    return this.bots.emergencyStopAll(u.sub);
  }

  @Patch(':id/risk')
  updateRisk(
    @CurrentUser() u: CurrentUserPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RiskConfigDto)) dto: RiskConfigDto,
  ) {
    return this.bots.updateRiskConfig(u.sub, id, dto);
  }

  @Post('recompute-stats')
  recomputeAllForUser(@CurrentUser() u: CurrentUserPayload) {
    return this.bots.recomputeAllForUser(u.sub);
  }

  @Delete(':id')
  remove(@CurrentUser() u: CurrentUserPayload, @Param('id') id: string) {
    return this.bots.remove(u.sub, id);
  }
}
