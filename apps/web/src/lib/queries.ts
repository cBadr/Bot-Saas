import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiCall, tokenStore } from './api';

// ─── Auth ───
export interface User {
  id: string; email: string; fullName?: string | null; avatarUrl?: string | null;
  role: string; status: string; twoFactorEnabled: boolean;
  telegramChatId?: string | null; telegramUsername?: string | null;
  referralCode?: string | null; createdAt: string; lastLoginAt?: string | null;
}

export const useMe = () =>
  useQuery({
    queryKey: ['me'],
    queryFn: () => apiCall<User>(() => api.get('/users/me')),
    enabled: !!tokenStore.access,
    retry: false,
  });

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
export interface Bot {
  id: string; name: string; symbol: string; status: string;
  baseAsset: string; quoteAsset: string;
  paperTrading?: boolean;
  totalTrades: number; realizedPnlQuote: string;
  startedAt: string | null; createdAt: string;
  strategy?: { id: string; name: string; type: string };
  apiKey?: { id: string; label: string; status: string };
}

export const useBots = () =>
  useQuery({
    queryKey: ['bots'],
    queryFn: () => apiCall<Bot[]>(() => api.get('/bots')),
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
