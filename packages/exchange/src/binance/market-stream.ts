import WebSocket from 'ws';
import { env } from '@orca/config';
import { createLogger } from '@orca/logger';
import { sleep } from '@orca/shared';

const log = createLogger('BINANCE', { module: 'MarketStream' });

export type MarketEventHandler = (stream: string, data: unknown) => void;

/**
 * Combined Binance market stream connection.
 * Subscribes to multiple streams over a single WebSocket connection.
 */
export class MarketStream {
  private ws?: WebSocket;
  private streams = new Set<string>();
  private handlers = new Set<MarketEventHandler>();
  private stopped = false;
  private reconnectAttempts = 0;

  subscribe(stream: string): void {
    this.streams.add(stream);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        method: 'SUBSCRIBE',
        params: [stream],
        id: Date.now(),
      }));
    }
  }

  unsubscribe(stream: string): void {
    this.streams.delete(stream);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        method: 'UNSUBSCRIBE',
        params: [stream],
        id: Date.now(),
      }));
    }
  }

  on(handler: MarketEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.ws?.close();
    this.ws = undefined;
  }

  private async connect(): Promise<void> {
    const initial = Array.from(this.streams).join('/');
    const url = initial
      ? `${env.BINANCE_WS_URL}/stream?streams=${initial}`
      : `${env.BINANCE_WS_URL}/ws`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.on('open', () => {
      log.info('Market stream connected', { streams: this.streams.size });
      this.reconnectAttempts = 0;
    });
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { stream?: string; data?: unknown };
        if (msg.stream && msg.data !== undefined) {
          for (const h of this.handlers) h(msg.stream, msg.data);
        }
      } catch (err) {
        log.warn('Failed to parse market event', { err: String(err) });
      }
    });
    ws.on('error', (err) => log.error('Market stream error', { err: String(err) }));
    ws.on('close', () => {
      log.warn('Market stream closed');
      if (!this.stopped) void this.reconnect();
    });
  }

  private async reconnect(): Promise<void> {
    this.reconnectAttempts += 1;
    const delay = Math.min(30_000, 1000 * 2 ** this.reconnectAttempts);
    await sleep(delay);
    if (!this.stopped) await this.connect();
  }
}
