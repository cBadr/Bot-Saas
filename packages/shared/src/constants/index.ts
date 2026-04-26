export const APP_NAME = 'Orca';

export const FEE_FREE_QUOTE_ASSET = 'FDUSD';

export const ALLOWED_ORDER_TYPES = ['LIMIT', 'LIMIT_MAKER'] as const;
export type AllowedOrderType = (typeof ALLOWED_ORDER_TYPES)[number];

export const ORDER_SIDES = ['BUY', 'SELL'] as const;
export type OrderSide = (typeof ORDER_SIDES)[number];

export const TIME_IN_FORCE = ['GTC', 'IOC', 'FOK'] as const;
export type TimeInForce = (typeof TIME_IN_FORCE)[number];

export const BOT_STATUSES = [
  'CREATED',
  'STARTING',
  'RUNNING',
  'PAUSED',
  'STOPPING',
  'STOPPED',
  'ERROR',
] as const;
export type BotStatus = (typeof BOT_STATUSES)[number];

export const STRATEGY_TYPES = ['GRID', 'DCA', 'CUSTOM'] as const;
export type StrategyType = (typeof STRATEGY_TYPES)[number];

export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const LOG_CATEGORIES = [
  'APP',
  'TRADE',
  'API',
  'BINANCE',
  'AUDIT',
  'BOT',
  'STRATEGY',
  'PAYMENT',
  'AUTH',
  'SYSTEM',
] as const;
export type LogCategory = (typeof LOG_CATEGORIES)[number];

export const SUBSCRIPTION_STATUSES = [
  'TRIAL',
  'ACTIVE',
  'PAST_DUE',
  'CANCELED',
  'EXPIRED',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const USER_ROLES = ['USER', 'PRO', 'ADMIN', 'SUPER_ADMIN'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const BINANCE_ENDPOINTS = {
  TIME: '/api/v3/time',
  EXCHANGE_INFO: '/api/v3/exchangeInfo',
  ACCOUNT: '/api/v3/account',
  ORDER: '/api/v3/order',
  OPEN_ORDERS: '/api/v3/openOrders',
  ALL_ORDERS: '/api/v3/allOrders',
  MY_TRADES: '/api/v3/myTrades',
  USER_DATA_STREAM: '/api/v3/userDataStream',
  TICKER_PRICE: '/api/v3/ticker/price',
  TICKER_24HR: '/api/v3/ticker/24hr',
  KLINES: '/api/v3/klines',
} as const;
