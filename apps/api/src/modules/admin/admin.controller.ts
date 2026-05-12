import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentUser, type CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/guards';
import { ZodValidationPipe } from '../../common/pipes/zod.pipe';
import { AdminService } from './admin.service';
import { AdminSecurityGuard } from './admin-security.guard';
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
const ForceStopDto = z.object({ reason: z.string().min(3).max(500) });
type ForceStopDto = z.infer<typeof ForceStopDto>;
const RefundDto = z.object({ reason: z.string().min(3).max(500) });
type RefundDto = z.infer<typeof RefundDto>;
const ExtendSubDto = z.object({ days: z.coerce.number().int().min(1).max(3650) });
type ExtendSubDto = z.infer<typeof ExtendSubDto>;
const MaintenanceDto = z.object({ enabled: z.boolean() });
type MaintenanceDto = z.infer<typeof MaintenanceDto>;

const BulkUsersDto = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
  role: z.enum(['USER', 'PRO', 'ADMIN', 'SUPER_ADMIN']).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DELETED', 'PENDING_VERIFICATION']).optional(),
});
type BulkUsersDto = z.infer<typeof BulkUsersDto>;

const AnnouncementDto = z.object({
  enabled: z.boolean(),
  message: z.string().min(1).max(500),
  severity: z.enum(['info', 'warning', 'critical']),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
});
type AnnouncementDto = z.infer<typeof AnnouncementDto>;

const ChangeEmailDto = z.object({ email: z.string().email() });
type ChangeEmailDto = z.infer<typeof ChangeEmailDto>;

const NotesDto = z.object({
  notes: z.string().max(2000).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
});
type NotesDto = z.infer<typeof NotesDto>;

const SecuritySettingsDto = z.object({
  requireMfaForAdmin: z.boolean().optional(),
  ipAllowlist: z.array(z.string().min(1).max(45)).max(100).optional(),
});
type SecuritySettingsDto = z.infer<typeof SecuritySettingsDto>;

const CouponCreateDto = z.object({
  code: z.string().min(2).max(50),
  description: z.string().max(200).optional(),
  discountType: z.enum(['PERCENT', 'FIXED']),
  discountValue: z.coerce.number().nonnegative(),
  applicablePlans: z.array(z.string()).optional(),
  maxRedemptions: z.coerce.number().int().positive().optional(),
  perUserLimit: z.coerce.number().int().positive().optional(),
  validFrom: z.string().optional(),
  validUntil: z.string().optional(),
  isActive: z.boolean().optional(),
});
type CouponCreateDto = z.infer<typeof CouponCreateDto>;

const CouponUpdateDto = z.object({
  description: z.string().max(200).optional(),
  applicablePlans: z.array(z.string()).optional(),
  maxRedemptions: z.coerce.number().int().positive().nullable().optional(),
  perUserLimit: z.coerce.number().int().positive().optional(),
  validUntil: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});
type CouponUpdateDto = z.infer<typeof CouponUpdateDto>;

const EmailTemplateDto = z.object({
  key: z.string().min(2).max(80),
  name: z.string().min(1).max(120),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(10_000),
  variables: z.array(z.string()).optional(),
  description: z.string().max(500).optional(),
  isActive: z.boolean().optional(),
});
type EmailTemplateDto = z.infer<typeof EmailTemplateDto>;

const ApprovalRequestDto = z.object({
  action: z.string().min(2).max(80),
  targetType: z.string().optional(),
  targetId: z.string().optional(),
  payload: z.record(z.unknown()),
  reason: z.string().optional(),
  ttlHours: z.coerce.number().int().min(1).max(720).optional(),
});
type ApprovalRequestDto = z.infer<typeof ApprovalRequestDto>;

const RejectDto = z.object({ reason: z.string().max(500).optional() });
type RejectDto = z.infer<typeof RejectDto>;

