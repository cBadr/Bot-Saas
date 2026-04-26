import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createLogger } from '@orca/logger';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { coinpaymentsClient } from './coinpayments.client';

const log = createLogger('PAYMENT', { module: 'PaymentsService' });

interface CreateCheckoutInput {
  userId: string;
  email: string;
  planId: string;
  cryptoCurrency: string; // e.g. "USDT.TRC20"
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subs: SubscriptionsService,
  ) {}

  async listMyPayments(userId: string) {
    return this.prisma.payment.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async createCheckout(input: CreateCheckoutInput) {
    const plan = await this.prisma.plan.findUnique({ where: { id: input.planId } });
    if (!plan) throw new NotFoundException('Plan not found');
    if (Number(plan.priceUsd) <= 0) {
      // Free plan → activate directly without payment
      const sub = await this.subs.activateAfterPayment(input.userId, plan.id);
      return { kind: 'free' as const, subscription: sub };
    }

    const payment = await this.prisma.payment.create({
      data: {
        userId: input.userId,
        provider: 'coinpayments',
        amountUsd: plan.priceUsd,
        cryptoCurrency: input.cryptoCurrency,
        status: 'PENDING',
      },
    });

    try {
      const txn = await coinpaymentsClient.createTransaction({
        amount: Number(plan.priceUsd),
        currency1: 'USD',
        currency2: input.cryptoCurrency,
        buyerEmail: input.email,
        itemName: `Orca · ${plan.name}`,
        custom: `${input.userId}:${plan.id}:${payment.id}`,
      });
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { providerTxnId: txn.txn_id, amountCrypto: txn.amount },
      });
      return {
        kind: 'paid' as const,
        paymentId: payment.id,
        checkoutUrl: txn.checkout_url,
        statusUrl: txn.status_url,
        address: txn.address,
        amount: txn.amount,
        timeout: txn.timeout,
      };
    } catch (err) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'FAILED' },
      });
      throw err;
    }
  }

  /**
   * Process a verified IPN.
   * CoinPayments status meanings:
   *   100 / 2 = complete, 1 = pending confirmations,
   *   <0 = failed/cancelled.
   */
  async handleIpn(payload: Record<string, string>) {
    const txnId = payload.txn_id;
    const status = Number(payload.status);
    const custom = payload.custom; // userId:planId:paymentId
    if (!custom) throw new BadRequestException('Missing custom field');
    const [userId, planId, paymentId] = custom.split(':');
    if (!userId || !planId || !paymentId) throw new BadRequestException('Bad custom field');

    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException('Payment not found');

    let newStatus: 'PENDING' | 'CONFIRMING' | 'COMPLETED' | 'FAILED' | 'CANCELED' = 'PENDING';
    if (status >= 100 || status === 2) newStatus = 'COMPLETED';
    else if (status === 1) newStatus = 'CONFIRMING';
    else if (status < 0) newStatus = status === -2 ? 'CANCELED' : 'FAILED';

    await this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: newStatus,
        ipnRaw: payload as object,
        providerTxnId: txnId,
        ...(newStatus === 'COMPLETED' ? { paidAt: new Date() } : {}),
      },
    });

    log.info('IPN processed', { txnId, status, newStatus, paymentId });

    if (newStatus === 'COMPLETED') {
      const sub = await this.subs.activateAfterPayment(userId, planId);
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: { subscriptionId: sub.id },
      });
    }
    return { ok: true, status: newStatus };
  }
}
