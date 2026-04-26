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
export const useReportsOverview = () =>
  useQuery({
    queryKey: ['reports', 'overview'],
    queryFn: () => apiCall<{
      totals: { realizedPnl: number; unrealizedPnl: number; volume: number; trades: number };
      bots: { total: number; running: number };
    }>(() => api.get('/reports/overview')),
    enabled: !!tokenStore.access,
  });

export const usePnlSeries = (days = 30) =>
  useQuery({
    queryKey: ['reports', 'pnl', days],
    queryFn: () => apiCall<Array<{ date: string; pnl: number; volume: number; count: number }>>(
      () => api.get(`/reports/pnl-series?days=${days}`),
    ),
    enabled: !!tokenStore.access,
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
export const useAdminStats = () =>
  useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: () => apiCall<{
      users: number; bots: { total: number; running: number };
      payments: { total: number; completed: number };
      mrr: number;
    }>(() => api.get('/admin/stats')),
    enabled: !!tokenStore.access,
    refetchInterval: 10_000,
  });

export const useAdminUsers = (search?: string) =>
  useQuery({
    queryKey: ['admin', 'users', search],
    queryFn: () => apiCall<Array<{
      id: string; email: string; fullName: string | null; role: string; status: string;
      createdAt: string; lastLoginAt: string | null; _count: { bots: number; apiKeys: number };
    }>>(() => api.get(`/admin/users${search ? `?search=${encodeURIComponent(search)}` : ''}`)),
    enabled: !!tokenStore.access,
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

export const useAdminSettings = () =>
  useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => apiCall<Array<{ key: string; value: unknown; isPublic: boolean; category: string | null }>>(
      () => api.get('/admin/settings'),
    ),
    enabled: !!tokenStore.access,
  });

export const useAdminFlags = () =>
  useQuery({
    queryKey: ['admin', 'flags'],
    queryFn: () => apiCall<Array<{ key: string; enabled: boolean; rolloutPct: number; allowList: string[]; description: string | null }>>(
      () => api.get('/admin/flags'),
    ),
    enabled: !!tokenStore.access,
  });

export const useAdminAudit = () =>
  useQuery({
    queryKey: ['admin', 'audit'],
    queryFn: () => apiCall<Array<{ id: string; userId: string | null; actorType: string; action: string; targetType: string | null; targetId: string | null; createdAt: string; metadata: Record<string, unknown> | null }>>(
      () => api.get('/admin/audit'),
    ),
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
