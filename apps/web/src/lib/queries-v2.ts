import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiCall, tokenStore } from './api';

// ─── Plans ───
export interface Plan {
  id: string; code: string; name: string; description: string | null;
  priceUsd: string; billingCycleDays: number;
  maxBots: number; maxApiKeys: number; maxCustomStrategies: number;
  isActive: boolean; sortOrder: number;
}
export const usePlans = () =>
  useQuery({ queryKey: ['plans'], queryFn: () => apiCall<Plan[]>(() => api.get('/plans')) });

// ─── Subscriptions ───
export interface Subscription {
  id: string; status: string; startsAt: string; endsAt: string;
  canceledAt: string | null; autoRenew: boolean;
  plan: Plan;
}
export const useCurrentSubscription = () =>
  useQuery({
    queryKey: ['subscription', 'current'],
    queryFn: () => apiCall<Subscription | null>(() => api.get('/subscriptions/current')),
    enabled: !!tokenStore.access,
  });

export const useCancelSubscription = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiCall(() => api.delete(`/subscriptions/${id}`)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['subscription'] }),
  });
};

// ─── Payments ───
export const useMyPayments = () =>
  useQuery({
    queryKey: ['payments'],
    queryFn: () => apiCall<Array<{ id: string; amountUsd: string; status: string; cryptoCurrency: string | null; createdAt: string }>>(() => api.get('/payments')),
    enabled: !!tokenStore.access,
  });

export const useCheckout = () =>
  useMutation({
    mutationFn: (input: { planId: string; cryptoCurrency: string }) =>
      apiCall<{ kind: 'free' | 'paid'; checkoutUrl?: string; address?: string; amount?: string; subscription?: Subscription }>(
        () => api.post('/payments/checkout', input),
      ),
  });

// ─── Reports ───
export interface ReportsOverview {
  totals: {
    realized: number;
    unrealized: number;
    total: number;
    volume: number;
    trades: number;
    cycles: number;
    investment: number;
    heldQty: number;
    wins: number;
    losses: number;
    winRate: number | null;
    roiPct: number | null;
    avgPerCycle: number | null;
  };
  bots: { total: number; running: number; stopped: number; errored: number };
}

export const useReportsOverview = () =>
  useQuery({
    queryKey: ['reports', 'overview'],
    queryFn: () => apiCall<ReportsOverview>(() => api.get('/reports/overview')),
    enabled: !!tokenStore.access,
    refetchInterval: 30_000,
  });

export interface PnlSeriesPoint {
  date: string;
  pnl: number;
  cycles: number;
  volume: number;
  trades: number;
  cumulative: number;
}

export const usePnlSeries = (days = 30) =>
  useQuery({
    queryKey: ['reports', 'pnl', days],
    queryFn: () => apiCall<PnlSeriesPoint[]>(
      () => api.get(`/reports/pnl-series?days=${days}`),
    ),
    enabled: !!tokenStore.access,
    refetchInterval: 30_000,
  });

export interface PerBotRow {
  id: string;
  name: string;
  symbol: string;
  status: string;
  strategy: string | null;
  direction: string | null;
  paperTrading: boolean;
  cycles: number;
  realized: number;
  unrealized: number;
  total: number;
  volume: number;
  trades: number;
  investment: number;
  roi: number | null;
  startedAt: string | null;
  createdAt: string;
}

export const usePerBotBreakdown = () =>
  useQuery({
    queryKey: ['reports', 'per-bot'],
    queryFn: () => apiCall<PerBotRow[]>(() => api.get('/reports/per-bot')),
    enabled: !!tokenStore.access,
    refetchInterval: 30_000,
  });

export interface PerSymbolRow {
  symbol: string;
  bots: number;
  realized: number;
  total: number;
  volume: number;
  cycles: number;
}

export const usePerSymbolBreakdown = () =>
  useQuery({
    queryKey: ['reports', 'per-symbol'],
    queryFn: () => apiCall<PerSymbolRow[]>(() => api.get('/reports/per-symbol')),
    enabled: !!tokenStore.access,
    refetchInterval: 30_000,
  });

