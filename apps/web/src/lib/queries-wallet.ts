import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiCall, tokenStore } from './api';

export interface WalletBalance {
  asset: string;
  free: string;
  locked: string;
  total: string;
  fdusdPrice: string | null;
  fdusdValue: string;
  tradeable: boolean;
}

export interface WalletOverview {
  apiKeyId: string;
  totalFdusdValue: string;
  assetCount: number;
  tradeableCount: number;
  balances: WalletBalance[];
}

export const useWalletOverview = (apiKeyId: string | undefined) =>
  useQuery({
    queryKey: ['wallet', apiKeyId, 'overview'],
    queryFn: () => apiCall<WalletOverview>(() => api.get(`/wallet/${apiKeyId}`)),
    enabled: !!tokenStore.access && !!apiKeyId,
    refetchInterval: 15_000,
  });

export interface SymbolInfo {
  symbol: string;
  price: string;
  filters: {
    symbol: string; baseAsset: string; quoteAsset: string;
    tickSize: string; stepSize: string;
    minQty: string; maxQty: string; minNotional: string;
  };
}
export const useSymbolInfo = (apiKeyId: string | undefined, symbol: string | undefined) =>
  useQuery({
    queryKey: ['wallet', apiKeyId, 'symbol', symbol],
    queryFn: () => apiCall<SymbolInfo>(() => api.get(`/wallet/${apiKeyId}/symbol/${symbol}`)),
    enabled: !!tokenStore.access && !!apiKeyId && !!symbol,
    refetchInterval: 5_000,
  });

export interface PlacedOrder {
  orderId: number;
  clientOrderId: string;
  symbol: string;
  side: string;
  price: string;
  origQty: string;
  executedQty: string;
  status: string;
}

export const useWalletTrade = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      apiKeyId: string;
      symbol: string;
      side: 'BUY' | 'SELL';
      price?: number;
      quantity?: number;
      quoteAmount?: number;
    }) => apiCall<PlacedOrder>(() => api.post(`/wallet/${input.apiKeyId}/trade`, {
      symbol: input.symbol,
      side: input.side,
      price: input.price,
      quantity: input.quantity,
      quoteAmount: input.quoteAmount,
    })),
    onSuccess: (_, input) => {
      qc.invalidateQueries({ queryKey: ['wallet', input.apiKeyId] });
    },
  });
};

export interface OpenOrder {
  symbol: string;
  orderId: number;
  clientOrderId: string;
  price: string;
  origQty: string;
  executedQty: string;
  status: string;
  side: string;
  type: string;
  time: number;
}
export const useOpenOrders = (apiKeyId: string | undefined, symbol?: string) =>
  useQuery({
    queryKey: ['wallet', apiKeyId, 'open-orders', symbol ?? 'all'],
    queryFn: () => apiCall<OpenOrder[]>(() =>
      api.get(`/wallet/${apiKeyId}/open-orders${symbol ? `?symbol=${symbol}` : ''}`),
    ),
    enabled: !!tokenStore.access && !!apiKeyId,
    refetchInterval: 8_000,
  });

export const useCancelWalletOrder = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { apiKeyId: string; symbol: string; orderId: number }) =>
      apiCall(() => api.delete(`/wallet/${input.apiKeyId}/trade/${input.symbol}/${input.orderId}`)),
    onSuccess: (_, input) => {
      qc.invalidateQueries({ queryKey: ['wallet', input.apiKeyId] });
    },
  });
};

export const useCancelAllOrders = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { apiKeyId: string; symbol?: string; includeBots?: boolean }) =>
      apiCall<{ cancelled: number; skipped: number; failed: number; total: number }>(
        () => api.post(`/wallet/${input.apiKeyId}/cancel-all`, {
          symbol: input.symbol,
          includeBots: input.includeBots,
        }),
      ),
    onSuccess: (_, input) => {
      qc.invalidateQueries({ queryKey: ['wallet', input.apiKeyId] });
    },
  });
};

export interface RecentTrade {
  id: number;
  orderId: number;
  symbol: string;
  price: string;
  qty: string;
  quoteQty: string;
  commission: string;
  commissionAsset: string;
  time: number;
  isBuyer: boolean;
  isMaker: boolean;
}
export const useRecentTrades = (apiKeyId: string | undefined, symbol: string | undefined) =>
  useQuery({
    queryKey: ['wallet', apiKeyId, 'trades', symbol],
    queryFn: () => apiCall<RecentTrade[]>(() => api.get(`/wallet/${apiKeyId}/trades/${symbol}`)),
    enabled: !!tokenStore.access && !!apiKeyId && !!symbol,
  });

// ─── Enriched overview with 24h changes ───
export interface EnrichedBalance extends WalletBalance {
  change24h: { changePct: number; change: number; high: number; low: number; volume: number } | null;
}
export interface EnrichedWalletOverview extends Omit<WalletOverview, 'balances'> {
  balances: EnrichedBalance[];
  change24h: { absolute: number; percentage: number; valueAgo: number };
}
export const useWalletEnriched = (apiKeyId: string | undefined) =>
  useQuery({
    queryKey: ['wallet', apiKeyId, 'enriched'],
    queryFn: () => apiCall<EnrichedWalletOverview>(() => api.get(`/wallet/${apiKeyId}/enriched`)),
    enabled: !!tokenStore.access && !!apiKeyId,
    refetchInterval: 30_000,
  });