const FlagDtoExtended = z.object({
  key: z.string().min(2),
  enabled: z.boolean().optional(),
  rolloutPct: z.number().min(0).max(100).optional(),
  allowList: z.array(z.string()).optional(),
  description: z.string().optional(),
  targeting: z.object({
    roles: z.array(z.enum(['USER', 'PRO', 'ADMIN', 'SUPER_ADMIN'])).optional(),
    plans: z.array(z.string()).optional(),
    countries: z.array(z.string().length(2)).optional(),
    signupAfter: z.string().optional(),
    signupBefore: z.string().optional(),
    minBots: z.coerce.number().int().nonnegative().optional(),
    trialOnly: z.boolean().optional(),
  }).optional(),
});
type FlagDtoExtended = z.infer<typeof FlagDtoExtended>;

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard, AdminSecurityGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly audit: AuditService,
  ) {}

  // ─── Overview ───
  @Get('stats')
  stats() { return this.admin.stats(); }

  @Get('timeseries')
  timeseries(@Query('days') days?: string) {
    return this.admin.dailyTimeseries(days ? Math.min(365, Math.max(7, Number(days))) : 90);
  }

  @Get('alerts')
  alerts() { return this.admin.alerts(); }

  @Get('funnel')
  funnel() { return this.admin.funnel(); }

  @Get('top-lists')
  topLists() { return this.admin.topLists(); }

  @Get('strategy-usage')
  strategyUsage() { return this.admin.strategyUsage(); }

  // ─── Users ───
  @Get('users')
  users(
    @Query('search') search?: string,
    @Query('role') role?: string,
    @Query('status') status?: string,
    @Query('hasBots') hasBots?: string,
    @Query('twoFactor') twoFactor?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.admin.listUsers({
      search,
      role: role as never,
      status: status as never,
      hasBots: hasBots === 'true' ? true : hasBots === 'false' ? false : undefined,
      twoFactor: twoFactor === 'true' ? true : twoFactor === 'false' ? false : undefined,
      limit: limit ? Number(limit) : 50,
      offset: offset ? Number(offset) : 0,
    });
  }

  @Get('users/:id')
  user(@Param('id') id: string) {
    return this.admin.getUser(id);
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

  @Post('users/:id/reset-mfa')
  async resetMfa(@Param('id') id: string) {
    const r = await this.admin.resetUserMfa(id);
    await this.audit.log({ actorType: 'ADMIN', action: 'user.mfa.reset', targetType: 'user', targetId: id });
    return r;
  }

  @Post('users/:id/impersonate')
  async impersonate(@CurrentUser() admin: CurrentUserPayload, @Param('id') id: string) {
    const r = await this.admin.impersonate(admin.sub, id);
    await this.audit.log({
      actorType: 'ADMIN', userId: admin.sub,
      action: 'user.impersonate', targetType: 'user', targetId: id,
      metadata: { targetEmail: r.targetEmail },
    });
    return r;
  }

  @Post('users/bulk-update')
  async bulkUpdate(@Body(new ZodValidationPipe(BulkUsersDto)) dto: BulkUsersDto) {
    const r = await this.admin.bulkUpdateUsers(dto.ids, { role: dto.role as never, status: dto.status as never });
    await this.audit.log({
      actorType: 'ADMIN',
      action: 'users.bulk_update',
      metadata: { count: dto.ids.length, role: dto.role, status: dto.status },
    });
    return r;
  }

  @Post('users/:id/reset-password')
  async resetPasswordForUser(@Param('id') id: string) {
    const r = await this.admin.adminResetPassword(id);
    await this.audit.log({
      actorType: 'ADMIN', action: 'user.password.reset',
      targetType: 'user', targetId: id, metadata: { email: r.email },
    });
    return r;
  }

  @Patch('users/:id/email')
  async changeEmail(@Param('id') id: string, @Body(new ZodValidationPipe(ChangeEmailDto)) dto: ChangeEmailDto) {
    const r = await this.admin.adminChangeEmail(id, dto.email);
    await this.audit.log({
      actorType: 'ADMIN', action: 'user.email.change',
      targetType: 'user', targetId: id, metadata: { newEmail: dto.email },
    });
    return r;
  }

  @Patch('users/:id/notes')
  async setNotes(@Param('id') id: string, @Body(new ZodValidationPipe(NotesDto)) dto: NotesDto) {
    const r = await this.admin.setUserNotes(id, dto);
    await this.audit.log({
      actorType: 'ADMIN', action: 'user.notes.update',
      targetType: 'user', targetId: id,
      metadata: { hasNotes: dto.notes !== undefined, tagCount: dto.tags?.length },
    });
    return r;
  }

  // ─── Bots ───
  @Get('bots')
  bots(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('strategy') strategy?: string,
    @Query('symbol') symbol?: string,
    @Query('stuck') stuck?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.admin.listBotsAdmin({
      search, status, strategy, symbol,
      stuck: stuck === 'true',
      limit: limit ? Number(limit) : 50,
      offset: offset ? Number(offset) : 0,
    });
  }

  @Post('bots/:id/force-stop')
  async forceStop(@Param('id') id: string, @Body(new ZodValidationPipe(ForceStopDto)) dto: ForceStopDto) {
    const r = await this.admin.forceStopBot(id, dto.reason);
    await this.audit.log({ actorType: 'ADMIN', action: 'bot.force_stop', targetType: 'bot', targetId: id, metadata: { reason: dto.reason } });
    return r;
  }

  @Get('top-bots')
  topBots(@Query('limit') limit?: string) {
    return this.admin.topBots(limit ? Number(limit) : 10);
  }

  // ─── Payments / Subscriptions ───
  @Get('payments')
  payments(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('provider') provider?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.admin.listPayments({
      search, status, provider, from, to,
      limit: limit ? Number(limit) : 50,
      offset: offset ? Number(offset) : 0,
    });
  }

  @Post('payments/:id/refund')
  async refund(@Param('id') id: string, @Body(new ZodValidationPipe(RefundDto)) dto: RefundDto) {
    const r = await this.admin.refundPayment(id, dto.reason);
    await this.audit.log({ actorType: 'ADMIN', action: 'payment.refund', targetType: 'payment', targetId: id, metadata: { reason: dto.reason } });
    return r;
  }

  @Post('subscriptions/:id/extend')
  async extendSubscription(@Param('id') id: string, @Body(new ZodValidationPipe(ExtendSubDto)) dto: ExtendSubDto) {
    const r = await this.admin.extendSubscription(id, dto.days);
    await this.audit.log({ actorType: 'ADMIN', action: 'subscription.extend', targetType: 'subscription', targetId: id, metadata: { days: dto.days } });
    return r;
  }

  // ─── System ───
  @Get('system/health')
  systemHealth() { return this.admin.systemHealth(); }

  @Post('system/maintenance')
  async setMaintenance(@Body(new ZodValidationPipe(MaintenanceDto)) dto: MaintenanceDto) {
    const r = await this.admin.setMaintenanceMode(dto.enabled);
    await this.audit.log({ actorType: 'ADMIN', action: 'system.maintenance', metadata: { enabled: dto.enabled } });
    return r;
  }

  @Get('system/errors')
  errors(
    @Query('limit') limit?: string,
    @Query('since') since?: string,
    @Query('level') level?: string,
  ) {
    return this.admin.errorFeed({
      limit: limit ? Number(limit) : 100,
      since,
      level,
    });
  }

  @Get('system/binance')
  binanceHealth() { return this.admin.binanceHealth(); }

  @Get('system/security')
  securitySettings() { return this.admin.getSecuritySettings(); }

  @Post('system/security')
  async setSecuritySettings(@Body(new ZodValidationPipe(SecuritySettingsDto)) dto: SecuritySettingsDto) {
    const r = await this.admin.setSecuritySettings(dto);
    await this.audit.log({
      actorType: 'ADMIN', action: 'system.security.update',
      metadata: { requireMfa: dto.requireMfaForAdmin, ipCount: dto.ipAllowlist?.length },
    });
    return r;
  }

  // ─── Analytics ───
  @Get('analytics/churn')
  churn() { return this.admin.churnAnalytics(); }

  @Get('analytics/fleet-heatmap')
  fleetHeatmap() { return this.admin.fleetHeatmap(); }

  @Get('analytics/symbol-watchlist')
  symbolWatchlist() { return this.admin.symbolWatchlist(); }

  // ─── Announcements ───
  @Get('announcement')
  getAnnouncement() { return this.admin.getAnnouncement(); }

  @Post('announcement')
  async setAnnouncement(@Body(new ZodValidationPipe(AnnouncementDto)) dto: AnnouncementDto) {
    const r = await this.admin.setAnnouncement(dto);
    await this.audit.log({
      actorType: 'ADMIN', action: 'announcement.update',
      metadata: { enabled: dto.enabled, severity: dto.severity },
    });
    return r;
  }

  // ─── Revenue export ───
  @Get('revenue/export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async revenueExport(@Res() res: Response) {
    const rows = await this.admin.revenueExportRows();
    const header = ['date', 'email', 'amountUsd', 'cryptoCurrency', 'amountCrypto',
      'provider', 'providerTxnId', 'planCode', 'planName'].join(',');
    const lines = rows.map((r) => Object.values(r).map((v) => csvEscape(String(v))).join(','));
    res.setHeader('Content-Disposition', `attachment; filename="revenue-${new Date().toISOString().split('T')[0]}.csv"`);
    res.send([header, ...lines].join('\n'));
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
  auditList(
    @Query('limit') limit?: string,
    @Query('action') action?: string,
    @Query('actorType') actorType?: string,
    @Query('userId') userId?: string,
    @Query('targetType') targetType?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.audit.list({
      limit: limit ? Number(limit) : 200,
      action, actorType, userId, targetType,
      from, to,
    } as never);
  }

  // ─── Coupons (Sprint 4) ───
  @Get('coupons')
  coupons() { return this.admin.listCoupons(); }

  @Post('coupons')
  async createCoupon(@Body(new ZodValidationPipe(CouponCreateDto)) dto: CouponCreateDto) {
    const c = await this.admin.createCoupon(dto);
    await this.audit.log({ actorType: 'ADMIN', action: 'coupon.create', targetType: 'coupon', targetId: c.id, metadata: { code: c.code } });
    return c;
  }

  @Patch('coupons/:id')
  async updateCoupon(@Param('id') id: string, @Body(new ZodValidationPipe(CouponUpdateDto)) dto: CouponUpdateDto) {
    const c = await this.admin.updateCoupon(id, dto);
    await this.audit.log({ actorType: 'ADMIN', action: 'coupon.update', targetType: 'coupon', targetId: id });
    return c;
  }

  @Delete('coupons/:id')
  async deleteCoupon(@Param('id') id: string) {
    const r = await this.admin.deleteCoupon(id);
    await this.audit.log({ actorType: 'ADMIN', action: 'coupon.delete', targetType: 'coupon', targetId: id });
    return r;
  }

  @Get('coupons/:id/redemptions')
  redemptions(@Param('id') id: string) { return this.admin.listCouponRedemptions(id); }

  // ─── Email Templates (Sprint 4) ───
  @Get('email-templates')
  emailTemplates() { return this.admin.listEmailTemplates(); }

  @Post('email-templates')
  async upsertEmailTemplate(@Body(new ZodValidationPipe(EmailTemplateDto)) dto: EmailTemplateDto) {
    const t = await this.admin.upsertEmailTemplate(dto);
    await this.audit.log({ actorType: 'ADMIN', action: 'email_template.update', targetType: 'email_template', targetId: dto.key });
    return t;
  }

  @Delete('email-templates/:id')
  async deleteEmailTemplate(@Param('id') id: string) {
    const r = await this.admin.deleteEmailTemplate(id);
    await this.audit.log({ actorType: 'ADMIN', action: 'email_template.delete', targetType: 'email_template', targetId: id });
    return r;
  }

  // ─── Surveys / NPS (Sprint 4) ───
  @Get('surveys')
  surveys(@Query('surveyKey') surveyKey?: string, @Query('limit') limit?: string) {
    return this.admin.listSurveyResponses({ surveyKey, limit: limit ? Number(limit) : 100 });
  }

  @Get('surveys/nps-summary')
  npsSummary(@Query('days') days?: string) {
    return this.admin.npsSummary(days ? Number(days) : 90);
  }

  // ─── Approvals (Sprint 4) ───
  @Post('approvals')
  async requestApproval(
    @CurrentUser() admin: CurrentUserPayload,
    @Body(new ZodValidationPipe(ApprovalRequestDto)) dto: ApprovalRequestDto,
  ) {
    const r = await this.admin.requestApproval({
      requestedBy: admin.sub,
      action: dto.action,
      targetType: dto.targetType,
      targetId: dto.targetId,
      payload: dto.payload,
      reason: dto.reason,
      ttlHours: dto.ttlHours,
    });
    await this.audit.log({
      actorType: 'ADMIN', userId: admin.sub,
      action: 'approval.request', targetType: 'approval', targetId: r.id,
      metadata: { for: dto.action, reason: dto.reason },
    });
    return r;
  }

  @Get('approvals')
  approvals(@Query('status') status?: string) {
    return this.admin.listPendingApprovals({ status: (status as never) ?? 'pending' });
  }

  @Post('approvals/:id/approve')
  async approveAction(@CurrentUser() admin: CurrentUserPayload, @Param('id') id: string) {
    const r = await this.admin.approveAction(id, admin.sub);
    await this.audit.log({
      actorType: 'ADMIN', userId: admin.sub,
      action: 'approval.approve', targetType: 'approval', targetId: id,
      metadata: { replayedAction: r.action },
    });
    return r;
  }

  @Post('approvals/:id/reject')
  async rejectAction(
    @CurrentUser() admin: CurrentUserPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RejectDto)) dto: RejectDto,
  ) {
    const r = await this.admin.rejectAction(id, admin.sub, dto.reason);
    await this.audit.log({
      actorType: 'ADMIN', userId: admin.sub,
      action: 'approval.reject', targetType: 'approval', targetId: id,
      metadata: { reason: dto.reason },
    });
    return r;
  }

  // ─── Extended Feature Flag (with targeting) ───
  @Post('flags/extended')
  async setFlagExtended(@Body(new ZodValidationPipe(FlagDtoExtended)) dto: FlagDtoExtended) {
    const f = await this.admin.setFlagExtended(dto);
    await this.audit.log({
      actorType: 'ADMIN', action: 'flag.update.extended',
      targetType: 'flag', targetId: dto.key, metadata: { targeting: dto.targeting },
    });
    return f;
  }

  @Get('audit/export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async auditExport(@Res() res: Response) {
    const rows = await this.audit.list({ limit: 5000 });
    const header = ['createdAt', 'actorType', 'userId', 'action', 'targetType', 'targetId', 'ipAddress'].join(',');
    const lines = rows.map((r: {
      createdAt: Date | string; actorType: string; userId?: string | null;
      action: string; targetType?: string | null; targetId?: string | null;
      ipAddress?: string | null;
    }) => [
      new Date(r.createdAt).toISOString(),
      r.actorType,
      r.userId ?? '',
      r.action,
      r.targetType ?? '',
      r.targetId ?? '',
      r.ipAddress ?? '',
    ].map(csvEscape).join(','));
    res.setHeader('Content-Disposition', 'attachment; filename="audit.csv"');
    res.send([header, ...lines].join('\n'));
  }
}

function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}