export const useBestWorstDay = (days = 30) =>
  useQuery({
    queryKey: ['reports', 'best-worst-day', days],
    queryFn: () => apiCall<{
      best: PnlSeriesPoint | null;
      worst: PnlSeriesPoint | null;
    }>(() => api.get(`/reports/best-worst-day?days=${days}`)),
    enabled: !!tokenStore.access,
    refetchInterval: 30_000,
  });

// ─── Backtest ───
export interface BacktestResult {
  strategyName: string;
  engine: 'grid_v1' | 'graph_v1';
  symbol: string;
  bars: number;
  stats: {
    totalTrades: number;
    buys: number;
    sells: number;
    finalPnl: number;
    maxDrawdown: number;
    roi: number;
    winRate?: number;
  };
  trades: Array<{ ts: number; side: string; price: number; qty: number; pnl: number }>;
}
export const useBacktest = () =>
  useMutation({
    mutationFn: (input: {
      strategyId: string;
      symbol: string;
      interval: string;
      days: number;
      params: Record<string, unknown>;
    }) => apiCall<BacktestResult>(() => api.post('/backtest/run', input)),
  });

// ─── Admin ───
export interface AdminStats {
  ts: string;
  users: { total: number; signups24h: number; signups7d: number; signups30d: number };
  bots: { total: number; running: number; stuck: number };
  payments: { total: number; completed: number; pending: number; failed24h: number };
  revenue: { mrr: number; activeSubs: number };
  trading: { volume24h: number; trades24h: number };
  health: { errors1h: number; botsStuck: number };
  growth: { trialsActive: number; trialsConverted30d: number; churned30d: number; churnRate: number };
}
export const useAdminStats = () =>
  useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: () => apiCall<AdminStats>(() => api.get('/admin/stats')),
    enabled: !!tokenStore.access,
    refetchInterval: 10_000,
  });

export const useAdminTimeseries = (days = 90) =>
  useQuery({
    queryKey: ['admin', 'timeseries', days],
    queryFn: () => apiCall<Array<{ date: string; signups: number; revenue: number }>>(
      () => api.get(`/admin/timeseries?days=${days}`),
    ),
    enabled: !!tokenStore.access,
  });

export interface AdminAlert {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
  href?: string;
}
export const useAdminAlerts = () =>
  useQuery({
    queryKey: ['admin', 'alerts'],
    queryFn: () => apiCall<AdminAlert[]>(() => api.get('/admin/alerts')),
    enabled: !!tokenStore.access,
    refetchInterval: 30_000,
  });

export const useAdminFunnel = () =>
  useQuery({
    queryKey: ['admin', 'funnel'],
    queryFn: () => apiCall<Array<{ step: string; count: number }>>(() => api.get('/admin/funnel')),
    enabled: !!tokenStore.access,
  });

export const useAdminTopLists = () =>
  useQuery({
    queryKey: ['admin', 'top-lists'],
    queryFn: () => apiCall<{
      topVolume: Array<{ botId: string; name: string; symbol: string; owner: string; volume: number; trades: number }>;
      topBots: Array<{ id: string; name: string; symbol: string; pnl: number; owner: string }>;
      topSymbols: Array<{ symbol: string; count: number }>;
    }>(() => api.get('/admin/top-lists')),
    enabled: !!tokenStore.access,
  });

export const useAdminStrategyUsage = () =>
  useQuery({
    queryKey: ['admin', 'strategy-usage'],
    queryFn: () => apiCall<Array<{
      strategyId: string; name: string; builtinKey: string | null; type: string | null; count: number;
    }>>(() => api.get('/admin/strategy-usage')),
    enabled: !!tokenStore.access,
  });

