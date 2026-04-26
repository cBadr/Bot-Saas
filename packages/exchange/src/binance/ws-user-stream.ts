import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';
import { createLogger } from '@orca/logger';
import type { UserDataEvent } from './user-data-stream';

const log = createLogger('BINANCE', { module: 'WSUserStream' });

const WS_API_URL = 'wss://ws-api.binance.com:443/ws-api/v3';
const WS_STREAM_URL = 'wss://stream.binance.com:9443/ws';
const KEEPALIVE_MS = 30 * 60 * 1000; // 30 min (Binance recommends 30m for listen keys)

interface WsApiResponse<T> {
  id: string;
  status: number;
  result?: T;
  error?: { code: number; msg: string };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export interface WSUserStreamOptions {
  apiKey: string;
  onEvent: (event: UserDataEvent) => void | Promise<void>;
  onConnected?: () => void;
  onDisconnected?: () => void;
}

/**
 * Real-time user data stream using Binance WebSocket API.
 *
 * Two persistent connections:
 *  1. wsApi  — JSON-RPC style (userDataStream.start / .ping / .stop)
 *  2. stream — receives executionReport / outboundAccountPosition / etc.
 *
 * On disconnect, exponentially backs off and rebuilds both. Pings the
 * listen key every 30 minutes to prevent expiry.
 */
export class WebSocketUserStream {
  private wsApi?: WebSocket;
  private stream?: WebSocket;
  private listenKey?: string;
  private pending = new Map<string, PendingRequest>();
  private keepAliveTimer?: NodeJS.Timeout;
  private reconnectAttempts = 0;
  private stopped = false;
  private starting = false;

  constructor(private readonly opts: WSUserStreamOptions) {}

  async start(): Promise<void> {
    this.stopped = false;
    void this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    if (this.listenKey && this.wsApi?.readyState === WebSocket.OPEN) {
      try {
        await this.callWsApi('userDataStream.stop', {
          apiKey: this.opts.apiKey,
          listenKey: this.listenKey,
        });
      } catch {/* best-effort */}
    }
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('Stream stopping'));
    }
    this.pending.clear();
    try { this.stream?.close(); } catch {}
    try { this.wsApi?.close(); } catch {}
    this.wsApi = undefined;
    this.stream = undefined;
    this.listenKey = undefined;
  }

  private async connect(): Promise<void> {
    if (this.starting || this.stopped) return;
    this.starting = true;
    try {
      // 1. Open WS API connection
      await this.openWsApi();
      // 2. Get listen key
      const r = await this.callWsApi<{ listenKey: string }>(
        'userDataStream.start',
        { apiKey: this.opts.apiKey },
      );
      this.listenKey = r.listenKey;
      log.info('User data listenKey acquired via WS API', { lk: this.listenKey.slice(0, 8) + '…' });

      // 3. Open the actual user stream
      await this.openStream(this.listenKey);

      // 4. Schedule keep-alive
      this.scheduleKeepAlive();

      this.reconnectAttempts = 0;
      this.starting = false;
      this.opts.onConnected?.();
    } catch (err) {
      this.starting = false;
      log.error('WS user stream connect failed', { err: String(err) });
      this.scheduleReconnect();
    }
  }

  private openWsApi(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(WS_API_URL);
      this.wsApi = ws;
      const onOpen = () => { ws.off('error', onErr); resolve(); };
      const onErr = (err: Error) => { ws.off('open', onOpen); reject(err); };
      ws.once('open', onOpen);
      ws.once('error', onErr);

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString()) as WsApiResponse<unknown>;
          const pending = this.pending.get(msg.id);
          if (!pending) return;
          this.pending.delete(msg.id);
          clearTimeout(pending.timer);
          if (msg.error) pending.reject(new Error(`${msg.error.code}: ${msg.error.msg}`));
          else pending.resolve(msg.result);
        } catch (e) {
          log.warn('Bad WS API message', { err: String(e) });
        }
      });

      ws.on('close', () => {
        log.warn('WS API connection closed');
        if (!this.stopped) this.scheduleReconnect();
      });
      ws.on('error', (err) => log.warn('WS API error', { err: String(err) }));
    });
  }

  private openStream(listenKey: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${WS_STREAM_URL}/${listenKey}`;
      const ws = new WebSocket(url);
      this.stream = ws;

      const onOpen = () => {
        log.info('🔌 User-data stream connected (real-time)', { url });
        ws.off('error', onErr);
        resolve();
      };
      const onErr = (err: Error) => { ws.off('open', onOpen); reject(err); };
      ws.once('open', onOpen);
      ws.once('error', onErr);

      ws.on('message', (raw) => {
        try {
          const data = JSON.parse(raw.toString()) as UserDataEvent;
          void this.opts.onEvent(data);
        } catch (e) {
          log.warn('Bad stream message', { err: String(e) });
        }
      });
      ws.on('error', (err) => log.warn('User stream error', { err: String(err) }));
      ws.on('close', () => {
        log.warn('User stream closed');
        this.opts.onDisconnected?.();
        if (!this.stopped) this.scheduleReconnect();
      });
    });
  }

  private callWsApi<T = unknown>(method: string, params: Record<string, unknown>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const ws = this.wsApi;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return reject(new Error('WS API not connected'));
      }
      const id = randomUUID();
      const payload = JSON.stringify({ id, method, params });
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`WS API timeout: ${method}`));
      }, 10_000);
      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
        timer,
      });
      ws.send(payload);
    });
  }

  private scheduleKeepAlive(): void {
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = setInterval(() => {
      if (!this.listenKey || !this.wsApi) return;
      this.callWsApi('userDataStream.ping', {
        apiKey: this.opts.apiKey,
        listenKey: this.listenKey,
      }).catch((err) => log.warn('Keep-alive ping failed', { err: String(err) }));
    }, KEEPALIVE_MS);
    if (this.keepAliveTimer.unref) this.keepAliveTimer.unref();
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    if (this.starting) return;
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = undefined;
    }
    try { this.stream?.close(); } catch {}
    try { this.wsApi?.close(); } catch {}
    this.stream = undefined;
    this.wsApi = undefined;
    this.reconnectAttempts += 1;
    const delay = Math.min(30_000, 500 * 2 ** this.reconnectAttempts);
    log.info('Scheduling reconnect', { attempt: this.reconnectAttempts, delayMs: delay });
    setTimeout(() => void this.connect(), delay);
  }
}
