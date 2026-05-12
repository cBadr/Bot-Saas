import { prisma } from '@orca/db';
import {
  BinanceClient,
  BinanceRateLimiter,
  UserDataStream,
  WebSocketUserStream,
  createBinanceClient,
  createPublicBinanceClient,
  extractFilters,
  type SymbolFilters,
} from '@orca/exchange';
import { createLogger, type OrcaLogger } from '@orca/logger';
import { getStrategy, type Strategy } from '@orca/strategies';
import { decryptSecret } from '@orca/shared';
import { env } from '@orca/config';
import type Redis from 'ioredis';
import { buildStrategyContext } from './strategy-context';
import { ENGINE_EVENT_CHANNEL, type EngineEvent } from '../bridge/channels';
import { PaperBinanceClient } from './paper-client';
import { updateBotStats } from './bot-stats';
import { OrderPoller } from './order-poller';

const encSecret = env.ENCRYPTION_SECRET ?? env.AUTH_SECRET;

/**
 * BotRunner owns the lifecycle of a single bot:
 *  - Loads bot + apiKey + strategy from DB
 *  - Connects Binance UserDataStream
 *  - Calls strategy.init()
 *  - Translates execution reports → strategy.onOrderUpdate()
 *  - Periodic tick → strategy.onTick(lastPrice)
 *  - Persists orders + status changes
 *  - Catches errors → marks bot as ERROR
 */
export class BotRunner {
  private readonly logger: OrcaLogger;
  private client?: BinanceClient | PaperBinanceClient;
  private userStream?: UserDataStream;
  private wsUserStream?: WebSocketUserStream;
  private orderPoller?: OrderPoller;
  private paperClient?: PaperBinanceClient;
  private filters?: SymbolFilters;
  private strategy?: Strategy<unknown>;
  private params: unknown;
  private tickTimer?: NodeJS.Timeout;
  private stopped = false;
  private isPaper = false;
  /** The BotRun row this runner is associated with. Created at start, closed at stop. */
  private currentRunId?: string;

  constructor(
    public readonly botId: string,
    private readonly redis: Redis,
    private readonly rateLimiter: BinanceRateLimiter,
  ) {
    this.logger = createLogger('BOT', { botId });
  }