export interface AdminUserRow {
  id: string; email: string; fullName: string | null; role: string; status: string;
  twoFactorEnabled: boolean;
  createdAt: string; lastLoginAt: string | null; lastLoginIp: string | null;
  adminTags?: string[];
  _count: { bots: number; apiKeys: number };
}
export const useAdminUsers = (params: {
  search?: string; role?: string; status?: string;
  hasBots?: boolean; twoFactor?: boolean;
  limit?: number; offset?: number;
} = {}) =>
  useQuery({
    queryKey: ['admin', 'users', params],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (params.search) qs.set('search', params.search);
      if (params.role) qs.set('role', params.role);
      if (params.status) qs.set('status', params.status);
      if (params.hasBots !== undefined) qs.set('hasBots', String(params.hasBots));
      if (params.twoFactor !== undefined) qs.set('twoFactor', String(params.twoFactor));
      if (params.limit) qs.set('limit', String(params.limit));
      if (params.offset) qs.set('offset', String(params.offset));
      return apiCall<{ rows: AdminUserRow[]; total: number; limit: number; offset: number }>(
        () => api.get(`/admin/users?${qs.toString()}`),
      );
    },
    enabled: !!tokenStore.access,
  });

export const useAdminUserDetail = (id: string) =>
  useQuery({
    queryKey: ['admin', 'user', id],
    queryFn: () => apiCall<{
      user: AdminUserRow & { avatarUrl: string | null; trialEndsAt: string | null; telegramChatId: string | null; discordWebhookUrl: string | null; referralCode: string | null };
      bots: Array<{ id: string; name: string; symbol: string; status: string; createdAt: string; realizedPnlQuote: string }>;
      apiKeys: Array<{ id: string; label: string; exchange: string; status: string; createdAt: string }>;
      payments: Array<{ id: string; amountUsd: string; status: string; provider: string; createdAt: string; paidAt: string | null }>;
      subscriptions: Array<{ id: string; status: string; startsAt: string; endsAt: string; plan: { code: string; name: string; priceUsd: string } }>;
      sessions: Array<{ id: string; userAgent: string | null; ipAddress: string | null; createdAt: string; expiresAt: string }>;
      recentAudit: Array<{ id: string; action: string; createdAt: string; metadata: Record<string, unknown> | null }>;
      totals: { volume: number; trades: number };
    }>(() => api.get(`/admin/users/${id}`)),
    enabled: !!tokenStore.access && !!id,
  });

export const useResetUserMfa = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiCall(() => api.post(`/admin/users/${id}/reset-mfa`, {})),
    onSuccess: (_, id) => qc.invalidateQueries({ queryKey: ['admin', 'user', id] }),
  });
};

// ─── Admin Bots ───
export interface AdminBotRow {
  id: string; name: string; symbol: string; status: string;
  realizedPnlQuote: string; unrealizedPnlQuote: string;
  createdAt: string; updatedAt: string; startedAt: string | null;
  paperTrading: boolean;
  user: { id: string; email: string };
  strategy: { name: string; builtinKey: string | null };
}
export const useAdminBots = (params: {
  search?: string; status?: string; strategy?: string; symbol?: string;
  stuck?: boolean; limit?: number; offset?: number;
} = {}) =>
  useQuery({
    queryKey: ['admin', 'bots', params],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (params.search) qs.set('search', params.search);
      if (params.status) qs.set('status', params.status);
      if (params.strategy) qs.set('strategy', params.strategy);
      if (params.symbol) qs.set('symbol', params.symbol);
      if (params.stuck) qs.set('stuck', 'true');
      if (params.limit) qs.set('limit', String(params.limit));
      if (params.offset) qs.set('offset', String(params.offset));
      return apiCall<{ rows: AdminBotRow[]; total: number; limit: number; offset: number }>(
        () => api.get(`/admin/bots?${qs.toString()}`),
      );
    },
    enabled: !!tokenStore.access,
  });

export const useForceStopBot = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; reason: string }) =>
      apiCall(() => api.post(`/admin/bots/${input.id}/force-stop`, { reason: input.reason })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'bots'] }),
  });
};

export const useTopBots = () =>
  useQuery({
    queryKey: ['admin', 'top-bots'],
    queryFn: () => apiCall<{
      winners: Array<{ id: string; name: string; symbol: string; pnl: number; owner: string }>;
      losers: Array<{ id: string; name: string; symbol: string; pnl: number; owner: string }>;
    }>(() => api.get('/admin/top-bots')),
    enabled: !!tokenStore.access,
  });

