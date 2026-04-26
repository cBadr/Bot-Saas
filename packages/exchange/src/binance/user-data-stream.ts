import WebSocket from 'ws';
import { env } from '@orca/config';
import { createLogger } from '@orca/logger';
import { sleep } from '@orca/shared';
import type { BinanceClient } from './client';

const log = createLogger('BINANCE', { module: 'UserDataStream' });

export type UserDataEvent =
  | { e: 'executionReport'; [k: string]: unknown }
  | { e: 'outboundAccountPosition'; [k: string]: unknown }
  | { e: 'balanceUpdate'; [k: string]: unknown }
  | { e: 'listStatus'; [k: string]: unknown };

export interface UserDataStreamOptions {
  client: BinanceClient;
  onEvent: (event: UserDataEvent) => void | Promise<void>;
  onError?: (err: unknown) => void;
}

/**
 * Maintains a Binance User Data Stream:
 *  - Creates listenKey
 *  - Connects WebSocket
 *  - Auto-reconnects with backoff
 *  - Sends keepAlive every 30 minutes
 */
export class UserDataStream {
  private ws?: WebSocket;
  private listenKey?: string;
  private keepAliveTimer?: NodeJS.Timeout;
  private stopped = false;
  private reconnectAttempts = 0;

  constructor(private readonly opts: UserDataStreamOptions) {}

  async start(): Promise<void> {
    this.stopped = false;
    // Fire-and-forget connect — we don't want bot startup to block on
    // an indefinite reconnect loop if the first connection fails.
    void this.connect().catch((err) =>
      log.error('Initial user data stream connect failed', { err: String(err) }),
    );
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    if (this.listenKey) {
      try { await this.opts.client.closeListenKey(this.listenKey); } catch {}
    }
    this.ws?.close();
    this.ws = undefined;
    this.listenKey = undefined;
  }

  private async connect(): Promise<void> {
    try {
      this.listenKey = await this.opts.client.createListenKey();
      const url = `${env.BINANCE_WS_URL}/ws/${this.listenKey}`;
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.on('open', () => {
        log.info('User data stream connected');
        this.reconnectAttempts = 0;
        this.scheduleKeepAlive();
      });
      ws.on('message', (raw) => {
        try {
          const data = JSON.parse(raw.toString()) as UserDataEvent;
          void this.opts.onEvent(data);
        } catch (err) {
          log.warn('Failed to parse user data event', { err: String(err) });
        }
      });
      ws.on('error', (err) => {
        log.error('User data stream error', { err: String(err) });
        this.opts.onError?.(err);
      });
      ws.on('close', () => {
        log.warn('User data stream closed');
        if (!this.stopped) void this.reconnect();
      });
    } catch (err) {
      log.error('Failed to start user data stream', { err: String(err) });
      // Schedule reconnect without blocking the caller
      if (!this.stopped) void this.reconnect();
    }
  }

  private async reconnect(): Promise<void> {
    this.reconnectAttempts += 1;
    const delay = Math.min(30_000, 1000 * 2 ** this.reconnectAttempts);
    log.info('Reconnecting user data stream', {
      attempt: this.reconnectAttempts,
      delayMs: delay,
    });
    await sleep(delay);
    if (!this.stopped) await this.connect();
  }

  private scheduleKeepAlive(): void {
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = setInterval(() => {
      if (!this.listenKey) return;
      this.opts.client.keepAliveListenKey(this.listenKey).catch((err) => {
        log.warn('Keep-alive failed', { err: String(err) });
      });
    }, 30 * 60 * 1000);
    if (this.keepAliveTimer.unref) this.keepAliveTimer.unref();
  }
}
