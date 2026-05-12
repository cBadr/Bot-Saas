import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiCall, tokenStore } from './api';

// ─── Auth ───
export type FillFrequency = 'OFF' | 'PER_CYCLE' | 'PER_FILL' | 'CUSTOM';

export interface NotificationConfig {
  // Fill filters (when fillFrequency = 'CUSTOM')
  notifyOnBuyFills?: boolean;
  notifyOnSellFills?: boolean;
  minFillNotional?: number;
  minCyclePnl?: number;
  // Periodic status reports
  statusReportIntervalMinutes?: number;
  statusReportBots?: 'ALL' | string[];
  // Mute specific bots from all notifications
  mutedBotIds?: string[];
  // Batch notifications (0 = off / send immediately)
  digestIntervalMinutes?: number;
  // Quiet hours: notifications queue between these times (IANA tz, HH:MM)
  quietHours?: { start: string; end: string; tz?: string } | null;
  // Severity gate
  severityFilter?: 'ALL' | 'WARN_AND_ABOVE' | 'CRITICAL_ONLY';
  // UI preferences (kept inside notif config to avoid a schema migration)
  preferences?: UserPreferences;
}

export interface UserPreferences {
  locale?: 'en' | 'ar';
  timezone?: string;
  theme?: 'light' | 'dark' | 'system';
  density?: 'compact' | 'comfortable';
  defaultQuote?: string;
  dateFormat?: 'DMY' | 'MDY' | 'YMD';
}

export interface User {
  id: string; email: string; fullName?: string | null; avatarUrl?: string | null;
  role: string; status: string; twoFactorEnabled: boolean;
  telegramChatId?: string | null; telegramUsername?: string | null;
  discordWebhookUrl?: string | null;
  pushSubscriptions?: Array<{ endpoint: string; ua?: string; createdAt?: string }>;
  fillFrequency?: FillFrequency;
  notificationConfig?: NotificationConfig | null;
  lastStatusReportAt?: string | null;
  trialEndsAt?: string | null;
  referralCode?: string | null; createdAt: string; lastLoginAt?: string | null;
  /** Active platform-wide announcement banner. */
  announcement?: { message: string; severity: 'info' | 'warning' | 'critical' } | null;
}

export const useMe = () =>
  useQuery({
    queryKey: ['me'],
    queryFn: () => apiCall<User>(() => api.get('/users/me')),
    enabled: !!tokenStore.access,
    retry: false,
  });

/** Update profile fields (name, telegramChatId, fillFrequency, etc.). */
export const useUpdateProfile = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      fullName?: string;
      avatarUrl?: string;
      telegramChatId?: string | null;
      telegramUsername?: string | null;
      discordWebhookUrl?: string | null;
      fillFrequency?: FillFrequency;
      notificationConfig?: NotificationConfig | Record<string, unknown>;
    }) => apiCall<User>(() => api.patch('/users/me', input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
};

/** Send a test Telegram message to the saved chat ID. */
export const useTestTelegram = () =>
  useMutation({
    mutationFn: () => apiCall<{ ok: true }>(() => api.post('/users/me/telegram/test', {})),
  });

export const useTestEmail = () =>
  useMutation({
    mutationFn: () => apiCall<{ ok: true }>(() => api.post('/users/me/email/test', {})),
  });

export const useTestDiscord = () =>
  useMutation({
    mutationFn: () => apiCall<{ ok: true }>(() => api.post('/users/me/discord/test', {})),
  });

export const useTestPush = () =>
  useMutation({
    mutationFn: () => apiCall<{ sent: number; failed: number }>(() => api.post('/users/me/push/test', {})),
  });

// ─── Sessions ───
export interface UserSession {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  expiresAt: string;
  createdAt: string;
}
export const useSessions = () =>
  useQuery({
    queryKey: ['sessions'],
    queryFn: () => apiCall<UserSession[]>(() => api.get('/users/me/sessions')),
    enabled: !!tokenStore.access,
  });

export const useRevokeSession = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiCall<{ ok: true }>(() => api.delete(`/users/me/sessions/${id}`)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  });
};
export const useRevokeAllSessions = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiCall<{ revoked: number }>(() => api.post('/users/me/sessions/revoke-all', {})),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  });
};