// ─── Admin Payments / Subscriptions ───
export interface AdminPaymentRow {
  id: string; amountUsd: string; amountCrypto: string | null; cryptoCurrency: string | null;
  status: string; provider: string; providerTxnId: string | null;
  createdAt: string; paidAt: string | null;
  user: { id: string; email: string };
  subscription: { id: string; plan: { code: string; name: string } } | null;
}
export const useAdminPayments = (params: {
  search?: string; status?: string; provider?: string;
  from?: string; to?: string;
  limit?: number; offset?: number;
} = {}) =>
  useQuery({
    queryKey: ['admin', 'payments', params],
    queryFn: () => {
      const qs = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') qs.set(k, String(v)); });
      return apiCall<{
        rows: AdminPaymentRow[]; total: number; limit: number; offset: number;
        summary: { completedTotalUsd: number; completedCount: number };
      }>(() => api.get(`/admin/payments?${qs.toString()}`));
    },
    enabled: !!tokenStore.access,
  });

export const useRefundPayment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; reason: string }) =>
      apiCall(() => api.post(`/admin/payments/${input.id}/refund`, { reason: input.reason })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'payments'] }),
  });
};

export const useExtendSubscription = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; days: number }) =>
      apiCall(() => api.post(`/admin/subscriptions/${input.id}/extend`, { days: input.days })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin'] });
    },
  });
};

// ─── Admin System ───
export const useAdminSystemHealth = () =>
  useQuery({
    queryKey: ['admin', 'system', 'health'],
    queryFn: () => apiCall<{
      ts: string;
      db: { ok: boolean; latencyMs: number | null; users: number; bots: number };
      redis: { ok: boolean };
      engine: { ok: boolean; lastEventAgoMs: number | null };
      maintenanceMode: boolean;
    }>(() => api.get('/admin/system/health')),
    enabled: !!tokenStore.access,
    refetchInterval: 10_000,
  });

export const useSetMaintenanceMode = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) =>
      apiCall(() => api.post('/admin/system/maintenance', { enabled })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'system'] }),
  });
};

// ─── Impersonation ───
export const useImpersonate = () =>
  useMutation({
    mutationFn: (targetUserId: string) =>
      apiCall<{ accessToken: string; targetEmail: string; expiresIn: number }>(
        () => api.post(`/admin/users/${targetUserId}/impersonate`, {}),
      ),
  });

// ─── Bulk user ops ───
export const useBulkUpdateUsers = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { ids: string[]; role?: string; status?: string }) =>
      apiCall<{ updated: number }>(() => api.post('/admin/users/bulk-update', input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
};

// ─── Announcements ───
export interface AnnouncementCfg {
  enabled: boolean;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  startsAt?: string;
  endsAt?: string;
}
export const useAnnouncement = () =>
  useQuery({
    queryKey: ['admin', 'announcement'],
    queryFn: () => apiCall<AnnouncementCfg | null>(() => api.get('/admin/announcement')),
    enabled: !!tokenStore.access,
  });
export const useSetAnnouncement = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AnnouncementCfg) =>
      apiCall(() => api.post('/admin/announcement', input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'announcement'] });
      qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
};

// ─── Error feed ───
export const useAdminErrors = (params: { limit?: number; since?: string; level?: string } = {}) =>
  useQuery({
    queryKey: ['admin', 'errors', params],
    queryFn: () => {
      const qs = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') qs.set(k, String(v)); });
      return apiCall<{
        systemErrors: Array<{
          id: string; level: string; category: string; message: string;
          service: string | null; userId: string | null; botId: string | null;
          createdAt: string; data: unknown;
        }>;
        botErrors: Array<{
          id: string; type: string; message: string; botId: string; createdAt: string;
          data: unknown;
          bot: { name: string; symbol: string; user: { email: string } };
        }>;
      }>(() => api.get(`/admin/system/errors?${qs.toString()}`));
    },
    enabled: !!tokenStore.access,
    refetchInterval: 30_000,
  });

