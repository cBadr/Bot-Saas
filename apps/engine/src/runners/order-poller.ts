import { prisma } from '@orca/db';
import type { BinanceClient, UserDataEvent } from '@orca/exchange';
import type { OrcaLogger } from '@orca/logger';

/**
 * Polls open orders + recent fills as a fallback for user-data-stream
 * (Binance deprecated /api/v3/userDataStream → HTTP 410). Detects when
 * orders we placed have transitioned to FILLED/CANCELED/etc and emits
 * synthetic executionReport events to the same handler the WS would use.
 */
export class OrderPoller {
  private timer?: NodeJS.Timeout;
  private stopped = false;
  /** Map of clientOrderId → last seen status, so we only emit on transitions. */
  private lastStatus = new Map<string, string>();

  constructor(
    private readonly botId: string,
    private readonly symbol: string,
    private readonly client: BinanceClient,
    private readonly logger: OrcaLogger,
    private readonly onEvent: (event: UserDataEvent) => void | Promise<void>,
    private readonly intervalMs: number = 4000,
  ) {}

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => {
      this.poll().catch((err) =>
        this.logger.warn('Order poll failed', { err: err instanceof Error ? err.message : String(err) }),
      );
    }, this.intervalMs);
    if (this.timer.unref) this.timer.unref();
    // Trigger an immediate poll
    void this.poll();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async poll(): Promise<void> {
    if (this.stopped) return;

    // 1) Get current open orders from Binance
    let openOrders: Array<{
      clientOrderId: string; orderId: number; status: string; symbol: string;
      side: 'BUY' | 'SELL'; price: string; origQty: string; executedQty: string;
      type?: string; time?: number;
    }> = [];
    try {
      openOrders = (await this.client.getOpenOrders(this.symbol)) as never;
    } catch (err) {
      this.logger.warn('getOpenOrders failed in poller', { err: String(err) });
      return;
    }

    // 2) Persist any open Binance orders that aren't yet in our DB (placed but
    //    we never saw a fill event for them — so no DB row exists yet).
    for (const o of openOrders) {
      if (!o.clientOrderId.startsWith('orca-')) continue; // only ours
      const existing = await prisma.order.findUnique({ where: { clientOrderId: o.clientOrderId } });
      if (!existing) {
        await prisma.order.create({
          data: {
            botId: this.botId,
            clientOrderId: o.clientOrderId,
            exchangeOrderId: String(o.orderId),
            symbol: o.symbol,
            side: o.side,
            type: 'LIMIT',
            status: 'NEW',
            price: o.price,
            quantity: o.origQty,
            filledQuantity: o.executedQty,
            cumulativeQuote: '0',
          },
        });
        this.logger.debug('Persisted open order from Binance', { clientOrderId: o.clientOrderId });
      }
    }

    // 3) Get all our DB orders that aren't terminal yet
    const trackedOrders = await prisma.order.findMany({
      where: {
        botId: this.botId,
        status: { in: ['NEW', 'PARTIALLY_FILLED', 'PENDING_CANCEL'] },
      },
      select: { clientOrderId: true, exchangeOrderId: true, symbol: true, status: true, side: true, price: true, quantity: true },
    });
    if (trackedOrders.length === 0) return;

    const openSet = new Set(openOrders.map((o) => o.clientOrderId));

    // 4) For each tracked order not in open list → query its final status
    for (const dbOrder of trackedOrders) {
      if (openSet.has(dbOrder.clientOrderId)) {
        // still open — skip
        continue;
      }
      try {
        const remote = await this.client.getOrder({
          symbol: dbOrder.symbol,
          origClientOrderId: dbOrder.clientOrderId,
        });
        const lastSeen = this.lastStatus.get(dbOrder.clientOrderId);
        if (lastSeen === remote.status) continue;
        this.lastStatus.set(dbOrder.clientOrderId, remote.status);

        // Synthesize an executionReport-like event
        const event: UserDataEvent = {
          e: 'executionReport',
          s: remote.symbol,
          c: remote.clientOrderId,
          i: remote.orderId,
          S: remote.side,
          X: remote.status,
          p: remote.price,
          q: remote.origQty,
          z: remote.executedQty,
          Z: remote.cummulativeQuoteQty,
          L: remote.price,
          l: remote.executedQty,
          t: remote.status === 'FILLED' ? Date.now() : 0,
          n: '0',
          N: null,
          m: true,
          T: remote.transactTime ?? Date.now(),
        };
        this.logger.info('Poller detected order transition', {
          clientOrderId: remote.clientOrderId,
          from: lastSeen ?? dbOrder.status,
          to: remote.status,
        });
        await this.onEvent(event);
      } catch (err) {
        this.logger.warn('getOrder failed in poller', {
          clientOrderId: dbOrder.clientOrderId,
          err: String(err),
        });
      }
    }
  }
}