// ─── Audit log ───
export interface AuditEntry {
  id: string;
  action: string;
  actorType: string;
  targetType: string | null;
  targetId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}
export const useAuditLog = () =>
  useQuery({
    queryKey: ['audit-log'],
    queryFn: () => apiCall<AuditEntry[]>(() => api.get('/users/me/audit')),
    enabled: !!tokenStore.access,
  });

// ─── Referrals ───
export interface ReferralStats {
  code: string | null;
  count: number;
  recent: Array<{ id: string; email: string; createdAt: string }>;
}
export const useReferralStats = () =>
  useQuery({
    queryKey: ['referrals'],
    queryFn: () => apiCall<ReferralStats>(() => api.get('/users/me/referrals')),
    enabled: !!tokenStore.access,
  });

// ─── Password + 2FA ───
export const useChangePassword = () =>
  useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) =>
      apiCall<{ success: true }>(() => api.post('/users/me/password', input)),
  });

export const useSetup2FA = () =>
  useMutation({
    mutationFn: () => apiCall<{ secret: string; otpauthUrl: string }>(() => api.post('/users/me/2fa/setup', {})),
  });

export const useVerify2FA = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => apiCall<{ success: true }>(() => api.post('/users/me/2fa/verify', { code })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
};

export const useDisable2FA = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => apiCall<{ success: true }>(() => api.post('/users/me/2fa/disable', { code })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
};

// ─── Account deletion ───
export const useDeleteAccount = () =>
  useMutation({
    mutationFn: (confirmEmail: string) =>
      apiCall<{ deleted: true }>(() => api.delete('/users/me', { data: { confirmEmail } })),
  });

export const useSubscribePush = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sub: { endpoint: string; keys: { p256dh: string; auth: string }; ua?: string }) =>
      apiCall<{ ok: true }>(() => api.post('/users/me/push/subscribe', sub)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
};

export const useUnsubscribePush = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (endpoint: string) =>
      apiCall<{ ok: true }>(() => api.post('/users/me/push/unsubscribe', { endpoint })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
};

/**
 * Manually fire a status report immediately (preview the periodic report).
 * Updates `lastStatusReportAt` on success which delays the next scheduled send.
 */
export const useSendStatusReportNow = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiCall<{ ok: boolean; reason?: string; botsIncluded?: number }>(
      () => api.post('/status-report/send-now', {}),
    ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
};

export const useLogin = () =>
  useMutation({
    mutationFn: (input: { email: string; password: string }) =>
      apiCall<{ user: User; accessToken: string; refreshToken: string }>(() =>
        api.post('/auth/login', input),
      ),
    onSuccess: (data) => tokenStore.set(data.accessToken, data.refreshToken),
  });

export const useRegister = () =>
  useMutation({
    mutationFn: (input: { email: string; password: string; fullName?: string; referralCode?: string }) =>
      apiCall<{ user: User; accessToken: string; refreshToken: string }>(() =>
        api.post('/auth/register', input),
      ),
    onSuccess: (data) => tokenStore.set(data.accessToken, data.refreshToken),
  });

// ─── Strategies ───
export interface Strategy {
  id: string; name: string; description: string | null; type: string;
  visibility: string; builtinKey: string | null; ownerId: string | null;
  paramsSchema: Record<string, unknown> | null;
}

export const useStrategies = () =>
  useQuery({
    queryKey: ['strategies'],
    queryFn: () => apiCall<Strategy[]>(() => api.get('/strategies')),
    enabled: !!tokenStore.access,
  });

// ─── Exchange Keys ───
export interface ExchangeKey {
  id: string; label: string; exchange: string; status: string;
  apiKey: string; lastCheckedAt: string | null; lastError: string | null; createdAt: string;
}

export const useExchangeKeys = () =>
  useQuery({
    queryKey: ['exchange-keys'],
    queryFn: () => apiCall<ExchangeKey[]>(() => api.get('/exchange-keys')),
    enabled: !!tokenStore.access,
  });