// ─── Sprint 3: user admin actions ───
export const useAdminResetPassword = () =>
  useMutation({
    mutationFn: (id: string) =>
      apiCall<{ resetUrl: string; expiresInMinutes: number; email: string }>(
        () => api.post(`/admin/users/${id}/reset-password`, {}),
      ),
  });

export const useAdminChangeEmail = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; email: string }) =>
      apiCall<{ id: string; email: string }>(() => api.patch(`/admin/users/${input.id}/email`, { email: input.email })),
    onSuccess: (_, input) => qc.invalidateQueries({ queryKey: ['admin', 'user', input.id] }),
  });
};

export const useSetUserNotes = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; notes?: string; tags?: string[] }) => {
      const { id, ...patch } = input;
      return apiCall(() => api.patch(`/admin/users/${id}/notes`, patch));
    },
    onSuccess: (_, input) => qc.invalidateQueries({ queryKey: ['admin', 'user', input.id] }),
  });
};

// ─── Sprint 3: Security settings ───
export interface SecuritySettings {
  requireMfaForAdmin: boolean;
  ipAllowlist: string[];
}
export const useSecuritySettings = () =>
  useQuery({
    queryKey: ['admin', 'security'],
    queryFn: () => apiCall<SecuritySettings>(() => api.get('/admin/system/security')),
    enabled: !!tokenStore.access,
  });
export const useSetSecuritySettings = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<SecuritySettings>) =>
      apiCall<SecuritySettings>(() => api.post('/admin/system/security', input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'security'] }),
  });
};

// ─── Sprint 3: Analytics ───
export const useChurnAnalytics = () =>
  useQuery({
    queryKey: ['admin', 'churn'],
    queryFn: () => apiCall<{
      perPlan: Array<{ code: string; name: string; active: number; canceled: number; trial: number; churnRate: number }>;
      cohorts: Array<{ month: string; total: number; canceled: number }>;
    }>(() => api.get('/admin/analytics/churn')),
    enabled: !!tokenStore.access,
  });

export const useFleetHeatmap = () =>
  useQuery({
    queryKey: ['admin', 'fleet-heatmap'],
    queryFn: () => apiCall<{
      strategies: string[];
      symbols: string[];
      cells: Record<string, Record<string, number>>;
      total: number;
    }>(() => api.get('/admin/analytics/fleet-heatmap')),
    enabled: !!tokenStore.access,
  });

export const useSymbolWatchlist = () =>
  useQuery({
    queryKey: ['admin', 'symbol-watchlist'],
    queryFn: () => apiCall<Array<{
      symbol: string; bots: number; concentrationPct: number;
      realizedPnl: number; volume: number; trades: number;
    }>>(() => api.get('/admin/analytics/symbol-watchlist')),
    enabled: !!tokenStore.access,
  });

// ─── Sprint 4: Coupons ───
export interface CouponRow {
  id: string; code: string; description: string | null;
  discountType: 'PERCENT' | 'FIXED'; discountValue: string;
  applicablePlans: string[];
  maxRedemptions: number | null; perUserLimit: number;
  validFrom: string; validUntil: string | null;
  isActive: boolean; redemptionCount: number;
  createdAt: string;
}
export const useCoupons = () =>
  useQuery({
    queryKey: ['admin', 'coupons'],
    queryFn: () => apiCall<CouponRow[]>(() => api.get('/admin/coupons')),
    enabled: !!tokenStore.access,
  });
export const useCreateCoupon = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      code: string; description?: string;
      discountType: 'PERCENT' | 'FIXED'; discountValue: number;
      applicablePlans?: string[];
      maxRedemptions?: number; perUserLimit?: number;
      validFrom?: string; validUntil?: string; isActive?: boolean;
    }) => apiCall<CouponRow>(() => api.post('/admin/coupons', input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'coupons'] }),
  });
};
export const useUpdateCoupon = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string } & Partial<{
      description: string;
      applicablePlans: string[];
      maxRedemptions: number | null;
      perUserLimit: number;
      validUntil: string | null;
      isActive: boolean;
    }>) => {
      const { id, ...patch } = input;
      return apiCall<CouponRow>(() => api.patch(`/admin/coupons/${id}`, patch));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'coupons'] }),
  });
};
export const useDeleteCoupon = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiCall<{ ok: true }>(() => api.delete(`/admin/coupons/${id}`)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'coupons'] }),
  });
};

