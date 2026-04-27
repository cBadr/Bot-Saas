import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { getStrategy } from '@orca/strategies';
import { createPublicBinanceClient, extractFilters } from '@orca/exchange';
import { createLogger } from '@orca/logger';
import { Decimal } from '@orca/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ENGINE_COMMAND_CHANNEL, type EngineCommand } from './engine-bridge';

const log = createLogger('BOT', { module: 'BotsService' });

interface CreateBotInput {
  name: string;
  strategyId: string;
  apiKeyId: string;
  symbol: string;
  params: Record<string, unknown>;
  riskConfig?: Record<string, unknown>;
  paperTrading?: boolean;
  dailyLossLimit?: number;
  maxDrawdownPct?: number;
}

@Injectable()
export class BotsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly notifications: NotificationsService,
  ) {}

  list(userId: string) {
    return this.prisma.bot.findMany({
      where: { userId },
      include: {
        strategy: { select: { id: true, name: true, type: true, builtinKey: true } },
        apiKey: { select: { id: true, label: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(userId: string, id: string) {
    const bot = await this.findOwned(userId, id, {
      strategy: true,
      apiKey: { select: { id: true, label: true, status: true } },
    });
    return bot;
  }

  async events(userId: string, id: string, limit = 100) {
    await this.findOwned(userId, id);
    return this.prisma.botEvent.findMany({
      where: { botId: id },
      orderBy: { createdAt: 'desc' },
      take: Math.min(500, limit),
    });
  }

  async orders(userId: string, id: string, limit = 100) {
    await this.findOwned(userId, id);
    return this.prisma.order.findMany({
      where: { botId: id },
      orderBy: { placedAt: 'desc' },
      take: Math.min(500, limit),
    });
  }

  /**
   * Live monitoring snapshot for the bot detail page:
   *   - current grid orders (from strategy state.orders, with status)
   *   - integrity summary (open / failed / total)
   *   - latest GRID_INTEGRITY event + when next is due
   *   - cycle stats + recent realized PnL series for the sparkline
   *
   * Designed to be polled at 5-10s intervals from the UI.
   */
  async live(userId: string, id: string) {
    const bot = await this.findOwned(userId, id, {
      strategy: { select: { builtinKey: true, name: true } },
    }) as { id: string; symbol: string; state: unknown; strategy?: { builtinKey?: string | null } };

    const state = (bot.state ?? {}) as {
      initialStartPrice?: string;
      orders?: Array<{
        side: 'BUY' | 'SELL'; price: string; quantity: string; status: string;
        clientOrderId?: string; orderId?: number;
        lastError?: { code?: number; category?: string; msg?: string; ts: number };
      }>;
      unmatchedBuys?: Array<{ price: string; quantity: string }>;
      startedAtMs?: number;
      nextReconcileAtMs?: number;
      processedFills?: string[];
    };

    const orders = state.orders ?? [];
    const breakdown: Record<string, number> = {};
    for (const o of orders) breakdown[o.status] = (breakdown[o.status] ?? 0) + 1;
    const open = breakdown['open'] ?? 0;

    // Latest integrity event
    const integrityEvent = await this.prisma.botEvent.findFirst({
      where: { botId: id, type: { in: ['GRID_INTEGRITY_OK', 'GRID_INTEGRITY_REPAIR'] } },
      orderBy: { createdAt: 'desc' },
    });

    // Recent trades for the PnL sparkline (last 100, oldest→newest)
    const trades = await this.prisma.trade.findMany({
      where: { botId: id, realizedPnl: { not: null } },
      orderBy: { executedAt: 'asc' },
      take: 100,
      select: { realizedPnl: true, executedAt: true, side: true, price: true },
    });

    let cumulative = 0;
    const pnlSeries = trades.map((t) => {
      cumulative += Number(t.realizedPnl ?? 0);
      return { ts: t.executedAt.getTime(), pnl: cumulative };
    });

    const cycles = trades.filter((t) => t.side === 'SELL').length;

    // Live ticker for "where is the market vs our levels"
    let marketPrice: string | null = null;
    try {
      const pub = createPublicBinanceClient();
      const ticker = await pub.getTickerPrice(bot.symbol);
      marketPrice = ticker.price;
    } catch {
      // Non-fatal — UI will still render without it.
    }

    return {
      botId: bot.id,
      symbol: bot.symbol,
      strategyKey: bot.strategy?.builtinKey ?? null,
      initialStartPrice: state.initialStartPrice ?? null,
      marketPrice,
      orders: orders.map((o) => ({
        side: o.side,
        price: o.price,
        quantity: o.quantity,
        status: o.status,
        orderId: o.orderId ?? null,
        clientOrderId: o.clientOrderId ?? null,
        errorCategory: o.lastError?.category ?? null,
        errorMsg: o.lastError?.msg ?? null,
        errorCode: o.lastError?.code ?? null,
      })),
      integrity: {
        total: orders.length,
        open,
        failed: orders.length - open,
        breakdown,
        startedAtMs: state.startedAtMs ?? null,
        nextReconcileAtMs: state.nextReconcileAtMs ?? null,
        latestEvent: integrityEvent ? {
          type: integrityEvent.type,
          message: integrityEvent.message,
          createdAt: integrityEvent.createdAt,
        } : null,
      },
      pnl: {
        cumulative,
        cyclesCompleted: cycles,
        avgPerCycle: cycles > 0 ? cumulative / cycles : 0,
        series: pnlSeries,
        unmatchedBuys: state.unmatchedBuys?.length ?? 0,
      },
    };
  }

  async create(userId: string, dto: CreateBotInput) {
    const [strategy, apiKey] = await Promise.all([
      this.prisma.strategy.findUnique({ where: { id: dto.strategyId } }),
      this.prisma.exchangeApiKey.findUnique({ where: { id: dto.apiKeyId } }),
    ]);
    if (!strategy) throw new NotFoundException('Strategy not found');
    if (strategy.visibility === 'PRIVATE' && strategy.ownerId !== userId) {
      throw new ForbiddenException('Strategy not accessible');
    }
    if (!apiKey || apiKey.userId !== userId) throw new NotFoundException('API key not found');

    // Determine the engine key: built-in or custom (graph_v1 default for CUSTOM type).
    const engineKey = strategy.builtinKey
      ?? ((strategy.definition as Record<string, unknown> | null)?.engine as string | undefined)
      ?? 'graph_v1';

    // For graph_v1 strategies, merge the saved graph into params so the engine
    // can interpret it without re-fetching the strategy.
    let runtimeParams: Record<string, unknown> = { ...dto.params };
    if (engineKey === 'graph_v1') {
      const def = (strategy.definition ?? {}) as Record<string, unknown>;
      if (def.nodes && def.edges) {
        runtimeParams.graph = { nodes: def.nodes, edges: def.edges };
      }
    }

    // Validate via the registered strategy implementation.
    const impl = getStrategy(engineKey);
    if (impl) impl.validateParams(runtimeParams);

    // Resolve symbol metadata
    const symbol = dto.symbol.toUpperCase();
    const pub = createPublicBinanceClient();
    const ex = await pub.getExchangeInfo([symbol]);
    if (!ex.symbols.length) {
      throw new NotFoundException(`Symbol ${symbol} not found on Binance`);
    }
    const filters = extractFilters(ex.symbols[0]!);

    // Cache symbol info
    await this.prisma.exchangeSymbol.upsert({
      where: { exchange_symbol: { exchange: 'BINANCE', symbol } },
      create: {
        exchange: 'BINANCE',
        symbol,
        baseAsset: filters.baseAsset,
        quoteAsset: filters.quoteAsset,
        status: 'TRADING',
        baseAssetPrecision: filters.baseAssetPrecision,
        quoteAssetPrecision: filters.quoteAssetPrecision,
        tickSize: filters.tickSize,
        stepSize: filters.stepSize,
        minNotional: filters.minNotional,
        minQty: filters.minQty,
        maxQty: filters.maxQty,
        rawFilters: ex.symbols[0]!.filters as object,
      },
      update: {
        tickSize: filters.tickSize,
        stepSize: filters.stepSize,
        minNotional: filters.minNotional,
        minQty: filters.minQty,
        maxQty: filters.maxQty,
        rawFilters: ex.symbols[0]!.filters as object,
      },
    });

    const bot = await this.prisma.bot.create({
      data: {
        userId,
        apiKeyId: dto.apiKeyId,
        strategyId: dto.strategyId,
        name: dto.name,
        symbol,
        baseAsset: filters.baseAsset,
        quoteAsset: filters.quoteAsset,
        params: runtimeParams as object,
        ...(dto.riskConfig ? { riskConfig: dto.riskConfig as object } : {}),
        ...(dto.dailyLossLimit !== undefined ? { dailyLossLimit: String(dto.dailyLossLimit) } : {}),
        ...(dto.maxDrawdownPct !== undefined ? { maxDrawdownPct: String(dto.maxDrawdownPct) } : {}),
        paperTrading: dto.paperTrading ?? false,
        status: 'CREATED',
      },
    });
    log.info('Bot created', { userId, botId: bot.id, symbol });
    return bot;
  }

  async start(userId: string, id: string) {
    const bot = await this.findOwned(userId, id);
    if (bot.status === 'RUNNING' || bot.status === 'STARTING') return bot;
    await this.prisma.bot.update({ where: { id }, data: { status: 'STARTING' } });
    await this.publishCommand({ type: 'START', botId: id });
    void this.notifications.notify(userId, 'BOT_STARTED', `Bot "${bot.name}" started on ${bot.symbol}.`, { botId: id });
    return { ...bot, status: 'STARTING' as const };
  }

  async stop(userId: string, id: string) {
    const bot = await this.findOwned(userId, id);
    if (bot.status === 'STOPPED' || bot.status === 'STOPPING') return bot;
    await this.prisma.bot.update({ where: { id }, data: { status: 'STOPPING' } });
    await this.publishCommand({ type: 'STOP', botId: id });
    void this.notifications.notify(userId, 'BOT_STOPPED', `Bot "${bot.name}" stopped.`, { botId: id });
    return { ...bot, status: 'STOPPING' as const };
  }

  async remove(userId: string, id: string) {
    const bot = await this.findOwned(userId, id);
    if (bot.status === 'RUNNING' || bot.status === 'STARTING') {
      throw new ForbiddenException('Stop the bot before deleting');
    }
    await this.prisma.bot.delete({ where: { id } });
    return { success: true };
  }

  /** Emergency stop: stops ALL of a user's bots immediately. */
  async emergencyStopAll(userId: string) {
    const running = await this.prisma.bot.findMany({
      where: { userId, status: { in: ['RUNNING', 'STARTING', 'PAUSED'] } },
      select: { id: true, name: true },
    });
    await this.prisma.bot.updateMany({
      where: { id: { in: running.map((b) => b.id) } },
      data: { status: 'STOPPING' },
    });
    // Tell engine to halt them all
    await this.publishCommand({ type: 'EMERGENCY_STOP_USER', userId });
    void this.notifications.notify(
      userId,
      'BOT_STOPPED',
      `🛑 Kill switch activated — stopping ${running.length} bot(s)`,
      { kill_switch: true, count: running.length },
    );
    return { stopped: running.length, bots: running };
  }

  /** Update risk config (daily loss limit, max drawdown %) on a single bot. */
  async updateRiskConfig(
    userId: string,
    id: string,
    dto: { dailyLossLimit?: number | null; maxDrawdownPct?: number | null },
  ) {
    await this.findOwned(userId, id);
    return this.prisma.bot.update({
      where: { id },
      data: {
        dailyLossLimit:
          dto.dailyLossLimit === null ? null
          : dto.dailyLossLimit !== undefined ? String(dto.dailyLossLimit)
          : undefined,
        maxDrawdownPct:
          dto.maxDrawdownPct === null ? null
          : dto.maxDrawdownPct !== undefined ? String(dto.maxDrawdownPct)
          : undefined,
      },
      select: { id: true, dailyLossLimit: true, maxDrawdownPct: true },
    });
  }

  /** Recompute aggregate stats for a single bot from its Trade history. */
  async recomputeStats(userId: string, id: string) {
    await this.findOwned(userId, id);
    return this.recompute(id);
  }

  /** Recompute stats for ALL bots owned by a user. */
  async recomputeAllForUser(userId: string) {
    const bots = await this.prisma.bot.findMany({ where: { userId }, select: { id: true } });
    for (const b of bots) await this.recompute(b.id);
    return { updated: bots.length };
  }

  /** Internal: weighted-average cost stats computation. */
  private async recompute(botId: string) {
    const trades = await this.prisma.trade.findMany({
      where: { botId },
      orderBy: { executedAt: 'asc' },
    });

    let baseHeld = new Decimal(0);
    let avgCost = new Decimal(0);
    let realized = new Decimal(0);
    let volume = new Decimal(0);
    const updates: { id: string; pnl: string }[] = [];

    for (const t of trades) {
      const qty = new Decimal(t.quantity.toString());
      const price = new Decimal(t.price.toString());
      const quote = new Decimal(t.quoteQuantity.toString());
      volume = volume.plus(quote);

      if (t.side === 'BUY') {
        const newHeld = baseHeld.plus(qty);
        avgCost = newHeld.gt(0)
          ? baseHeld.mul(avgCost).plus(qty.mul(price)).div(newHeld)
          : price;
        baseHeld = newHeld;
        updates.push({ id: t.id, pnl: '0' });
      } else {
        const pnl = price.minus(avgCost).mul(qty);
        realized = realized.plus(pnl);
        baseHeld = baseHeld.minus(qty);
        updates.push({ id: t.id, pnl: pnl.toFixed(18) });
      }
    }

    if (updates.length > 0) {
      await this.prisma.$transaction(
        updates.map((u) =>
          this.prisma.trade.update({
            where: { id: u.id },
            data: { realizedPnl: u.pnl },
          }),
        ),
      );
    }

    const updated = await this.prisma.bot.update({
      where: { id: botId },
      data: {
        totalTrades: trades.length,
        totalVolumeQuote: volume.toFixed(18),
        realizedPnlQuote: realized.toFixed(18),
      },
      select: {
        id: true, totalTrades: true, totalVolumeQuote: true, realizedPnlQuote: true,
      },
    });
    return updated;
  }

  private async findOwned(userId: string, id: string, include?: object) {
    const bot = await this.prisma.bot.findUnique({ where: { id }, include: include as never });
    if (!bot) throw new NotFoundException('Bot not found');
    if (bot.userId !== userId) throw new ForbiddenException();
    return bot;
  }

  private async publishCommand(cmd: EngineCommand) {
    await this.redis.publisher.publish(ENGINE_COMMAND_CHANNEL, JSON.stringify(cmd));
  }
}