export const useCreateExchangeKey = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { label: string; apiKey: string; apiSecret: string }) =>
      apiCall<ExchangeKey>(() => api.post('/exchange-keys', input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['exchange-keys'] }),
  });
};

export const useTestExchangeKey = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiCall<{ ok: boolean; canTrade?: boolean; balances?: { asset: string; free: string; locked: string }[] }>(
        () => api.post(`/exchange-keys/${id}/test`),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['exchange-keys'] }),
  });
};

export const useAssetBalance = (apiKeyId: string | undefined, asset: string) =>
  useQuery({
    queryKey: ['exchange-keys', apiKeyId, 'balance', asset],
    queryFn: () => apiCall<{ asset: string; free: string; locked: string }>(
      () => api.get(`/exchange-keys/${apiKeyId}/balance/${asset}`),
    ),
    enabled: !!tokenStore.access && !!apiKeyId && !!asset,
    staleTime: 10_000,
  });

export const useDeleteExchangeKey = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiCall(() => api.delete(`/exchange-keys/${id}`)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['exchange-keys'] }),
  });
};

// ─── Bots ───
export interface BotLiveStats {
  gridLevels: number | null;
  gridSpread: number | null;
  orderSize: number | null;
  totalInvestment: number | null;
  expectedPerCycle: number | null;
  cyclesCompleted: number;
  realized: number;
  unrealized: number;
  total: number;
  heldQty: number;
  startPrice: number | null;
  totalVolumeQuote: number;
  tradeCount: number;
}

export interface Bot {
  id: string; name: string; symbol: string; status: string;
  baseAsset: string; quoteAsset: string;
  paperTrading?: boolean;
  totalTrades: number; realizedPnlQuote: string;
  startedAt: string | null; stoppedAt: string | null; createdAt: string;
  archivedAt?: string | null;
  currentRunId?: string | null;
  totalRuns?: number;
  params?: Record<string, unknown>;
  strategy?: { id: string; name: string; type: string; builtinKey?: string | null };
  apiKey?: { id: string; label: string; status: string };
  /** Server-derived live stats (only present on list/detail responses). */
  liveStats?: BotLiveStats;
  /** Lifetime aggregates across all runs of this bot. */
  lifetimeStats?: {
    totalRuns: number;
    realized: number;
    cycles: number;
    volume: number;
    fees: number;
  };
  marketPrice?: string | null;
}

export const useBots = (includeArchived = false) =>
  useQuery({
    queryKey: ['bots', { includeArchived }],
    queryFn: () => apiCall<Bot[]>(() => api.get(`/bots${includeArchived ? '?archived=true' : ''}`)),
    enabled: !!tokenStore.access,
    refetchInterval: 30_000,
  });

export const useBot = (id: string) =>
  useQuery({
    queryKey: ['bot', id],
    queryFn: () => apiCall<Bot>(() => api.get(`/bots/${id}`)),
    enabled: !!tokenStore.access && !!id,
    refetchInterval: 30_000,
  });

export const useBotEvents = (id: string) =>
  useQuery({
    queryKey: ['bot-events', id],
    queryFn: () => apiCall<Array<{ id: string; type: string; message: string; data: unknown; createdAt: string }>>(
      () => api.get(`/bots/${id}/events?limit=50`),
    ),
    enabled: !!tokenStore.access && !!id,
    refetchInterval: 30_000,
  });

export const useBotOrders = (id: string) =>
  useQuery({
    queryKey: ['bot-orders', id],
    queryFn: () => apiCall<Array<{ id: string; side: string; price: string; quantity: string; status: string; placedAt: string }>>(
      () => api.get(`/bots/${id}/orders?limit=50`),
    ),
    enabled: !!tokenStore.access && !!id,
    refetchInterval: 30_000,
  });

