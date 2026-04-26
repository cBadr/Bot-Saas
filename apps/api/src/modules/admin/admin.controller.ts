import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/guards';
import { ZodValidationPipe } from '../../common/pipes/zod.pipe';
import { AdminService } from './admin.service';
import { AuditService } from '../audit/audit.service';

const PlanCreateDto = z.object({
  code: z.string().min(2).max(50),
  name: z.string().min(2).max(100),
  description: z.string().max(500).optional(),
  priceUsd: z.coerce.number().nonnegative(),
  billingCycleDays: z.coerce.number().int().positive().default(30),
  maxBots: z.coerce.number().int().nonnegative().default(1),
  maxApiKeys: z.coerce.number().int().nonnegative().default(1),
  maxCustomStrategies: z.coerce.number().int().nonnegative().default(0),
  sortOrder: z.coerce.number().int().default(0),
  isActive: z.coerce.boolean().default(true),
});
type PlanCreateDto = z.infer<typeof PlanCreateDto>;

const PlanUpdateDto = PlanCreateDto.partial();
type PlanUpdateDto = z.infer<typeof PlanUpdateDto>;

const SettingDto = z.object({
  key: z.string().min(2),
  value: z.unknown(),
  isPublic: z.boolean().default(false),
  category: z.string().optional(),
});
type SettingDto = z.infer<typeof SettingDto>;

const FlagDto = z.object({
  key: z.string().min(2),
  enabled: z.boolean().optional(),
  rolloutPct: z.number().min(0).max(100).optional(),
  allowList: z.array(z.string()).optional(),
  description: z.string().optional(),
});
type FlagDto = z.infer<typeof FlagDto>;

const RoleDto = z.object({ role: z.enum(['USER', 'PRO', 'ADMIN', 'SUPER_ADMIN']) });
type RoleDto = z.infer<typeof RoleDto>;

const StatusDto = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED', 'DELETED', 'PENDING_VERIFICATION']) });
type StatusDto = z.infer<typeof StatusDto>;

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly audit: AuditService,
  ) {}

  @Get('stats')
  stats() { return this.admin.stats(); }

  // ─── Users ───
  @Get('users')
  users(@Query('search') search?: string, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.admin.listUsers({
      search,
      limit: limit ? Number(limit) : 50,
      offset: offset ? Number(offset) : 0,
    });
  }

  @Patch('users/:id/role')
  async setRole(@Param('id') id: string, @Body(new ZodValidationPipe(RoleDto)) dto: RoleDto) {
    const r = await this.admin.setUserRole(id, dto.role);
    await this.audit.log({ actorType: 'ADMIN', action: 'user.role.change', targetType: 'user', targetId: id, metadata: { newRole: dto.role } });
    return r;
  }

  @Patch('users/:id/status')
  async setStatus(@Param('id') id: string, @Body(new ZodValidationPipe(StatusDto)) dto: StatusDto) {
    const r = await this.admin.setUserStatus(id, dto.status);
    await this.audit.log({ actorType: 'ADMIN', action: 'user.status.change', targetType: 'user', targetId: id, metadata: { newStatus: dto.status } });
    return r;
  }

  // ─── Plans ───
  @Get('plans')
  plans() { return this.admin.listPlansAll(); }

  @Post('plans')
  async createPlan(@Body(new ZodValidationPipe(PlanCreateDto)) dto: PlanCreateDto) {
    const p = await this.admin.createPlan(dto);
    await this.audit.log({ actorType: 'ADMIN', action: 'plan.create', targetType: 'plan', targetId: p.id });
    return p;
  }

  @Patch('plans/:id')
  async updatePlan(@Param('id') id: string, @Body(new ZodValidationPipe(PlanUpdateDto)) dto: PlanUpdateDto) {
    const p = await this.admin.updatePlan(id, dto);
    await this.audit.log({ actorType: 'ADMIN', action: 'plan.update', targetType: 'plan', targetId: id, metadata: dto as Record<string, unknown> });
    return p;
  }

  // ─── Settings ───
  @Get('settings')
  settings() { return this.admin.listSettings(); }

  @Post('settings')
  async setSetting(@Body(new ZodValidationPipe(SettingDto)) dto: SettingDto) {
    const s = await this.admin.setSetting(dto.key, dto.value, dto.isPublic, dto.category);
    await this.audit.log({ actorType: 'ADMIN', action: 'setting.update', targetType: 'setting', targetId: dto.key });
    return s;
  }

  // ─── Feature Flags ───
  @Get('flags')
  flags() { return this.admin.listFlags(); }

  @Post('flags')
  async setFlag(@Body(new ZodValidationPipe(FlagDto)) dto: FlagDto) {
    const f = await this.admin.setFlag(dto.key, dto);
    await this.audit.log({ actorType: 'ADMIN', action: 'flag.update', targetType: 'flag', targetId: dto.key, metadata: dto });
    return f;
  }

  // ─── Audit Log ───
  @Get('audit')
  auditList(@Query('limit') limit?: string) {
    return this.audit.list({ limit: limit ? Number(limit) : 100 });
  }
}
