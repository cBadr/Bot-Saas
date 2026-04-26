import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class SubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Returns the user's active or most-recent subscription. */
  async getCurrent(userId: string) {
    const sub = await this.prisma.subscription.findFirst({
      where: { userId },
      orderBy: [{ status: 'asc' }, { endsAt: 'desc' }],
      include: { plan: true },
    });
    return sub;
  }

  async list(userId: string) {
    return this.prisma.subscription.findMany({
      where: { userId },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async cancel(userId: string, id: string) {
    const sub = await this.prisma.subscription.findUnique({ where: { id } });
    if (!sub || sub.userId !== userId) throw new NotFoundException('Subscription not found');
    return this.prisma.subscription.update({
      where: { id },
      data: { autoRenew: false, canceledAt: new Date() },
    });
  }

  /** Activates / extends a subscription after successful payment. */
  async activateAfterPayment(userId: string, planId: string) {
    const plan = await this.prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Plan not found');

    const existing = await this.prisma.subscription.findFirst({
      where: { userId, planId, status: { in: ['ACTIVE', 'TRIAL', 'PAST_DUE'] } },
      orderBy: { endsAt: 'desc' },
    });

    const now = new Date();
    const baseDate = existing && existing.endsAt > now ? existing.endsAt : now;
    const endsAt = new Date(baseDate.getTime() + plan.billingCycleDays * 86_400_000);

    if (existing) {
      return this.prisma.subscription.update({
        where: { id: existing.id },
        data: { status: 'ACTIVE', endsAt, canceledAt: null },
        include: { plan: true },
      });
    }
    return this.prisma.subscription.create({
      data: { userId, planId, status: 'ACTIVE', startsAt: now, endsAt },
      include: { plan: true },
    });
  }
}
