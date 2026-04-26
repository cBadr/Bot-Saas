import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createPublicBinanceClient, extractFilters, type SymbolFilters } from '@orca/exchange';
import {
  GridParamsSchema,
  GraphParamsSchema,
  RollingRSI,
  RollingSMA,
  RisingEdge,
  type GraphParams,
} from '@orca/strategies';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface BacktestInput {
  strategyId: string;
  symbol: string;
  interval: '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
  days: number;
  /** User-tuned parameters (graph: cooldownSec; grid: range/levels/etc.) */
  params: Record<string, unknown>;
}

interface BacktestTrade {
  ts: number;
  side: 'BUY' | 'SELL';
  price: number;
  qty: number;
  pnl: number;
}

interface BacktestResult {
  strategyName: string;
  engine: 'grid_v1' | 'graph_v1';
  symbol: string;
  interval: string;
  bars: number;
  filters: SymbolFilters;
  stats: {
    totalTrades: number;
    buys: number;
    sells: number;
    finalPnl: number;
    maxDrawdown: number;
    roi: number;
    winRate?: number;
  };
  trades: BacktestTrade[];
}

@Injectable()
export class BacktestService {
  constructor(private readonly prisma: PrismaService) {}

  /** Public entry — dispatches based on strategy type. */
  async run(userId: string, input: BacktestInput): Promise<BacktestResult> {
    const strategy = await this.prisma.strategy.findUnique({ where: { id: input.strategyId } });
    if (!strategy) throw new NotFoundException('Strategy not found');
    if (strategy.visibility === 'PRIVATE' && strategy.ownerId !== userId) {
      throw new ForbiddenException('Strategy not accessible');
    }

    const engineKey = strategy.builtinKey
      ?? ((strategy.definition as Record<string, unknown> | null)?.engine as string | undefined)
      ?? 'graph_v1';

    const symbol = input.symbol.toUpperCase();
    const klines = await this.fetchKlines(symbol, input.interval, input.days);
    const filters = await this.fetchFilters(symbol);

    if (engineKey === 'grid_v1') {
      return this.runGrid(strategy.name, symbol, input.interval, input.params, klines, filters);
    }
    if (engineKey === 'graph_v1') {
      const def = (strategy.definition ?? {}) as Record<string, unknown>;
      const params: Record<string, unknown> = {
        ...input.params,
        graph: { nodes: def.nodes, edges: def.edges },
      };
      return this.runGraph(strategy.name, symbol, input.interval, params, klines, filters);
    }
    throw new NotFoundException(`Backtest engine "${engineKey}" not supported`);
  }

