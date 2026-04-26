import { request } from 'undici';
import { env } from '@orca/config';
import { createLogger } from '@orca/logger';
import {
  ALLOWED_ORDER_TYPES,
  BINANCE_ENDPOINTS,
  BinanceApiError,
  FEE_FREE_QUOTE_ASSET,
  InvalidOrderError,
  type AllowedOrderType,
  type BinanceAccountInfo,
  type BinanceExchangeInfo,
  type BinanceOpenOrder,
  type BinanceOrderResponse,
  type OrderSide,
  type PlaceOrderParams,
  type TimeInForce,
} from '@orca/shared';
import { buildQueryString, signPayload } from './signer';
import { binanceTimeSync } from './time-sync';
import type { BinanceRateLimiter } from './rate-limiter';

const log = createLogger('BINANCE', { module: 'Client' });

export interface BinanceCredentials {
  apiKeyId: string; // internal id (used for rate limit bucket)
  apiKey: string;
  apiSecret: string;
}

export interface BinanceClientOptions {
  credentials?: BinanceCredentials;
  rateLimiter?: BinanceRateLimiter;
  recvWindow?: number;
  enforceLimitOnly?: boolean;
}

export class BinanceClient {
  private readonly baseUrl = env.BINANCE_BASE_URL;
  private readonly recvWindow: number;
  private readonly enforceLimitOnly: boolean;

  constructor(private readonly opts: BinanceClientOptions = {}) {
    this.recvWindow = opts.recvWindow ?? env.BINANCE_DEFAULT_RECV_WINDOW;
    this.enforceLimitOnly = opts.enforceLimitOnly ?? true;
  }

  // ─── Public Endpoints ────────────────────────────────

  async getServerTime(): Promise<number> {
    const data = await this.publicGet<{ serverTime: number }>(BINANCE_ENDPOINTS.TIME);
    return data.serverTime;
  }

  async getExchangeInfo(symbols?: string[]): Promise<BinanceExchangeInfo> {
    const qs = symbols?.length
      ? `?symbols=${encodeURIComponent(JSON.stringify(symbols))}`
      : '';
    return this.publicGet<BinanceExchangeInfo>(`${BINANCE_ENDPOINTS.EXCHANGE_INFO}${qs}`);
  }

  async getTickerPrice(symbol: string): Promise<{ symbol: string; price: string }> {
    return this.publicGet(`${BINANCE_ENDPOINTS.TICKER_PRICE}?symbol=${symbol}`);
  }

  async getKlines(params: {
    symbol: string;
    interval: string;
    limit?: number;
    startTime?: number;
    endTime?: number;
  }): Promise<unknown[][]> {
    const qs = buildQueryString(params);
    return this.publicGet(`${BINANCE_ENDPOINTS.KLINES}?${qs}`);
  }

  // ─── Signed (Authenticated) Endpoints ────────────────

  async getAccount(): Promise<BinanceAccountInfo> {
    return this.signedGet<BinanceAccountInfo>(BINANCE_ENDPOINTS.ACCOUNT);
  }

  async getOpenOrders(symbol?: string): Promise<BinanceOpenOrder[]> {
    return this.signedGet<BinanceOpenOrder[]>(
      BINANCE_ENDPOINTS.OPEN_ORDERS,
      symbol ? { symbol } : {},
    );
  }

  async placeOrder(params: PlaceOrderParams): Promise<BinanceOrderResponse> {
    if (this.enforceLimitOnly && !ALLOWED_ORDER_TYPES.includes(params.type)) {
      throw new InvalidOrderError(
        `Order type ${params.type} is not allowed. Only ${ALLOWED_ORDER_TYPES.join(', ')} are permitted.`,
      );
    }
    if (this.enforceLimitOnly && !params.symbol.endsWith(FEE_FREE_QUOTE_ASSET)) {
      log.warn('Placing order on non-FDUSD symbol — trading fees will apply', {
        symbol: params.symbol,
      });
    }

    const body: Record<string, string | number> = {
      symbol: params.symbol,
      side: params.side,
      type: params.type,
      quantity: params.quantity,
      price: params.price,
    };
    if (params.type === 'LIMIT') {
      body.timeInForce = (params.timeInForce ?? 'GTC') as TimeInForce;
    }
    if (params.newClientOrderId) body.newClientOrderId = params.newClientOrderId;

    return this.signedPost<BinanceOrderResponse>(BINANCE_ENDPOINTS.ORDER, body, true);
  }

  async cancelOrder(params: {
    symbol: string;
    orderId?: number;
    origClientOrderId?: string;
  }): Promise<BinanceOrderResponse> {
    return this.signedDelete<BinanceOrderResponse>(BINANCE_ENDPOINTS.ORDER, params);
  }

  async cancelAllOrders(symbol: string): Promise<unknown> {
    return this.signedDelete(BINANCE_ENDPOINTS.OPEN_ORDERS, { symbol });
  }

  async getOrder(params: {
    symbol: string;
    orderId?: number;
    origClientOrderId?: string;
  }): Promise<BinanceOrderResponse> {
    return this.signedGet(BINANCE_ENDPOINTS.ORDER, params);
  }

  async getMyTrades(params: { symbol: string; startTime?: number; limit?: number }) {
    return this.signedGet(BINANCE_ENDPOINTS.MY_TRADES, params);
  }

