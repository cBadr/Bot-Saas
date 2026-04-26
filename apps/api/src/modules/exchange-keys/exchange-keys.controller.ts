import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/guards';
import { CurrentUser, type CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod.pipe';
import { ExchangeKeysService } from './exchange-keys.service';

const CreateKeyDto = z.object({
  label: z.string().min(2).max(50),
  apiKey: z.string().min(20),
  apiSecret: z.string().min(20),
});
type CreateKeyDto = z.infer<typeof CreateKeyDto>;

@Controller('exchange-keys')
@UseGuards(JwtAuthGuard)
export class ExchangeKeysController {
  constructor(private readonly svc: ExchangeKeysService) {}

  @Get()
  list(@CurrentUser() u: CurrentUserPayload) {
    return this.svc.list(u.sub);
  }

  @Post()
  create(
    @CurrentUser() u: CurrentUserPayload,
    @Body(new ZodValidationPipe(CreateKeyDto)) dto: CreateKeyDto,
  ) {
    return this.svc.create(u.sub, dto);
  }

  @Post(':id/test')
  test(@CurrentUser() u: CurrentUserPayload, @Param('id') id: string) {
    return this.svc.test(u.sub, id);
  }

  /** Get current balance of a specific asset (used to default totalQuoteInvestment). */
  @Get(':id/balance/:asset')
  balance(
    @CurrentUser() u: CurrentUserPayload,
    @Param('id') id: string,
    @Param('asset') asset: string,
  ) {
    return this.svc.assetBalance(u.sub, id, asset.toUpperCase());
  }

  @Delete(':id')
  remove(@CurrentUser() u: CurrentUserPayload, @Param('id') id: string) {
    return this.svc.remove(u.sub, id);
  }
}