// ─── Deposits + Withdrawals ───
export interface DepositRow {
  coin: string; network: string; amount: string;
  status: number; address: string; addressTag: string | null;
  txId: string; insertTime: number; walletType: number;
}
export interface WithdrawalRow {
  coin: string; network: string; amount: string; transactionFee: string;
  status: number; address: string; addressTag: string | null;
  txId: string; applyTime: string;
}
export const useDeposits = (apiKeyId: string | undefined) =>
  useQuery({
    queryKey: ['wallet', apiKeyId, 'deposits'],
    queryFn: () => apiCall<DepositRow[]>(() => api.get(`/wallet/${apiKeyId}/deposits`)),
    enabled: !!tokenStore.access && !!apiKeyId,
  });
export const useWithdrawals = (apiKeyId: string | undefined) =>
  useQuery({
    queryKey: ['wallet', apiKeyId, 'withdrawals'],
    queryFn: () => apiCall<WithdrawalRow[]>(() => api.get(`/wallet/${apiKeyId}/withdrawals`)),
    enabled: !!tokenStore.access && !!apiKeyId,
  });

// ─── All trades (cross-symbol) ───
export interface AllTradeRow {
  symbol: string; id: number; orderId: number; price: string;
  qty: string; quoteQty: string; commission: string; commissionAsset: string;
  time: number; isBuyer: boolean; isMaker: boolean;
}
export const useAllTrades = (apiKeyId: string | undefined, params: { symbols?: string[]; from?: string; to?: string } = {}) =>
  useQuery({
    queryKey: ['wallet', apiKeyId, 'all-trades', params],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (params.symbols?.length) qs.set('symbols', params.symbols.join(','));
      if (params.from) qs.set('from', params.from);
      if (params.to) qs.set('to', params.to);
      return apiCall<AllTradeRow[]>(() => api.get(`/wallet/${apiKeyId}/all-trades?${qs.toString()}`));
    },
    enabled: !!tokenStore.access && !!apiKeyId,
  });

// ─── Cost basis ───
export interface CostBasisRow {
  asset: string; symbol: string;
  heldQty: number; heldValue: number;
  avgBuyPrice: number | null;
  totalBuyQty: number; totalBuyCost: number;
  totalSellQty: number; totalSellProceeds: number;
  realizedPnl: number; unrealizedPnl: number | null;
  currentPrice: number;
}
export const useCostBasis = (apiKeyId: string | undefined) =>
  useQuery({
    queryKey: ['wallet', apiKeyId, 'cost-basis'],
    queryFn: () => apiCall<CostBasisRow[]>(() => api.get(`/wallet/${apiKeyId}/cost-basis`)),
    enabled: !!tokenStore.access && !!apiKeyId,
  });

// ─── Portfolio snapshots ───
export interface SnapshotPoint { ts: number; value: number; assets: number }
export const useSnapshots = (apiKeyId: string | undefined, days = 30) =>
  useQuery({
    queryKey: ['wallet', apiKeyId, 'snapshots', days],
    queryFn: () => apiCall<SnapshotPoint[]>(() => api.get(`/wallet/${apiKeyId}/snapshots?days=${days}`)),
    enabled: !!tokenStore.access && !!apiKeyId,
  });
export const useSnapshotNow = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (apiKeyId: string) => apiCall<{ id: string; createdAt: string; totalValueUsd: string }>(
      () => api.post(`/wallet/${apiKeyId}/snapshot`, {}),
    ),
    onSuccess: (_, apiKeyId) => qc.invalidateQueries({ queryKey: ['wallet', apiKeyId, 'snapshots'] }),
  });
};

// ─── Dust conversion ───
export const useConvertDust = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { apiKeyId: string; assets: string[] }) =>
      apiCall<{ totalServiceCharge: string; totalTransfered: string; transferResult: Array<{ fromAsset: string; transferedAmount: string }> }>(
        () => api.post(`/wallet/${input.apiKeyId}/dust-convert`, { assets: input.assets }),
      ),
    onSuccess: (_, input) => qc.invalidateQueries({ queryKey: ['wallet', input.apiKeyId] }),
  });
};

// ─── Price Alerts ───
export interface PriceAlertRow {
  id: string; symbol: string; asset: string;
  direction: 'ABOVE' | 'BELOW'; threshold: string;
  note: string | null;
  enabled: boolean;
  triggeredAt: string | null;
  triggeredPrice: string | null;
  createdAt: string;
}
export const usePriceAlerts = () =>
  useQuery({
    queryKey: ['wallet', 'alerts'],
    queryFn: () => apiCall<PriceAlertRow[]>(() => api.get('/wallet/alerts/list')),
    enabled: !!tokenStore.access,
  });
export const useCreateAlert = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { symbol: string; asset: string; direction: 'ABOVE' | 'BELOW'; threshold: number; note?: string }) =>
      apiCall<PriceAlertRow>(() => api.post('/wallet/alerts', input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wallet', 'alerts'] }),
  });
};
export const useToggleAlert = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; enabled: boolean }) =>
      apiCall<PriceAlertRow>(() => api.patch(`/wallet/alerts/${input.id}/toggle`, { enabled: input.enabled })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wallet', 'alerts'] }),
  });
};
export const useDeleteAlert = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiCall<{ ok: true }>(() => api.delete(`/wallet/alerts/${id}`)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wallet', 'alerts'] }),
  });
};