// ─── Sprint 4: Email Templates ───
export interface EmailTemplateRow {
  id: string; key: string; name: string; subject: string; body: string;
  variables: string[]; description: string | null;
  isActive: boolean; createdAt: string;
}
export const useEmailTemplates = () =>
  useQuery({
    queryKey: ['admin', 'email-templates'],
    queryFn: () => apiCall<EmailTemplateRow[]>(() => api.get('/admin/email-templates')),
    enabled: !!tokenStore.access,
  });
export const useUpsertEmailTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      key: string; name: string; subject: string; body: string;
      variables?: string[]; description?: string; isActive?: boolean;
    }) => apiCall<EmailTemplateRow>(() => api.post('/admin/email-templates', input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'email-templates'] }),
  });
};
export const useDeleteEmailTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiCall<{ ok: true }>(() => api.delete(`/admin/email-templates/${id}`)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'email-templates'] }),
  });
};

// ─── Sprint 4: Surveys / NPS ───
export interface SurveyResponseRow {
  id: string; surveyKey: string;
  score: number | null; category: string | null; comment: string | null;
  createdAt: string;
  user: { email: string; fullName: string | null } | null;
}
export const useSurveys = (surveyKey?: string) =>
  useQuery({
    queryKey: ['admin', 'surveys', surveyKey],
    queryFn: () => apiCall<SurveyResponseRow[]>(() => api.get(`/admin/surveys${surveyKey ? `?surveyKey=${surveyKey}` : ''}`)),
    enabled: !!tokenStore.access,
  });
export const useNpsSummary = (days = 90) =>
  useQuery({
    queryKey: ['admin', 'nps-summary', days],
    queryFn: () => apiCall<{
      total: number; promoters: number; passives: number; detractors: number;
      nps: number | null; days: number;
    }>(() => api.get(`/admin/surveys/nps-summary?days=${days}`)),
    enabled: !!tokenStore.access,
  });

// ─── Sprint 4: Approvals ───
export interface PendingApprovalRow {
  id: string; action: string;
  targetType: string | null; targetId: string | null;
  payload: Record<string, unknown>;
  requestedBy: string; reason: string | null;
  approvedBy: string | null; approvedAt: string | null;
  rejectedBy: string | null; rejectedAt: string | null;
  rejectionReason: string | null;
  executedAt: string | null; expiresAt: string;
  createdAt: string;
  requestedByUser: { email: string };
}
export const useApprovals = (status: 'pending' | 'completed' | 'rejected' | 'all' = 'pending') =>
  useQuery({
    queryKey: ['admin', 'approvals', status],
    queryFn: () => apiCall<PendingApprovalRow[]>(() => api.get(`/admin/approvals?status=${status}`)),
    enabled: !!tokenStore.access,
    refetchInterval: 30_000,
  });
export const useApproveAction = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiCall<{ ok: true; action: string; payload: Record<string, unknown> }>(
        () => api.post(`/admin/approvals/${id}/approve`, {}),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'approvals'] }),
  });
};
export const useRejectAction = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; reason?: string }) =>
      apiCall(() => api.post(`/admin/approvals/${input.id}/reject`, { reason: input.reason })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'approvals'] }),
  });
};

// ─── Sprint 4: NPS submit (user side) ───
export const useSubmitSurvey = () =>
  useMutation({
    mutationFn: (input: { surveyKey?: string; score?: number; comment?: string; metadata?: Record<string, unknown> }) =>
      apiCall<{ id: string; createdAt: string }>(() => api.post('/users/me/survey', input)),
  });

// ─── Sprint 4: Extended Feature Flag ───
export const useSetFlagExtended = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      key: string;
      enabled?: boolean;
      rolloutPct?: number;
      allowList?: string[];
      description?: string;
      targeting?: {
        roles?: string[];
        plans?: string[];
        countries?: string[];
        signupAfter?: string;
        signupBefore?: string;
        minBots?: number;
        trialOnly?: boolean;
      };
    }) => apiCall(() => api.post('/admin/flags/extended', input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'flags'] }),
  });
};