export interface BotLive {
  botId: string;
  symbol: string;
  strategyKey: string | null;
  initialStartPrice: string | null;
  marketPrice: string | null;
  /** Active run id (null when bot is stopped). */
  currentRunId: string | null;
  /** Lifetime aggregates across all runs of this bot. */
  lifetime: {
    totalRuns: number;
    realized: number;
    cycles: number;
    volume: number;
    fees: number;
  };
  orders: Array<{
    side: 'BUY' | 'SELL'; price: string; quantity: string; status: string;
    orderId: number | null; clientOrderId: string | null;
    errorCategory: string | null; errorMsg: string | null; errorCode: number | null;
  }>;
  integrity: {
    total: number; open: number; failed: number;
    breakdown: Record<string, number>;
    startedAtMs: number | null;
    nextReconcileAtMs: number | null;
    latestEvent: { type: string; message: string; createdAt: string } | null;
  };
  pnl: {
    realized: number;
    /** Unrealized = (currentPrice − avgCost) × signedHeld. */
    unrealized: number;
    total: number;
    cyclesCompleted: number;
    avgPerCycle: number;
    series: Array<{ ts: number; pnl: number }>;
    heldQty: number;
    soldQty: number;
    signedHeld: number;
    /** Weighted-avg cost of open inventory. Available for Grid + DCA. */
    breakEvenPrice: number | null;
    /** Capital actually deployed (Σ buy notional of open legs). */
    actualInvested: number;
    /** True ROI = (realized + unrealized) / actualInvested × 100. */
    roi: number | null;
    wins: number;
    losses: number;
    winRate: number | null;
    avgWin: number;
    avgLoss: number;
    /** grossWins / grossLosses; null when no losses (or no trades). */
    profitFactor: number | null;
    bestCycle: number;
    worstCycle: number;
    maxDrawdownAbs: number;
    maxDrawdownPct: number;
    /** Sharpe ratio annualized (cycle-frequency). null if < 2 cycles. */
    sharpe: number | null;
    /** Open legs that contribute to the current avg cost. */
    openLegs: Array<{ side: 'BUY' | 'SELL'; price: number; qty: number; notional: number }>;
  };
  volume: {
    totalQuote: number;
    tradeCount: number;
    totalFees: number;
    feeAsset: string | null;
  };
  events: {
    recent: Array<{
      id: string;
      type: string;
      message: string;
      createdAt: string;
      cyclePnl: number | null;
    }>;
  };
  heartbeat: { lastEventAtMs: number | null; stale: boolean };
  /** Active cooldown info (DCA Simple only — null otherwise). */
  cooldown: { untilMs: number; secondsRemaining: number } | null;
  /** Bot configuration as parsed from the params (mirrored for convenience). */
  config: {
    direction: string | null;
    gridLevels: number | null;
    gridSpread: number | null;
    orderSize: number | null;
    takeProfit: number | null;
    priceMultiplierMode: string;
    priceMultiplier: number;
    sizeMultiplierMode: string;
    sizeMultiplier: number;
    cooldownMinutes: number | null;
    recenterAfterMinutes: number | null;
    durationMinutes: number | null;
    customStartPrice: number | null;
  };
  /** Server-computed derivatives so the UI doesn't have to re-implement formulas. */
  derived: {
    priceRange: { low: number; high: number } | null;
    totalInvestment: number | null;
    expectedPerCycle: number | null;
    estimatedProfitAllFill: number | null;
    openBuyCount: number;
    openSellCount: number;
    nextBuy: { price: number; distance: number; distancePct: number } | null;
    nextSell: { price: number; distance: number; distancePct: number } | null;
  };
  /** 24h ticker stats from Binance (null if exchange call failed). */
  market: {
    change24h: number;
    changePct24h: number;
    high24h: number;
    low24h: number;
    volume24h: number;
    quoteVolume24h: number;
  } | null;
}

export const useBotLive = (id: string) =>
  useQuery({
    queryKey: ['bot-live', id],
    queryFn: () => apiCall<BotLive>(() => api.get(`/bots/${id}/live`)),
    enabled: !!tokenStore.access && !!id,
    refetchInterval: 5_000,
  });

