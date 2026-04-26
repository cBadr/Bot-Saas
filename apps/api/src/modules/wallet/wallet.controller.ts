import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
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

@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private readonly svc: WalletService) {}

  @Get(':apiKeyId')
  overview(@CurrentUser() u: CurrentUserPayload, @Param('apiKeyId') apiKeyId: string) {
    return this.svc.overview(u.sub, apiKeyId);
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
}