// ─── Binance health ───
export const useBinanceHealth = () =>
  useQuery({
    queryKey: ['admin', 'binance-health'],
    queryFn: () => apiCall<{
      calls1h: number;
      calls24h: number;
      avgLatencyMs: number;
      maxWeight1h: number;
      errorRate1h: number;
      slowest: Array<{ endpoint: string; method: string; durationMs: number | null; statusCode: number | null; createdAt: string }>;
      recentErrors: Array<{ endpoint: string; errorCode: number | null; errorMessage: string | null; createdAt: string }>;
    }>(() => api.get('/admin/system/binance')),
    enabled: !!tokenStore.access,
    refetchInterval: 30_000,
  });

export const useUpdateUserRole = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; role: string }) =>
      apiCall(() => api.patch(`/admin/users/${input.id}/role`, { role: input.role })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
};

export const useUpdateUserStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; status: string }) =>
      apiCall(() => api.patch(`/admin/users/${input.id}/status`, { status: input.status })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
};

export const useAdminPlans = () =>
  useQuery({
    queryKey: ['admin', 'plans'],
    queryFn: () => apiCall<Plan[]>(() => api.get('/admin/plans')),
    enabled: !!tokenStore.access,
  });

export const useCreatePlan = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      code: string; name: string; description?: string;
      priceUsd: number; billingCycleDays: number;
      maxBots: number; maxApiKeys: number; maxCustomStrategies: number;
      sortOrder?: number; isActive?: boolean;
    }) => apiCall<Plan>(() => api.post('/admin/plans', input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'plans'] }),
  });
};

export const useUpdatePlan = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string } & Partial<{
      name: string; description: string;
      priceUsd: number; billingCycleDays: number;
      maxBots: number; maxApiKeys: number; maxCustomStrategies: number;
      sortOrder: number; isActive: boolean;
    }>) => {
      const { id, ...patch } = input;
      return apiCall<Plan>(() => api.patch(`/admin/plans/${id}`, patch));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'plans'] }),
  });
};

export const useAdminSettings = () =>
  useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => apiCall<Array<{ key: string; value: unknown; isPublic: boolean; category: string | null }>>(
      () => api.get('/admin/settings'),
    ),
    enabled: !!tokenStore.access,
  });

export interface FeatureFlagRow {
  key: string; enabled: boolean; rolloutPct: number;
  allowList: string[]; description: string | null;
  targeting: {
    roles?: string[]; plans?: string[]; countries?: string[];
    signupAfter?: string; signupBefore?: string;
    minBots?: number; trialOnly?: boolean;
  };
}
export const useAdminFlags = () =>
  useQuery({
    queryKey: ['admin', 'flags'],
    queryFn: () => apiCall<FeatureFlagRow[]>(() => api.get('/admin/flags')),
    enabled: !!tokenStore.access,
  });

export const useAdminAudit = (params: {
  action?: string; actorType?: string; userId?: string; targetType?: string;
  from?: string; to?: string; limit?: number;
} = {}) =>
  useQuery({
    queryKey: ['admin', 'audit', params],
    queryFn: () => {
      const qs = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') qs.set(k, String(v)); });
      return apiCall<Array<{
        id: string; userId: string | null; actorType: string; action: string;
        targetType: string | null; targetId: string | null;
        ipAddress: string | null; userAgent: string | null;
        createdAt: string; metadata: Record<string, unknown> | null;
      }>>(() => api.get(`/admin/audit?${qs.toString()}`));
    },
    enabled: !!tokenStore.access,
  });

export const useToggleFlag = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { key: string; enabled?: boolean; rolloutPct?: number; description?: string }) =>
      apiCall(() => api.post('/admin/flags', input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'flags'] }),
  });
};

export const useUpdateSetting = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { key: string; value: unknown; isPublic?: boolean; category?: string }) =>
      apiCall(() => api.post('/admin/settings', input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'settings'] }),
  });
};