  async start(): Promise<void> {
    this.logger.info('Starting bot');
    const bot = await prisma.bot.findUnique({
      where: { id: this.botId },
      include: { apiKey: true, strategy: true },
    });
    if (!bot) throw new Error(`Bot ${this.botId} not found`);
    if (!bot.apiKey || bot.apiKey.status !== 'ACTIVE') {
      throw new Error(`Bot ${this.botId} has no active API key`);
    }
    // Resolve engine: built-in key first, then definition.engine for custom strategies.
    const engineKey = bot.strategy.builtinKey
      ?? ((bot.strategy.definition as Record<string, unknown> | null)?.engine as string | undefined)
      ?? 'graph_v1';
    const strategy = getStrategy(engineKey);
    if (!strategy) throw new Error(`Strategy engine ${engineKey} not registered`);

    this.strategy = strategy;
    this.params = strategy.validateParams(bot.params);
    this.isPaper = bot.paperTrading === true;

    // Build credentials + client (or paper simulator)
    if (this.isPaper) {
      this.paperClient = new PaperBinanceClient();
      this.client = this.paperClient;
      this.logger.info('Bot running in PAPER TRADING mode (no real orders)');
    } else {
      this.client = createBinanceClient(
        {
          apiKeyId: bot.apiKey.id,
          apiKey: safeDecrypt(bot.apiKey.apiKey),
          apiSecret: safeDecrypt(bot.apiKey.apiSecret),
        },
        this.rateLimiter,
      );
    }

    // Resolve symbol filters (from cache or fetch)
    const cached = await prisma.exchangeSymbol.findUnique({
      where: { exchange_symbol: { exchange: 'BINANCE', symbol: bot.symbol } },
    });
    if (cached) {
      this.filters = {
        symbol: cached.symbol,
        baseAsset: cached.baseAsset,
        quoteAsset: cached.quoteAsset,
        baseAssetPrecision: cached.baseAssetPrecision,
        quoteAssetPrecision: cached.quoteAssetPrecision,
        tickSize: cached.tickSize.toString(),
        stepSize: cached.stepSize.toString(),
        minQty: cached.minQty.toString(),
        maxQty: cached.maxQty.toString(),
        minNotional: cached.minNotional.toString(),
      };
    } else {
      const pub = createPublicBinanceClient();
      const ex = await pub.getExchangeInfo([bot.symbol]);
      if (!ex.symbols.length) throw new Error(`Symbol ${bot.symbol} not found`);
      this.filters = extractFilters(ex.symbols[0]!);
    }

    // Create / resume the BotRun row.
    //   - If Bot.currentRunId is set and RUNNING, reuse it (resume after crash).
    //   - Otherwise, create a new run with paramsSnapshot frozen at this moment.
    this.currentRunId = await this.ensureBotRun(bot.id, bot.params, bot.currentRunId);

    // Update DB → RUNNING
    await prisma.bot.update({
      where: { id: this.botId },
      data: {
        status: 'RUNNING', startedAt: new Date(), lastError: null,
        workerId: process.pid.toString(),
        currentRunId: this.currentRunId,
      },
    });
    await this.publishStatus('RUNNING', this.isPaper ? 'Paper bot started' : 'Bot started');

    // Connect to event stream:
    //  • Paper mode: in-memory emitter from the simulator
    //  • Live mode: real-time Binance WebSocket API (primary) + OrderPoller (safety net)
    if (this.isPaper && this.paperClient) {
      this.paperClient.userStreamEmitter.on('event', (e) => void this.handleUserDataEvent(e));
      this.paperClient.startMarketPolling([bot.symbol], 3000);
    } else {
      // ⚡ Real-time WebSocket via Binance WS API (replaces deprecated REST endpoint)
      this.wsUserStream = new WebSocketUserStream({
        apiKey: safeDecrypt(bot.apiKey.apiKey),
        onEvent: (e) => this.handleUserDataEvent(e),
        onConnected: () => this.logger.info('Real-time user stream connected'),
        onDisconnected: () => this.logger.warn('Real-time user stream disconnected, will reconnect'),
      });
      void this.wsUserStream.start();

      // Belt-and-suspenders: OrderPoller every 30s catches anything WS may miss
      // (e.g., during reconnection windows). Higher interval since WS is primary.
      this.orderPoller = new OrderPoller(
        this.botId,
        bot.symbol,
        this.client as BinanceClient,
        this.logger,
        (e) => this.handleUserDataEvent(e),
        30_000,
      );
      this.orderPoller.start();
    }

    // Initialize the strategy (places initial orders)
    const ctx = buildStrategyContext({
      botId: this.botId,
      botRunId: this.currentRunId,
      symbol: bot.symbol,
      filters: this.filters!,
      client: this.client as BinanceClient,
      logger: this.logger,
      redis: this.redis,
    });
    await this.strategy.init(ctx, this.params);

    // Start periodic tick (every 5s by default)
    this.tickTimer = setInterval(() => {
      this.tick().catch((err) =>
        this.logger.error('Tick error', { err: err instanceof Error ? err.message : String(err) }),
      );
    }, 5000);
    if (this.tickTimer.unref) this.tickTimer.unref();
  }

