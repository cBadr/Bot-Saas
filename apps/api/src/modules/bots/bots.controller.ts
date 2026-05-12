import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
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
  list(@CurrentUser() u: CurrentUserPayload, @Query('archived') archived?: string) {
    return this.bots.list(u.sub, { includeArchived: archived === 'true' });
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

  @Post(':id/clone')
  clone(
    @CurrentUser() u: CurrentUserPayload,
    @Param('id') id: string,
    @Body() body: { name?: string; symbol?: string } = {},
  ) {
    return this.bots.clone(u.sub, id, body);
  }

  @Get(':id/snapshot')
  snapshot(@CurrentUser() u: CurrentUserPayload, @Param('id') id: string) {
    return this.bots.snapshot(u.sub, id);
  }

  @Get(':id/export/trades.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async exportTradesCsv(
    @CurrentUser() u: CurrentUserPayload,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const csv = await this.bots.exportTradesCsv(u.sub, id);
    res.setHeader('Content-Disposition', `attachment; filename="bot-${id}-trades.csv"`);
    res.send(csv);
  }

  @Post(':id/cancel-pending')
  cancelPending(@CurrentUser() u: CurrentUserPayload, @Param('id') id: string) {
    return this.bots.cancelPendingOrders(u.sub, id);
  }

  @Get(':id/runs')
  runs(@CurrentUser() u: CurrentUserPayload, @Param('id') id: string) {
    return this.bots.listRuns(u.sub, id);
  }

  @Get(':id/runs/:runId')
  run(@CurrentUser() u: CurrentUserPayload, @Param('id') id: string, @Param('runId') runId: string) {
    return this.bots.getRun(u.sub, id, runId);
  }

  @Post(':id/runs/:runId/replay')
  replayRun(@CurrentUser() u: CurrentUserPayload, @Param('id') id: string, @Param('runId') runId: string) {
    return this.bots.replayRun(u.sub, id, runId);
  }

  @Patch(':id/params')
  updateParams(
    @CurrentUser() u: CurrentUserPayload,
    @Param('id') id: string,
    @Body() body: { params: Record<string, unknown> },
  ) {
    return this.bots.updateParams(u.sub, id, body.params ?? {});
  }

  @Post(':id/archive')
  archive(@CurrentUser() u: CurrentUserPayload, @Param('id') id: string) {
    return this.bots.archiveBot(u.sub, id);
  }

  @Post(':id/unarchive')
  unarchive(@CurrentUser() u: CurrentUserPayload, @Param('id') id: string) {
    return this.bots.unarchiveBot(u.sub, id);
  }

  @Delete(':id')
  remove(@CurrentUser() u: CurrentUserPayload, @Param('id') id: string) {
    return this.bots.remove(u.sub, id);
  }
}
