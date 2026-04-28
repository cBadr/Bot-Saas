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

  async list(userId: string) {
    const bots = await this.prisma.bot.findMany({
      where: { userId },
      include: {
        strategy: { select: { id: true, name: true, type: true, builtinKey: true } },
        apiKey: { select: { id: true, label: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // ─── Enrich each bot with derived live stats (cycles, realized,
    //     unrealized, total profits, grid params summary) so the list
    //     page can render rich rows without N round-trips. ──────────
    //
    // We bulk-fetch ALL ticker prices in one Binance call so per-bot
    // unrealized calculation costs nothing extra.
    const symbols = [...new Set(bots.map((b) => b.symbol))];
    const priceMap = await this.bulkTickerPrices(symbols);

    return bots.map((b) => {
      const state = (b.state ?? {}) as {
        initialStartPrice?: string;
        // Grid Simple
        unmatched?: Array<{ side: 'BUY' | 'SELL'; price: string; quantity: string }>;
        unmatchedBuys?: Array<{ price: string; quantity: string }>;
        // DCA
        heldBase?: string;
        // Common
        realizedPnlQuote?: string;
        cyclesCompleted?: number;
      };
      const params = (b.params ?? {}) as Record<string, unknown>;
      const builtinKey = b.strategy?.builtinKey ?? null;
      const isAnyDca = builtinKey === 'dca_v1' || builtinKey === 'dca_simple';
      const dcaDirection = (params.direction === 'SELL' ? 'SELL' : 'BUY');

      // ─── Compute signed held inventory for unrealized math ───
      let heldQty = 0;
      let signedHeld = 0;
      if (isAnyDca) {
        const dh = Number(state.heldBase ?? 0);
        heldQty = dh;
        signedHeld = dcaDirection === 'BUY' ? +dh : -dh;
      } else {
        const unmatched = state.unmatched
          ?? (state.unmatchedBuys?.map((u) => ({ side: 'BUY' as const, price: u.price, quantity: u.quantity })) ?? []);
        const buyQty = unmatched.filter((u) => u.side === 'BUY').reduce((s, u) => s + Number(u.quantity), 0);
        const sellQty = unmatched.filter((u) => u.side === 'SELL').reduce((s, u) => s + Number(u.quantity), 0);
        heldQty = buyQty;
        signedHeld = buyQty - sellQty;
      }

      const startNum = Number(state.initialStartPrice ?? 0);
      const marketNum = Number(priceMap.get(b.symbol) ?? 0);
      const realized = Number(state.realizedPnlQuote ?? 0);
      const unrealized = (startNum > 0 && marketNum > 0 && signedHeld !== 0)
        ? (marketNum - startNum) * signedHeld
        : 0;
      const total = realized + unrealized;
      const cycles = state.cyclesCompleted ?? 0;

      // Strategy-specific params readout
      const gridLevels = num(params.gridLevels);
      const gridSpread = num(params.gridSpread);
      const orderSize = num(params.orderSize);
      const totalInvestment = (gridLevels !== null && orderSize !== null)
        ? gridLevels * orderSize
        : num(params.totalQuoteInvestment);
      // Expected per-cycle profit:
      //   Grid:  spread × (orderSize / startPrice)
      //   DCA:   not well-defined (depends on TP%); skip
      const expectedPerCycle = (gridSpread !== null && orderSize !== null && startNum > 0)
        ? gridSpread * (orderSize / startNum)
        : null;

      return {
        ...b,
        marketPrice: marketNum > 0 ? marketNum.toString() : null,
        liveStats: {
          gridLevels, gridSpread, orderSize, totalInvestment, expectedPerCycle,
          cyclesCompleted: cycles,
          realized,
          unrealized,
          total,
          heldQty,
          startPrice: startNum > 0 ? startNum : null,
        },
      };
    });
  }

  /**
   * Single Binance call to fetch all ticker prices, indexed by symbol.
   * Returns an empty Map on any error (UI handles missing prices gracefully).
   */
  private async bulkTickerPrices(symbols: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (symbols.length === 0) return map;
    try {
      const pub = createPublicBinanceClient();
      // Fetch ALL prices in a single call — much cheaper than per-symbol.
      const { request } = await import('undici');
      const r = await request(`https://api.binance.com/api/v3/ticker/price`);
      if (r.statusCode === 200) {
        const data = (await r.body.json()) as Array<{ symbol: string; price: string }>;
        for (const d of data) map.set(d.symbol, d.price);
      } else {
        // Fallback: one-by-one
        for (const s of symbols) {
          try {
            const t = await pub.getTickerPrice(s);
            map.set(s, t.price);
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      log.warn('bulkTickerPrices failed', { err: String(err) });
    }
    return map;
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
    }) as { id: string; symbol: string; state: unknown; params: unknown; strategy?: { builtinKey?: string | null } };

    type StateOrder = {
      side: 'BUY' | 'SELL'; price: string; quantity: string; status: string;
      clientOrderId?: string; orderId?: number;
      lastError?: { code?: number; category?: string; msg?: string; ts: number };
    };
    const state = (bot.state ?? {}) as {
      initialStartPrice?: string;
      // ─ Grid Simple shape ─
      orders?: StateOrder[];
      unmatched?: Array<{ side: 'BUY' | 'SELL'; price: string; quantity: string }>;
      unmatchedBuys?: Array<{ price: string; quantity: string }>;  // legacy
      // ─ DCA Simple shape ─
      ladder?: StateOrder[];
      counter?: { side: 'BUY' | 'SELL'; price: string; quantity: string; status: string;
                  clientOrderId?: string; orderId?: number; type?: string } | null;
      // ─ DCA (legacy + simple) shape ─
      heldBase?: string;
      avgPrice?: string;
      ordersExecuted?: number;
      // ─ Common ─
      realizedPnlQuote?: string;
      cyclesCompleted?: number;
      startedAtMs?: number;
      nextReconcileAtMs?: number;
      processedFills?: string[];
    };

    const strategyKey = bot.strategy?.builtinKey ?? null;
    const isDCA = strategyKey === 'dca_v1';
    const isDcaSimple = strategyKey === 'dca_simple';
    const isAnyDca = isDCA || isDcaSimple;
    const params = (bot.params ?? {}) as Record<string, unknown>;
    const dcaDirection = (params.direction === 'SELL' ? 'SELL' : 'BUY') as 'BUY' | 'SELL';

    // For DCA Simple, expose ladder + counter as a unified `orders` array so
    // the LiveTradingChart can overlay them just like Grid Simple does.
    let orders: StateOrder[];
    if (isDcaSimple) {
      orders = [...(state.ladder ?? [])];
      if (state.counter) {
        orders.push({
          side: state.counter.side,
          price: state.counter.price,
          quantity: state.counter.quantity,
          status: state.counter.status,
          clientOrderId: state.counter.clientOrderId,
          orderId: state.counter.orderId,
        });
      }
    } else {
      orders = state.orders ?? [];
    }
    const breakdown: Record<string, number> = {};
    for (const o of orders) breakdown[o.status] = (breakdown[o.status] ?? 0) + 1;
    const open = breakdown['open'] ?? 0;

    // Latest integrity event
    const integrityEvent = await this.prisma.botEvent.findFirst({
      where: { botId: id, type: { in: ['GRID_INTEGRITY_OK', 'GRID_INTEGRITY_REPAIR', 'DCA_INTEGRITY_OK', 'DCA_INTEGRITY_REPAIR'] } },
      orderBy: { createdAt: 'desc' },
    });

    // ─── Inventory exposure (signed for unrealized math) ───
    let heldQty = 0;
    let soldQty = 0;
    let signedHeld = 0;

    if (isAnyDca) {
      // DCA (both legacy + simple) store a single positive heldBase; sign comes from direction.
      const dh = Number(state.heldBase ?? 0);
      if (dcaDirection === 'BUY') {
        heldQty = dh;
        signedHeld = +dh;
      } else {
        soldQty = dh;
        signedHeld = -dh;
      }
    } else {
      // Grid Simple: derive from unmatched array (with legacy fallback).
      const unmatched = state.unmatched
        ?? (state.unmatchedBuys?.map((b) => ({
          side: 'BUY' as const, price: b.price, quantity: b.quantity,
        })) ?? []);
      heldQty = unmatched.filter((u) => u.side === 'BUY').reduce((s, u) => s + Number(u.quantity), 0);
      soldQty = unmatched.filter((u) => u.side === 'SELL').reduce((s, u) => s + Number(u.quantity), 0);
      signedHeld = heldQty - soldQty;
    }

    // ─── P&L per project spec (see memory: PnL definitions) ───
    const realized = Number(state.realizedPnlQuote ?? 0);
    const cycles = state.cyclesCompleted ?? 0;

    // Live ticker for "where is the market vs our levels" + Unrealized basis.
    let marketPrice: string | null = null;
    try {
      const pub = createPublicBinanceClient();
      const ticker = await pub.getTickerPrice(bot.symbol);
      marketPrice = ticker.price;
    } catch {
      // Non-fatal — UI will still render without it.
    }

    // Unrealized P&L (floating): (currentPrice − initialStartPrice) × signedHeld.
    let unrealized = 0;
    const startNum = Number(state.initialStartPrice ?? 0);
    const mktNum = Number(marketPrice ?? 0);
    if (startNum > 0 && mktNum > 0 && signedHeld !== 0) {
      unrealized = (mktNum - startNum) * signedHeld;
    }

    const totalProfits = realized + unrealized;

    // ─── Volume: total notional FDUSD traded by this bot ───
    const volumeAgg = await this.prisma.trade.aggregate({
      where: { botId: id },
      _sum: { quoteQuantity: true },
      _count: true,
    });
    const totalVolume = Number(volumeAgg._sum.quoteQuantity ?? 0);

    // Historical series for the sparkline — derived from fill events that carry
    // realizedPnlQuote snapshot in their `data` payload.
    //   Grid Simple: BUY_FILLED / SELL_FILLED
    //   DCA:         DCA_BUY_FILLED / DCA_SELL_FILLED
    const cycleEvents = await this.prisma.botEvent.findMany({
      where: {
        botId: id,
        // Grid Simple emits BUY_FILLED / SELL_FILLED.
        // DCA (both legacy and simple) emit DCA_BUY_FILLED / DCA_SELL_FILLED.
        type: { in: ['BUY_FILLED', 'SELL_FILLED', 'DCA_BUY_FILLED', 'DCA_SELL_FILLED'] },
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
      select: { createdAt: true, data: true },
    });
    const pnlSeries: Array<{ ts: number; pnl: number }> = [];
    for (const e of cycleEvents) {
      const data = (e.data ?? {}) as { realizedPnlQuote?: string; cycleClosed?: boolean };
      if (!data.cycleClosed) continue;
      pnlSeries.push({ ts: e.createdAt.getTime(), pnl: Number(data.realizedPnlQuote ?? 0) });
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
        // Per project spec
        realized,
        unrealized,
        total: totalProfits,
        cyclesCompleted: cycles,
        avgPerCycle: cycles > 0 ? realized / cycles : 0,
        // Historical curve of cumulative realized
        series: pnlSeries,
        // Inventory exposure
        heldQty,
        soldQty,
        signedHeld,
      },
      volume: {
        totalQuote: totalVolume,
        tradeCount: volumeAgg._count,
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

/** Coerce an unknown JSON value to a finite number, or null. */
function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