// ─── Bot Runs ───
export interface BotRunRow {
  id: string;
  runNumber: number;
  status: 'RUNNING' | 'STOPPED' | 'ERROR';
  startedAt: string;
  stoppedAt: string | null;
  stopReason: string | null;
  realizedPnl: string;
  unrealizedAtStop: string | null;
  cyclesCompleted: number;
  tradesCount: number;
  volumeQuote: string;
  fees: string;
  maxDrawdownAbs: string | null;
  durationMs: string | null;
  initialStartPrice: string | null;
  paramsSnapshot: Record<string, unknown>;
}
export const useBotRuns = (id: string) =>
  useQuery({
    queryKey: ['bot-runs', id],
    queryFn: () => apiCall<BotRunRow[]>(() => api.get(`/bots/${id}/runs`)),
    enabled: !!tokenStore.access && !!id,
  });

export const useReplayRun = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { botId: string; runId: string }) =>
      apiCall(() => api.post(`/bots/${input.botId}/runs/${input.runId}/replay`, {})),
    onSuccess: (_, input) => {
      qc.invalidateQueries({ queryKey: ['bot', input.botId] });
      qc.invalidateQueries({ queryKey: ['bot-runs', input.botId] });
      qc.invalidateQueries({ queryKey: ['bots'] });
    },
  });
};

export const useUpdateBotParams = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; params: Record<string, unknown> }) =>
      apiCall(() => api.patch(`/bots/${input.id}/params`, { params: input.params })),
    onSuccess: (_, input) => {
      qc.invalidateQueries({ queryKey: ['bot', input.id] });
      qc.invalidateQueries({ queryKey: ['bot-live', input.id] });
    },
  });
};

export const useArchiveBot = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiCall(() => api.post(`/bots/${id}/archive`, {})),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bots'] }),
  });
};

export const useUnarchiveBot = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiCall(() => api.post(`/bots/${id}/unarchive`, {})),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bots'] }),
  });
};

export const useCreateBot = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      name: string; strategyId: string; apiKeyId: string; symbol: string;
      params: Record<string, unknown>; riskConfig?: Record<string, unknown>;
      paperTrading?: boolean;
      dailyLossLimit?: number;
      maxDrawdownPct?: number;
    }) => apiCall<Bot>(() => api.post('/bots', input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bots'] }),
  });
};

export const useStartBot = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiCall(() => api.post(`/bots/${id}/start`)),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['bots'] });
      qc.invalidateQueries({ queryKey: ['bot', id] });
    },
  });
};

export const useStopBot = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiCall(() => api.post(`/bots/${id}/stop`)),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['bots'] });
      qc.invalidateQueries({ queryKey: ['bot', id] });
    },
  });
};

export const useCloneBot = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; name?: string; symbol?: string }) =>
      apiCall<Bot>(() => api.post(`/bots/${input.id}/clone`, { name: input.name, symbol: input.symbol })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bots'] }),
  });
};

export const useCancelPending = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiCall<{ ok: true }>(() => api.post(`/bots/${id}/cancel-pending`)),
    onSuccess: (_, id) => qc.invalidateQueries({ queryKey: ['bot-live', id] }),
  });
};

export const useDeleteBot = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiCall(() => api.delete(`/bots/${id}`)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bots'] }),
  });
};

export const useRecomputeBotStats = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id?: string) =>
      apiCall(() => api.post(id ? `/bots/${id}/recompute-stats` : '/bots/recompute-stats')),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['bots'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
      if (id) qc.invalidateQueries({ queryKey: ['bot', id] });
    },
  });
};

export const useEmergencyStopAll = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiCall<{ stopped: number; bots: { id: string; name: string }[] }>(
      () => api.post('/bots/emergency-stop'),
    ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bots'] }),
  });
};

export const useUpdateBotRisk = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; dailyLossLimit?: number | null; maxDrawdownPct?: number | null }) =>
      apiCall(() => api.patch(`/bots/${input.id}/risk`, {
        dailyLossLimit: input.dailyLossLimit,
        maxDrawdownPct: input.maxDrawdownPct,
      })),
    onSuccess: (_, input) => {
      qc.invalidateQueries({ queryKey: ['bot', input.id] });
      qc.invalidateQueries({ queryKey: ['bots'] });
    },
  });
};
