import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class StrategiesService {
  constructor(private readonly prisma: PrismaService) {}

  /** All strategies visible to a user: built-in + their own + public marketplace. */
  list(userId: string) {
    return this.prisma.strategy.findMany({
      where: {
        OR: [
          { visibility: 'BUILTIN' },
          { visibility: 'PUBLIC' },
          { ownerId: userId },
        ],
        isActive: true,
      },
      orderBy: [{ visibility: 'asc' }, { name: 'asc' }],
    });
  }

  async get(userId: string, id: string) {
    const s = await this.prisma.strategy.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Strategy not found');
    if (s.visibility === 'PRIVATE' && s.ownerId !== userId) {
      throw new ForbiddenException();
    }
    return s;
  }

  create(userId: string, dto: { name: string; description?: string; definition: unknown; paramsSchema?: unknown }) {
    return this.prisma.strategy.create({
      data: {
        ownerId: userId,
        name: dto.name,
        description: dto.description,
        type: 'CUSTOM',
        visibility: 'PRIVATE',
        definition: dto.definition as object,
        paramsSchema: dto.paramsSchema as object | undefined,
      },
    });
  }

  async update(userId: string, id: string, dto: { name?: string; description?: string; definition?: unknown; paramsSchema?: unknown }) {
    const s = await this.prisma.strategy.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Strategy not found');
    if (s.ownerId !== userId) throw new ForbiddenException();
    if (s.visibility === 'BUILTIN') throw new ForbiddenException('Cannot edit built-in strategy');
    return this.prisma.strategy.update({
      where: { id },
      data: {
        name: dto.name ?? s.name,
        description: dto.description ?? s.description,
        definition: (dto.definition ?? s.definition) as object,
        paramsSchema: (dto.paramsSchema ?? s.paramsSchema) as object | undefined,
        version: { increment: 1 },
      },
    });
  }

  async remove(userId: string, id: string) {
    const s = await this.prisma.strategy.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Strategy not found');
    if (s.ownerId !== userId) throw new ForbiddenException();
    if (s.visibility === 'BUILTIN') throw new ForbiddenException('Cannot delete built-in strategy');
    const inUse = await this.prisma.bot.count({ where: { strategyId: id } });
    if (inUse > 0) throw new ForbiddenException(`Strategy in use by ${inUse} bot(s)`);
    await this.prisma.strategy.delete({ where: { id } });
    return { success: true };
  }
}