  // ─── User Data Stream ────────────────────────────────
  // These endpoints are "API-key only" — they require X-MBX-APIKEY header
  // but MUST NOT include signature/timestamp. Sending them as signed requests
  // results in HTTP 410 from Binance.

  async createListenKey(): Promise<string> {
    const res = await this.apiKeyPost<{ listenKey: string }>(BINANCE_ENDPOINTS.USER_DATA_STREAM);
    return res.listenKey;
  }

  async keepAliveListenKey(listenKey: string): Promise<void> {
    await this.apiKeyPut(`${BINANCE_ENDPOINTS.USER_DATA_STREAM}?listenKey=${listenKey}`);
  }

  async closeListenKey(listenKey: string): Promise<void> {
    await this.apiKeyDelete(`${BINANCE_ENDPOINTS.USER_DATA_STREAM}?listenKey=${listenKey}`);
  }

  private async apiKeyPost<T>(path: string): Promise<T> {
    return this.sendApiKeyOnly<T>('POST', path);
  }
  private async apiKeyPut<T>(path: string): Promise<T> {
    return this.sendApiKeyOnly<T>('PUT', path);
  }
  private async apiKeyDelete<T>(path: string): Promise<T> {
    return this.sendApiKeyOnly<T>('DELETE', path);
  }

  private async sendApiKeyOnly<T>(method: string, path: string): Promise<T> {
    if (!this.opts.credentials) throw new InvalidOrderError('API credentials required');
    if (this.opts.rateLimiter) {
      await this.opts.rateLimiter.consume(this.opts.credentials.apiKeyId, 'REQUEST');
    }
    const url = `${this.baseUrl}${path}`;
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-MBX-APIKEY': this.opts.credentials.apiKey,
    };
    const res = await request(url, { method, headers });
    const text = await res.body.text();
    let parsed: unknown;
    try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text }; }
    if (res.statusCode < 200 || res.statusCode >= 300) {
      const err = parsed as { code?: number; msg?: string };
      throw new BinanceApiError(
        err.msg ?? `HTTP ${res.statusCode}`,
        err.code,
        { path, status: res.statusCode },
      );
    }
    return parsed as T;
  }

  // ─── Internal HTTP ───────────────────────────────────

  private async publicGet<T>(pathWithQs: string): Promise<T> {
    return this.send<T>('GET', pathWithQs, undefined, false, 'REQUEST');
  }

  private async signedGet<T>(
    path: string,
    params: Record<string, string | number> = {},
  ): Promise<T> {
    const qs = this.buildSignedQuery(params);
    return this.send<T>('GET', `${path}?${qs}`, undefined, true, 'REQUEST');
  }

  private async signedPost<T>(
    path: string,
    body: Record<string, string | number>,
    isOrder: boolean,
  ): Promise<T> {
    const qs = this.buildSignedQuery(body);
    return this.send<T>('POST', `${path}?${qs}`, undefined, true, isOrder ? 'ORDER' : 'REQUEST');
  }

  private async signedPut<T>(path: string, params: Record<string, string | number>): Promise<T> {
    const qs = this.buildSignedQuery(params);
    return this.send<T>('PUT', `${path}?${qs}`, undefined, true, 'REQUEST');
  }

  private async signedDelete<T>(
    path: string,
    params: Record<string, string | number | undefined>,
  ): Promise<T> {
    const qs = this.buildSignedQuery(params);
    return this.send<T>('DELETE', `${path}?${qs}`, undefined, true, 'REQUEST');
  }

  private buildSignedQuery(params: Record<string, string | number | undefined>): string {
    if (!this.opts.credentials) {
      throw new InvalidOrderError('Signed request requires credentials');
    }
    const all = {
      ...params,
      recvWindow: this.recvWindow,
      timestamp: binanceTimeSync.now(),
    };
    const qs = buildQueryString(all);
    const sig = signPayload(qs, this.opts.credentials.apiSecret);
    return `${qs}&signature=${sig}`;
  }

  private async send<T>(
    method: string,
    path: string,
    body: undefined,
    signed: boolean,
    rateLimitScope: 'REQUEST' | 'ORDER',
  ): Promise<T> {
    if (this.opts.rateLimiter && this.opts.credentials) {
      await this.opts.rateLimiter.consume(this.opts.credentials.apiKeyId, rateLimitScope);
    }

    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    if (signed) {
      if (!this.opts.credentials) throw new InvalidOrderError('Missing API credentials');
      headers['X-MBX-APIKEY'] = this.opts.credentials.apiKey;
    }

    const t0 = Date.now();
    const res = await request(url, { method, headers, body });
    const durationMs = Date.now() - t0;
    const status = res.statusCode;
    const text = await res.body.text();

    let parsed: unknown;
    try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text }; }

    log.debug('Binance call', {
      method,
      path: path.split('?')[0],
      status,
      durationMs,
      rateLimitScope,
    });

    if (status < 200 || status >= 300) {
      const err = parsed as { code?: number; msg?: string };
      throw new BinanceApiError(
        err.msg ?? `HTTP ${status}`,
        err.code,
        { path: path.split('?')[0], status, durationMs },
      );
    }
    return parsed as T;
  }
}

export function createBinanceClient(
  credentials: BinanceCredentials,
  rateLimiter?: BinanceRateLimiter,
): BinanceClient {
  return new BinanceClient({ credentials, rateLimiter });
}

export function createPublicBinanceClient(): BinanceClient {
  return new BinanceClient({ enforceLimitOnly: false });
}