  async stop(reason = 'Manual stop'): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.logger.info('Stopping bot', { reason });
    if (this.tickTimer) clearInterval(this.tickTimer);
    try {
      if (this.strategy && this.client && this.filters) {
        const ctx = buildStrategyContext({
          botId: this.botId,
          botRunId: this.currentRunId,
          symbol: (await prisma.bot.findUnique({ where: { id: this.botId } }))!.symbol,
          filters: this.filters,
          client: this.client as BinanceClient,
          logger: this.logger,
          redis: this.redis,
        });
        await this.strategy.stop(ctx, this.params);
      }
    } catch (err) {
      this.logger.warn('Error during strategy.stop', { err: String(err) });
    }
    try { await this.userStream?.stop(); } catch {}
    try { await this.wsUserStream?.stop(); } catch {}
    try { this.orderPoller?.stop(); } catch {}
    try { this.paperClient?.stop(); } catch {}
    await this.closeRun('STOPPED', reason);
    await prisma.bot.update({
      where: { id: this.botId },
      data: { status: 'STOPPED', stoppedAt: new Date(), currentRunId: null },
    });
    await this.publishStatus('STOPPED', reason);
  }

  async fail(err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    this.logger.error('Bot failed', { err: message });
    if (this.tickTimer) clearInterval(this.tickTimer);
    try { await this.userStream?.stop(); } catch {}
    try { await this.wsUserStream?.stop(); } catch {}
    try { this.orderPoller?.stop(); } catch {}
    await this.closeRun('ERROR', message);
    await prisma.bot.update({
      where: { id: this.botId },
      data: {
        status: 'ERROR',
        stoppedAt: new Date(),
        lastErrorAt: new Date(),
        lastError: message,
        currentRunId: null,
      },
    });
    await this.publishStatus('ERROR', message);
  }

  /**
   * Resume an existing RUNNING BotRun if present (engine restart case),
   * otherwise create a new run #N with frozen paramsSnapshot.
   */
  private async ensureBotRun(botId: string, params: unknown, currentRunId: string | null): Promise<string> {
    if (currentRunId) {
      const existing = await prisma.botRun.findUnique({ where: { id: currentRunId } });
      if (existing && existing.status === 'RUNNING') {
        return existing.id;
      }
    }
    // Determine next run number for this bot.
    const last = await prisma.botRun.findFirst({
      where: { botId },
      orderBy: { runNumber: 'desc' },
      select: { runNumber: true },
    });
    const runNumber = (last?.runNumber ?? 0) + 1;
    const run = await prisma.botRun.create({
      data: {
        botId,
        runNumber,
        paramsSnapshot: params as object,
        status: 'RUNNING',
      },
    });
    this.logger.info('BotRun started', { runId: run.id, runNumber });
    return run.id;
  }

  /**
   * Close the active BotRun with final stats. Also bumps the parent Bot's
   * lifetime aggregates. Idempotent — safe to call twice (no-op if already stopped).
   */
  private async closeRun(
    finalStatus: 'STOPPED' | 'ERROR',
    reason: string,
  ): Promise<void> {
    if (!this.currentRunId) return;
    const runId = this.currentRunId;
    try {
      const run = await prisma.botRun.findUnique({ where: { id: runId } });
      if (!run || run.status !== 'RUNNING') return;

      // Snapshot stats for this run from trades + events scoped to it.
      const [tradeAgg, eventCycles, botState] = await Promise.all([
        prisma.trade.aggregate({
          where: { botRunId: runId },
          _sum: { quoteQuantity: true, commission: true },
          _count: true,
        }),
        prisma.botEvent.count({
          where: { botRunId: runId, type: { in: ['BUY_FILLED', 'SELL_FILLED', 'DCA_BUY_FILLED', 'DCA_SELL_FILLED'] }, data: { path: ['cycleClosed'], equals: true } as never },
        }),
        prisma.bot.findUnique({ where: { id: this.botId }, select: { realizedPnlQuote: true, state: true } }),
      ]);

      const stateObj = (botState?.state ?? null) as null | { realizedPnlQuote?: string; cyclesCompleted?: number; initialStartPrice?: string };
      const stateRealized = stateObj?.realizedPnlQuote ? Number(stateObj.realizedPnlQuote) : Number(botState?.realizedPnlQuote ?? 0);
      const cycles = stateObj?.cyclesCompleted ?? eventCycles;
      const startPrice = stateObj?.initialStartPrice ? Number(stateObj.initialStartPrice) : null;
      const fees = Number(tradeAgg._sum.commission ?? 0);
      const volume = Number(tradeAgg._sum.quoteQuantity ?? 0);
      const durationMs = BigInt(Date.now() - run.startedAt.getTime());

      await prisma.$transaction([
        prisma.botRun.update({
          where: { id: runId },
          data: {
            status: finalStatus,
            stoppedAt: new Date(),
            stopReason: reason,
            realizedPnl: stateRealized,
            cyclesCompleted: cycles,
            tradesCount: tradeAgg._count,
            volumeQuote: volume,
            fees,
            durationMs,
            ...(finalStatus === 'ERROR' ? { errorMessage: reason } : {}),
            ...(startPrice !== null ? { initialStartPrice: startPrice } : {}),
          },
        }),
        prisma.bot.update({
          where: { id: this.botId },
          data: {
            totalRuns: { increment: 1 },
            lifetimeRealized: { increment: stateRealized },
            lifetimeCycles: { increment: cycles },
            lifetimeVolume: { increment: volume },
            lifetimeFees: { increment: fees },
          },
        }),
      ]);
      this.logger.info('BotRun closed', { runId, status: finalStatus, realized: stateRealized, cycles });
    } catch (err) {
      this.logger.error('closeRun failed', { err: err instanceof Error ? err.message : String(err) });
    }
  }

  private async handleUserDataEvent(event: { e?: string; [k: string]: unknown }): Promise<void> {
    if (event.e !== 'executionReport') return;

    // Map Binance executionReport fields
    const r = event as Record<string, unknown>;
    const clientOrderId = r.c as string;
    const exchangeOrderId = Number(r.i);
    const symbol = r.s as string;
    const side = r.S as 'BUY' | 'SELL';
    const status = r.X as string;
    const price = String(r.p);
    const origQty = String(r.q);
    const executedQty = String(r.z);
    const cumQuote = String(r.Z);
    const lastPrice = String(r.L);
    const lastQty = String(r.l);
    const tradeId = Number(r.t);
    const commission = String(r.n);
    const commissionAsset = r.N as string | null;
    const isMaker = (r.m as boolean) ?? true;
    const transactTime = Number(r.T);

    // Persist/update order
    try {
      await prisma.order.upsert({
        where: { clientOrderId },
        create: {
          botId: this.botId,
          clientOrderId,
          exchangeOrderId: String(exchangeOrderId),
          symbol,
          side,
          type: 'LIMIT',
          status: mapOrderStatus(status),
          price,
          quantity: origQty,
          filledQuantity: executedQty,
          cumulativeQuote: cumQuote,
          ...(status === 'FILLED' ? { filledAt: new Date(transactTime) } : {}),
          ...(status === 'CANCELED' ? { canceledAt: new Date(transactTime) } : {}),
        },
        update: {
          status: mapOrderStatus(status),
          filledQuantity: executedQty,
          cumulativeQuote: cumQuote,
          ...(status === 'FILLED' ? { filledAt: new Date(transactTime) } : {}),
          ...(status === 'CANCELED' ? { canceledAt: new Date(transactTime) } : {}),
        },
      });

      // Persist trade if there was a fill on this report
      if (Number(lastQty) > 0 && tradeId > 0) {
        const orderRow = await prisma.order.findUnique({ where: { clientOrderId } });
        if (orderRow) {
          await prisma.trade.upsert({
            where: { exchangeTradeId_symbol: { exchangeTradeId: String(tradeId), symbol } },
            create: {
              botId: this.botId,
              ...(this.currentRunId ? { botRunId: this.currentRunId } : {}),
              orderId: orderRow.id,
              exchangeTradeId: String(tradeId),
              symbol,
              side,
              price: lastPrice,
              quantity: lastQty,
              quoteQuantity: String(Number(lastPrice) * Number(lastQty)),
              commission,
              commissionAsset,
              isMaker,
              executedAt: new Date(transactTime),
            },
            update: {},
          });
          // Recompute aggregate stats now that a new trade exists
          try { await updateBotStats(this.botId); }
          catch (err) { this.logger.warn('updateBotStats failed', { err: String(err) }); }
        }
      }
    } catch (err) {
      this.logger.error('Failed to persist order/trade', { err: String(err) });
    }

    // Forward to strategy
    if (!this.strategy || !this.client || !this.filters) return;
    const ctx = buildStrategyContext({
      botId: this.botId,
      botRunId: this.currentRunId,
      symbol,
      filters: this.filters,
      client: this.client as BinanceClient,
      logger: this.logger,
      redis: this.redis,
    });
    try {
      await this.strategy.onOrderUpdate(ctx, this.params, {
        clientOrderId,
        exchangeOrderId,
        status,
        side,
        price,
        origQty,
        executedQty,
        cumulativeQuote: cumQuote,
        symbol,
      });
    } catch (err) {
      this.logger.error('strategy.onOrderUpdate failed', { err: String(err) });
    }
  }

  private peakPnl = 0;

  private async tick(): Promise<void> {
    if (this.stopped || !this.strategy || !this.client || !this.filters) return;
    const bot = await prisma.bot.findUnique({
      where: { id: this.botId },
      select: { symbol: true, dailyLossLimit: true, maxDrawdownPct: true, realizedPnlQuote: true },
    });
    if (!bot) return;

    // Build ctx early so risk events can flow through ctx.emit() →
    // BotEvent + Redis Pub/Sub → NotificationDispatcher.
    const ctx = buildStrategyContext({
      botId: this.botId,
      botRunId: this.currentRunId,
      symbol: bot.symbol,
      filters: this.filters,
      client: this.client as BinanceClient,
      logger: this.logger,
      redis: this.redis,
    });

    // ─── Risk Management checks ─────────────────────────
    const currentPnl = Number(bot.realizedPnlQuote);
    if (currentPnl > this.peakPnl) this.peakPnl = currentPnl;

    // Daily loss limit
    if (bot.dailyLossLimit) {
      const limit = Number(bot.dailyLossLimit);
      const todayLoss = await this.computeTodayLoss();
      if (todayLoss >= limit) {
        this.logger.warn('Daily loss limit reached, auto-stopping', { todayLoss, limit });
        await ctx.emit(
          'RISK_DAILY_LOSS',
          `Daily loss limit triggered: lost ${todayLoss.toFixed(4)} >= limit ${limit}`,
          { todayLoss, limit },
        );
        await this.stop(`Risk: daily loss ${todayLoss.toFixed(4)} >= ${limit}`);
        return;
      }
    }

    // Max drawdown from peak
    if (bot.maxDrawdownPct && this.peakPnl > 0) {
      const ddPct = ((this.peakPnl - currentPnl) / this.peakPnl) * 100;
      if (ddPct >= Number(bot.maxDrawdownPct)) {
        this.logger.warn('Max drawdown reached, auto-stopping', {
          ddPct, limit: Number(bot.maxDrawdownPct),
        });
        await ctx.emit(
          'RISK_MAX_DRAWDOWN',
          `Drawdown ${ddPct.toFixed(2)}% >= limit ${bot.maxDrawdownPct}%`,
          { ddPct, limit: Number(bot.maxDrawdownPct), peak: this.peakPnl },
        );
        await this.stop(`Risk: drawdown ${ddPct.toFixed(2)}%`);
        return;
      }
    }

    const ticker = await this.client.getTickerPrice(bot.symbol);
    await this.strategy.onTick(ctx, this.params, ticker.price);
  }

  /** Sum of today's realized losses (positive number = loss magnitude). */
  private async computeTodayLoss(): Promise<number> {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const trades = await prisma.trade.findMany({
      where: { botId: this.botId, executedAt: { gte: since } },
      select: { realizedPnl: true },
    });
    let loss = 0;
    for (const t of trades) {
      const pnl = Number(t.realizedPnl ?? 0);
      if (pnl < 0) loss += Math.abs(pnl);
    }
    return loss;
  }

  private async publishStatus(status: string, message?: string): Promise<void> {
    const evt: EngineEvent = { type: 'BOT_STATUS', botId: this.botId, status, message };
    await this.redis.publish(ENGINE_EVENT_CHANNEL, JSON.stringify(evt));
  }
}

function mapOrderStatus(s: string):
  | 'NEW'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCELED'
  | 'PENDING_CANCEL'
  | 'REJECTED'
  | 'EXPIRED'
  | 'EXPIRED_IN_MATCH' {
  const allowed = [
    'NEW',
    'PARTIALLY_FILLED',
    'FILLED',
    'CANCELED',
    'PENDING_CANCEL',
    'REJECTED',
    'EXPIRED',
    'EXPIRED_IN_MATCH',
  ] as const;
  return (allowed as readonly string[]).includes(s) ? (s as (typeof allowed)[number]) : 'NEW';
}

function safeDecrypt(v: string): string {
  try { return decryptSecret(v, encSecret); } catch { return v; }
}
