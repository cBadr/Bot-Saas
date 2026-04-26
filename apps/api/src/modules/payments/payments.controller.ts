import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/guards';
import { CurrentUser, type CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod.pipe';
import { PaymentsService } from './payments.service';
import { coinpaymentsClient } from './coinpayments.client';

const CheckoutDto = z.object({
  planId: z.string().min(1),
  cryptoCurrency: z.string().default('USDT.TRC20'),
});
type CheckoutDto = z.infer<typeof CheckoutDto>;

@Controller('payments')
export class PaymentsController {
  constructor(private readonly svc: PaymentsService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  myHistory(@CurrentUser() u: CurrentUserPayload) {
    return this.svc.listMyPayments(u.sub);
  }

  @Post('checkout')
  @UseGuards(JwtAuthGuard)
  checkout(@CurrentUser() u: CurrentUserPayload, @Body(new ZodValidationPipe(CheckoutDto)) dto: CheckoutDto) {
    return this.svc.createCheckout({
      userId: u.sub,
      email: u.email,
      planId: dto.planId,
      cryptoCurrency: dto.cryptoCurrency,
    });
  }

  /** CoinPayments IPN webhook (HMAC-signed via header). */
  @Post('coinpayments/ipn')
  ipn(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('hmac') hmacHeader?: string,
    @Body() body?: Record<string, string>,
  ) {
    const raw = req.rawBody?.toString('utf8') ?? '';
    if (!coinpaymentsClient.verifyIpnSignature(raw, hmacHeader)) {
      throw new BadRequestException('Invalid HMAC signature');
    }
    return this.svc.handleIpn(body ?? {});
  }
}