  // ─── GRID backtest ────────────────────────────────────
  private runGrid(
    strategyName: string,
    symbol: string,
    interval: string,
    rawParams: Record<string, unknown>,
    klines: number[][],
    filters: SymbolFilters,
  ): BacktestResult {
    const params = GridParamsSchema.parse(rawParams);

    // ─── Build levels (supports arithmetic, geometric, fixed_dollar) ───
    const levels: { price: number; hasInventory: boolean; qty: number }[] = [];
    if (params.spacingMode === 'fixed_dollar') {
      const step = params.spacingDollar!;
      for (let i = 0; i < params.gridLevels; i++) {
        const p = params.lowerPrice + step * i;
        if (p > params.upperPrice) break;
        levels.push({ price: p, hasInventory: false, qty: 0 });
      }
    } else if (params.spacingMode === 'arithmetic') {
      const step = (params.upperPrice - params.lowerPrice) / (params.gridLevels - 1);
      for (let i = 0; i < params.gridLevels; i++) {
        levels.push({ price: params.lowerPrice + step * i, hasInventory: false, qty: 0 });
      }
    } else {
      const mult =
        params.priceMultiplier ??
        Math.pow(params.upperPrice / params.lowerPrice, 1 / (params.gridLevels - 1));
      for (let i = 0; i < params.gridLevels; i++) {
        levels.push({ price: params.lowerPrice * Math.pow(mult, i), hasInventory: false, qty: 0 });
      }
    }

    // ─── Anchor + initial position bootstrap ───
    const firstClose = klines.length ? Number(klines[0]![4]) : params.lowerPrice;
    const anchor = params.anchorPrice ?? firstClose;
    const quotePerLevel = params.totalQuoteInvestment / Math.max(1, levels.length);
    const trades: BacktestTrade[] = [];
    let pnl = 0, peak = 0, maxDrawdown = 0;
    let cycles = 0;
    let highWater = firstClose;
    let stopReason: string | undefined;

    if (params.initialPositionPct > 0) {
      const bootstrapQuote = params.totalQuoteInvestment * (params.initialPositionPct / 100);
      const bootstrapQty = bootstrapQuote / anchor;
      trades.push({ ts: Number(klines[0]?.[0] ?? 0), side: 'BUY', price: anchor, qty: bootstrapQty, pnl: 0 });
      // Distribute inventory across SELL levels above anchor
      const sellLevels = levels.filter((l) => l.price > anchor);
      if (sellLevels.length > 0) {
        const perLevelQty = bootstrapQty / sellLevels.length;
        for (const sl of sellLevels) {
          sl.hasInventory = true;
          sl.qty = perLevelQty;
        }
      }
    }

    const enableBuys = params.gridMode !== 'short';
    const enableSells = params.gridMode !== 'long' || true; // always sell on inventory; long sells via fills

    for (const k of klines) {
      const ts = Number(k[0]);
      const high = Number(k[2]);
      const low = Number(k[3]);
      const close = Number(k[4]);
      if (params.takeProfitPrice && high >= params.takeProfitPrice) { stopReason = 'tp'; break; }
      if (params.stopLossPrice && low <= params.stopLossPrice) { stopReason = 'sl'; break; }
      if (params.trailingStopPct !== undefined) {
        highWater = Math.max(highWater, high);
        const dropPct = ((highWater - low) / highWater) * 100;
        if (dropPct >= params.trailingStopPct) { stopReason = 'trailing'; break; }
      }

      for (let i = 0; i < levels.length; i++) {
        const lvl = levels[i]!;
        // BUY fill at level (only below anchor for long/neutral)
        if (enableBuys && !lvl.hasInventory && low <= lvl.price && lvl.price < anchor && i < levels.length - 1) {
          const qty = Number((quotePerLevel / lvl.price).toFixed(8));
          lvl.hasInventory = true;
          lvl.qty = qty;
          trades.push({ ts, side: 'BUY', price: lvl.price, qty, pnl: 0 });
        }
        // SELL fill at next level up
        const upper = levels[i + 1];
        if (enableSells && lvl.hasInventory && upper && high >= upper.price) {
          const tradePnl = (upper.price - lvl.price) * lvl.qty;
          pnl += tradePnl;
          peak = Math.max(peak, pnl);
          maxDrawdown = Math.max(maxDrawdown, peak - pnl);
          trades.push({ ts, side: 'SELL', price: upper.price, qty: lvl.qty, pnl: tradePnl });
          lvl.hasInventory = false;
          lvl.qty = 0;
          cycles++;
          if (params.stopAfterCycles && cycles >= params.stopAfterCycles) { stopReason = 'cycles'; break; }
        }
      }
      if (stopReason) break;
      void close;
    }

    return {
      strategyName,
      engine: 'grid_v1',
      symbol,
      interval,
      bars: klines.length,
      filters,
      stats: {
        totalTrades: trades.length,
        buys: trades.filter((t) => t.side === 'BUY').length,
        sells: trades.filter((t) => t.side === 'SELL').length,
        finalPnl: pnl,
        maxDrawdown,
        roi: (pnl / params.totalQuoteInvestment) * 100,
      },
      trades: trades.slice(-200),
    };
  }

