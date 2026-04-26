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
