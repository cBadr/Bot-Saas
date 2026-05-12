import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/guards';
import { CurrentUser, type CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod.pipe';
import { WalletService } from './wallet.service';

const TradeDto = z.object({
  symbol: z.string().min(3),
  side: z.enum(['BUY', 'SELL']),
  price: z.coerce.number().positive().optional(),
  quantity: z.coerce.number().positive().optional(),
  quoteAmount: z.coerce.number().positive().optional(),
}).refine((d) => d.quantity !== undefined || d.quoteAmount !== undefined, {
  message: 'Either quantity or quoteAmount must be provided',
  path: ['quantity'],
});
type TradeDto = z.infer<typeof TradeDto>;

const DustDto = z.object({
  assets: z.array(z.string().min(1)).min(1).max(100),
});
type DustDto = z.infer<typeof DustDto>;

const AlertCreateDto = z.object({
  symbol: z.string().min(3),
  asset: z.string().min(1),
  direction: z.enum(['ABOVE', 'BELOW']),
  threshold: z.coerce.number().positive(),
  note: z.string().max(200).optional(),
});
type AlertCreateDto = z.infer<typeof AlertCreateDto>;

const AlertToggleDto = z.object({ enabled: z.boolean() });
type AlertToggleDto = z.infer<typeof AlertToggleDto>;

@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private readonly svc: WalletService) {}

  @Get(':apiKeyId')
  overview(@CurrentUser() u: CurrentUserPayload, @Param('apiKeyId') apiKeyId: string) {
    return this.svc.overview(u.sub, apiKeyId);
  }

  @Get(':apiKeyId/enriched')
  overviewEnriched(@CurrentUser() u: CurrentUserPayload, @Param('apiKeyId') apiKeyId: string) {
    return this.svc.overviewWithChanges(u.sub, apiKeyId);
  }

  @Get(':apiKeyId/symbol/:symbol')
  symbolInfo(
    @CurrentUser() u: CurrentUserPayload,
    @Param('apiKeyId') apiKeyId: string,
    @Param('symbol') symbol: string,
  ) {
    return this.svc.symbolInfo(u.sub, apiKeyId, symbol);
  }

  @Post(':apiKeyId/trade')
  trade(
    @CurrentUser() u: CurrentUserPayload,
    @Param('apiKeyId') apiKeyId: string,
    @Body(new ZodValidationPipe(TradeDto)) dto: TradeDto,
  ) {
    return this.svc.trade(u.sub, apiKeyId, dto);
  }

  @Delete(':apiKeyId/trade/:symbol/:orderId')
  cancelTrade(
    @CurrentUser() u: CurrentUserPayload,
    @Param('apiKeyId') apiKeyId: string,
    @Param('symbol') symbol: string,
    @Param('orderId') orderId: string,
  ) {
    return this.svc.cancelTrade(u.sub, apiKeyId, symbol, Number(orderId));
  }

  /** Cancel ALL open orders for this API key (defaults to manual-only). */
  @Post(':apiKeyId/cancel-all')
  cancelAll(
    @CurrentUser() u: CurrentUserPayload,
    @Param('apiKeyId') apiKeyId: string,
    @Body() body: { symbol?: string; includeBots?: boolean } = {},
  ) {
    return this.svc.cancelAllOpenOrders(u.sub, apiKeyId, body);
  }

  @Get(':apiKeyId/open-orders')
  openOrders(
    @CurrentUser() u: CurrentUserPayload,
    @Param('apiKeyId') apiKeyId: string,
    @Query('symbol') symbol?: string,
  ) {
    return this.svc.openOrders(u.sub, apiKeyId, symbol);
  }

  @Get(':apiKeyId/trades/:symbol')
  recentTrades(
    @CurrentUser() u: CurrentUserPayload,
    @Param('apiKeyId') apiKeyId: string,
    @Param('symbol') symbol: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.recentTrades(u.sub, apiKeyId, symbol, limit ? Number(limit) : 50);
  }

  // ─── New: deposits / withdrawals / dust / cost basis / snapshots / alerts ───

  @Get(':apiKeyId/deposits')
  deposits(@CurrentUser() u: CurrentUserPayload, @Param('apiKeyId') apiKeyId: string) {
    return this.svc.deposits(u.sub, apiKeyId);
  }

  @Get(':apiKeyId/withdrawals')
  withdrawals(@CurrentUser() u: CurrentUserPayload, @Param('apiKeyId') apiKeyId: string) {
    return this.svc.withdrawals(u.sub, apiKeyId);
  }

  @Post(':apiKeyId/dust-convert')
  dust(
    @CurrentUser() u: CurrentUserPayload,
    @Param('apiKeyId') apiKeyId: string,
    @Body(new ZodValidationPipe(DustDto)) dto: DustDto,
  ) {
    return this.svc.convertDust(u.sub, apiKeyId, dto.assets);
  }

  @Get(':apiKeyId/all-trades')
  allTrades(
    @CurrentUser() u: CurrentUserPayload,
    @Param('apiKeyId') apiKeyId: string,
    @Query('symbols') symbols?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.allTrades(u.sub, apiKeyId, {
      symbols: symbols ? symbols.split(',') : undefined,
      from, to,
      limit: limit ? Number(limit) : 500,
    });
  }

  @Get(':apiKeyId/export/trades.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async exportTrades(
    @CurrentUser() u: CurrentUserPayload,
    @Param('apiKeyId') apiKeyId: string,
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const csv = await this.svc.exportTradesCsv(u.sub, apiKeyId, from, to);
    res.setHeader('Content-Disposition', `attachment; filename="wallet-trades-${apiKeyId.slice(0, 8)}.csv"`);
    res.send(csv);
  }

  @Get(':apiKeyId/cost-basis')
  costBasis(@CurrentUser() u: CurrentUserPayload, @Param('apiKeyId') apiKeyId: string) {
    return this.svc.costBasis(u.sub, apiKeyId);
  }

  @Post(':apiKeyId/snapshot')
  snapshotNow(@CurrentUser() u: CurrentUserPayload, @Param('apiKeyId') apiKeyId: string) {
    return this.svc.snapshotNow(u.sub, apiKeyId);
  }

  @Get(':apiKeyId/snapshots')
  snapshots(
    @CurrentUser() u: CurrentUserPayload,
    @Param('apiKeyId') apiKeyId: string,
    @Query('days') days?: string,
  ) {
    return this.svc.snapshots(u.sub, apiKeyId, days ? Number(days) : 30);
  }

  // ─── Price Alerts (user-scoped, not per apiKey) ───
  @Get('alerts/list')
  listAlerts(@CurrentUser() u: CurrentUserPayload) {
    return this.svc.listAlerts(u.sub);
  }

  @Post('alerts')
  createAlert(
    @CurrentUser() u: CurrentUserPayload,
    @Body(new ZodValidationPipe(AlertCreateDto)) dto: AlertCreateDto,
  ) {
    return this.svc.createAlert(u.sub, dto);
  }

  @Patch('alerts/:id/toggle')
  toggleAlert(
    @CurrentUser() u: CurrentUserPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AlertToggleDto)) dto: AlertToggleDto,
  ) {
    return this.svc.toggleAlert(u.sub, id, dto.enabled);
  }

  @Delete('alerts/:id')
  deleteAlert(@CurrentUser() u: CurrentUserPayload, @Param('id') id: string) {
    return this.svc.deleteAlert(u.sub, id);
  }
}