  // ─── GRAPH backtest ───────────────────────────────────
  private runGraph(
    strategyName: string,
    symbol: string,
    interval: string,
    rawParams: Record<string, unknown>,
    klines: number[][],
    filters: SymbolFilters,
  ): BacktestResult {
    const params: GraphParams = GraphParamsSchema.parse(rawParams);
    const cooldownMs = params.cooldownSec * 1000;
    const nodes = params.graph.nodes;

    const adj = new Map<string, string[]>();
    const radj = new Map<string, string[]>();
    for (const e of params.graph.edges) {
      if (!adj.has(e.from)) adj.set(e.from, []);
      adj.get(e.from)!.push(e.to);
      if (!radj.has(e.to)) radj.set(e.to, []);
      radj.get(e.to)!.push(e.from);
    }

    type RT = {
      rsi?: RollingRSI; rsiValue?: number;
      smaFast?: RollingSMA; smaSlow?: RollingSMA;
      edge: RisingEdge; cached?: boolean;
    };
    const runtime = new Map<string, RT>();
    for (const node of nodes) {
      const rt: RT = { edge: new RisingEdge() };
      if (node.kind === 'trigger.rsi') rt.rsi = new RollingRSI(Number(node.config.period ?? 14));
      if (node.kind === 'trigger.cross') {
        rt.smaFast = new RollingSMA(Number(node.config.fast ?? 9));
        rt.smaSlow = new RollingSMA(Number(node.config.slow ?? 21));
      }
      runtime.set(node.id, rt);
    }

    // Simulated wallet
    const startingQuote = 1000;
    let quoteBal = startingQuote;
    let baseBal = 0;
    const trades: BacktestTrade[] = [];
    const lastFiredAt: Record<string, number> = {};
    let pnl = 0, peak = 0, maxDrawdown = 0;
    let winCount = 0, lossCount = 0;
    let lastBuyPrice: number | undefined;

    const evalNode = (id: string, lastPrice: number): boolean => {
      const rt = runtime.get(id)!;
      if (rt.cached !== undefined) return rt.cached;
      const node = nodes.find((n) => n.id === id)!;
      let result = false;
      switch (node.kind) {
        case 'trigger.price': {
          const target = Number(node.config.price);
          const above = (node.config.direction ?? 'above') === 'above';
          result = rt.edge.test(above ? lastPrice >= target : lastPrice <= target);
          break;
        }
        case 'trigger.rsi': {
          const v = rt.rsiValue;
          if (v === undefined) { result = false; break; }
          const op = String(node.config.condition ?? '<');
          const target = Number(node.config.value);
          const cond = op === '<' ? v < target : op === '<=' ? v <= target
            : op === '>' ? v > target : op === '>=' ? v >= target
            : op === '==' ? v === target : false;
          result = rt.edge.test(cond);
          break;
        }
        case 'trigger.cross': {
          const fast = rt.smaFast?.value;
          const slow = rt.smaSlow?.value;
          if (fast === undefined || slow === undefined) { result = false; break; }
          const dir = String(node.config.direction ?? 'up');
          result = rt.edge.test(dir === 'up' ? fast > slow : fast < slow);
          break;
        }
        case 'logic.and': {
          const incoming = radj.get(id) ?? [];
          result = incoming.length > 0 && incoming.every((i) => evalNode(i, lastPrice));
          break;
        }
        case 'action.buy':
        case 'action.sell': {
          const incoming = radj.get(id) ?? [];
          result = incoming.some((i) => evalNode(i, lastPrice));
          break;
        }
      }
      rt.cached = result;
      return result;
    };

    for (const k of klines) {
      const ts = Number(k[0]);
      const close = Number(k[4]);

      for (const node of nodes) {
        const rt = runtime.get(node.id)!;
        rt.cached = undefined;
        if (rt.rsi) rt.rsiValue = rt.rsi.push(close);
        rt.smaFast?.push(close);
        rt.smaSlow?.push(close);
      }

      for (const node of nodes) {
        if (node.kind !== 'action.buy' && node.kind !== 'action.sell') continue;
        if (!evalNode(node.id, close)) continue;
        const lastFired = lastFiredAt[node.id] ?? 0;
        if (ts - lastFired < cooldownMs) continue;

        if (node.kind === 'action.buy') {
          const quoteAmount = Number(node.config.quoteAmount ?? 0);
          if (quoteAmount > quoteBal || quoteAmount <= 0) continue;
          const qty = quoteAmount / close;
          quoteBal -= quoteAmount;
          baseBal += qty;
          lastBuyPrice = close;
          trades.push({ ts, side: 'BUY', price: close, qty, pnl: 0 });
          lastFiredAt[node.id] = ts;
        } else {
          if (baseBal <= 0) continue;
          const percent = Number(node.config.percent ?? 100);
          const qty = baseBal * (percent / 100);
          const proceeds = qty * close;
          const tradePnl = lastBuyPrice !== undefined ? (close - lastBuyPrice) * qty : 0;
          baseBal -= qty;
          quoteBal += proceeds;
          pnl += tradePnl;
          if (tradePnl > 0) winCount++;
          else if (tradePnl < 0) lossCount++;
          peak = Math.max(peak, pnl);
          maxDrawdown = Math.max(maxDrawdown, peak - pnl);
          trades.push({ ts, side: 'SELL', price: close, qty, pnl: tradePnl });
          lastFiredAt[node.id] = ts;
        }
      }
    }

    const totalSells = trades.filter((t) => t.side === 'SELL').length;
    return {
      strategyName,
      engine: 'graph_v1',
      symbol,
      interval,
      bars: klines.length,
      filters,
      stats: {
        totalTrades: trades.length,
        buys: trades.filter((t) => t.side === 'BUY').length,
        sells: totalSells,
        finalPnl: pnl,
        maxDrawdown,
        roi: (pnl / startingQuote) * 100,
        winRate: totalSells > 0 ? (winCount / Math.max(1, winCount + lossCount)) * 100 : 0,
      },
      trades: trades.slice(-200),
    };
  }

  // ─── Helpers ──────────────────────────────────────────
  private async fetchKlines(symbol: string, interval: string, days: number): Promise<number[][]> {
    const pub = createPublicBinanceClient();
    const limit = 1000;
    const intervalMs = this.intervalToMs(interval);
    const barsNeeded = Math.min(5000, Math.ceil((days * 86_400_000) / intervalMs));
    const klines: number[][] = [];
    let endTime = Date.now();
    while (klines.length < barsNeeded) {
      const batch = (await pub.getKlines({ symbol, interval, limit, endTime })) as number[][];
      if (!batch.length) break;
      klines.unshift(...batch);
      endTime = Number(batch[0]![0]) - 1;
      if (batch.length < limit) break;
    }
    return klines;
  }

  private async fetchFilters(symbol: string): Promise<SymbolFilters> {
    const pub = createPublicBinanceClient();
    const ex = await pub.getExchangeInfo([symbol]);
    if (!ex.symbols.length) throw new NotFoundException(`Symbol ${symbol} not found`);
    return extractFilters(ex.symbols[0]!);
  }

  private intervalToMs(interval: string): number {
    return ({
      '1m': 60_000, '5m': 300_000, '15m': 900_000,
      '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000,
    } as Record<string, number>)[interval] ?? 60_000;
  }
}
