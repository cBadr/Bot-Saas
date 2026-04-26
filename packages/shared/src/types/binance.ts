import type { OrderSide, AllowedOrderType, TimeInForce } from '../constants/index';

export interface BinanceServerTime {
  serverTime: number;
}

export interface BinanceSymbolFilter {
  filterType: string;
  [key: string]: unknown;
}

export interface BinanceSymbolInfo {
  symbol: string;
  status: string;
  baseAsset: string;
  baseAssetPrecision: number;
  quoteAsset: string;
  quoteAssetPrecision: number;
  orderTypes: string[];
  isSpotTradingAllowed: boolean;
  filters: BinanceSymbolFilter[];
}

export interface BinanceExchangeInfo {
  timezone: string;
  serverTime: number;
  symbols: BinanceSymbolInfo[];
}

export interface BinanceBalance {
  asset: string;
  free: string;
  locked: string;
}

export interface BinanceAccountInfo {
  makerCommission: number;
  takerCommission: number;
  canTrade: boolean;
  canWithdraw: boolean;
  canDeposit: boolean;
  updateTime: number;
  accountType: string;
  balances: BinanceBalance[];
  permissions: string[];
}

export interface PlaceOrderParams {
  symbol: string;
  side: OrderSide;
  type: AllowedOrderType;
  quantity: string;
  price: string;
  timeInForce?: TimeInForce;
  newClientOrderId?: string;
}

export interface BinanceOrderResponse {
  symbol: string;
  orderId: number;
  orderListId: number;
  clientOrderId: string;
  transactTime: number;
  price: string;
  origQty: string;
  executedQty: string;
  cummulativeQuoteQty: string;
  status: string;
  timeInForce: string;
  type: string;
  side: string;
  workingTime: number;
  fills?: Array<{
    price: string;
    qty: string;
    commission: string;
    commissionAsset: string;
    tradeId: number;
  }>;
}

export interface BinanceOpenOrder {
  symbol: string;
  orderId: number;
  clientOrderId: string;
  price: string;
  origQty: string;
  executedQty: string;
  status: string;
  timeInForce: string;
  type: string;
  side: string;
  time: number;
  updateTime: number;
}
