import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(input: {
    userId?: string;
    actorType: 'USER' | 'ADMIN' | 'SYSTEM';
    action: string;
    targetType?: string;
    targetId?: string;
    ipAddress?: string;
    userAgent?: string;
    metadata?: Record<string, unknown>;
  }) {
    await this.prisma.auditLog.create({
      data: {
        userId: input.userId,
        actorType: input.actorType,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        ...(input.metadata ? { metadata: input.metadata as object } : {}),
      },
    });
  }

  list(opts: {
    limit?: number;
    userId?: string;
    action?: string;
    actorType?: string;
    targetType?: string;
    from?: string;
    to?: string;
  } = {}) {
    const dateFilter: Record<string, Date> = {};
    if (opts.from) dateFilter.gte = new Date(opts.from);
    if (opts.to) dateFilter.lte = new Date(opts.to);
    return this.prisma.auditLog.findMany({
      where: {
        ...(opts.userId ? { userId: opts.userId } : {}),
        ...(opts.action ? { action: { contains: opts.action, mode: 'insensitive' as const } } : {}),
        ...(opts.actorType ? { actorType: opts.actorType } : {}),
        ...(opts.targetType ? { targetType: opts.targetType } : {}),
        ...(Object.keys(dateFilter).length ? { createdAt: dateFilter } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(5000, opts.limit ?? 100),
    });
  }
}
