import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Decimal, roundToTickSize, roundToStepSize } from '@orca/shared';
import { validateOrder } from '@orca/exchange';
import type { Strategy, StrategyContext, StrategyOrderEvent } from '../base';
import { RollingRSI, RollingSMA, RisingEdge } from './indicators';

// ─── Graph schema ────────────────────────────────────────

export const GraphNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.enum([
    'trigger.price',
    'trigger.rsi',
    'trigger.cross',
    'logic.and',
    'logic.or',
    'logic.not',
    'action.buy',
    'action.sell',
  ]),
  config: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
});
export type GraphNode = z.infer<typeof GraphNodeSchema>;

export const GraphEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
});
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

export const GraphParamsSchema = z.object({
  graph: z.object({
    nodes: z.array(GraphNodeSchema).min(1).max(50),
    edges: z.array(GraphEdgeSchema).max(200),
  }),
  /** Min seconds between consecutive triggers (cooldown). Default 30. */
  cooldownSec: z.coerce.number().int().min(1).max(86_400).default(30),
});
export type GraphParams = z.infer<typeof GraphParamsSchema>;

// ─── State persisted between ticks ───────────────────────

interface GraphState {
  // last fired timestamp per action node
  lastFiredAt: Record<string, number>;
}

// ─── The strategy ────────────────────────────────────────

interface NodeRuntime {
  rsi?: RollingRSI;
  rsiValue?: number;
  smaFast?: RollingSMA;
  smaSlow?: RollingSMA;
  edge: RisingEdge;
  /** Memoized result for the current tick. */
  cachedTick?: number;
  cached?: boolean;
}

export class GraphStrategy implements Strategy<GraphParams> {
  readonly key = 'graph_v1';

  /** Per-bot runtime kept in-memory (rebuilt from graph on init). */
  private runtimes = new Map<string, Map<string, NodeRuntime>>();
  /** Children adjacency map (from -> [to]) per bot. */
  private adjacency = new Map<string, Map<string, string[]>>();
  /** Reverse adjacency (to -> [from]) per bot. */
  private reverseAdj = new Map<string, Map<string, string[]>>();

  validateParams(raw: unknown): GraphParams {
    return GraphParamsSchema.parse(raw);
  }

  private buildRuntime(botId: string, params: GraphParams): void {
    const nodes = new Map<string, NodeRuntime>();
    const adj = new Map<string, string[]>();
    const radj = new Map<string, string[]>();
    for (const node of params.graph.nodes) {
      const rt: NodeRuntime = { edge: new RisingEdge() };
      if (node.kind === 'trigger.rsi') {
        const period = Number(node.config.period ?? 14);
        rt.rsi = new RollingRSI(period);
      } else if (node.kind === 'trigger.cross') {
        rt.smaFast = new RollingSMA(Number(node.config.fast ?? 9));
        rt.smaSlow = new RollingSMA(Number(node.config.slow ?? 21));
      }
      nodes.set(node.id, rt);
    }
    for (const e of params.graph.edges) {
      if (!adj.has(e.from)) adj.set(e.from, []);
      adj.get(e.from)!.push(e.to);
      if (!radj.has(e.to)) radj.set(e.to, []);
      radj.get(e.to)!.push(e.from);
    }
    this.runtimes.set(botId, nodes);
    this.adjacency.set(botId, adj);
    this.reverseAdj.set(botId, radj);
  }

  async init(ctx: StrategyContext, params: GraphParams): Promise<void> {
    this.buildRuntime(ctx.botId, params);
    const existing = await ctx.loadState<GraphState>();
    if (!existing) await ctx.saveState({ lastFiredAt: {} } satisfies GraphState);
    await ctx.emit('GRAPH_INITIALIZED', `Loaded graph: ${params.graph.nodes.length} nodes, ${params.graph.edges.length} edges`);
  }

  async onOrderUpdate(ctx: StrategyContext, _params: GraphParams, event: StrategyOrderEvent): Promise<void> {
    if (event.status === 'FILLED') {
      await ctx.emit(`${event.side}_FILLED`, `Filled ${event.executedQty} @ ${event.price}`, {
        clientOrderId: event.clientOrderId,
      });
    }
  }

  async onTick(ctx: StrategyContext, params: GraphParams, lastPriceStr: string): Promise<void> {
    if (!this.runtimes.has(ctx.botId)) this.buildRuntime(ctx.botId, params);
    const runtime = this.runtimes.get(ctx.botId)!;
    const adj = this.adjacency.get(ctx.botId)!;
    const radj = this.reverseAdj.get(ctx.botId)!;
    const state = (await ctx.loadState<GraphState>()) ?? { lastFiredAt: {} };
    const now = Date.now();
    const lastPrice = Number(lastPriceStr);
    if (!Number.isFinite(lastPrice)) return;

    // Reset memoization
    for (const rt of runtime.values()) { rt.cached = undefined; rt.cachedTick = undefined; }

    // Push price into indicators (cache RSI value since push consumes the delta)
    for (const node of params.graph.nodes) {
      const rt = runtime.get(node.id)!;
      if (rt.rsi) rt.rsiValue = rt.rsi.push(lastPrice);
      rt.smaFast?.push(lastPrice);
      rt.smaSlow?.push(lastPrice);
    }

    // Evaluate triggers (memoize)
    const evalNode = (nodeId: string): boolean => {
      const rt = runtime.get(nodeId)!;
      if (rt.cached !== undefined) return rt.cached;
      const node = params.graph.nodes.find((n) => n.id === nodeId)!;
      let result = false;

      switch (node.kind) {
        case 'trigger.price': {
          const target = Number(node.config.price);
          const above = (node.config.direction ?? 'above') === 'above';
          const cond = above ? lastPrice >= target : lastPrice <= target;
          result = rt.edge.test(cond); // only fire on rising edge
          break;
        }
        case 'trigger.rsi': {
          const v = rt.rsiValue;
          if (v === undefined) { result = false; break; }
          const op = String(node.config.condition ?? '<');
          const target = Number(node.config.value);
          const cond =
            op === '<'  ? v < target :
            op === '<=' ? v <= target :
            op === '>'  ? v > target :
            op === '>=' ? v >= target :
            op === '==' ? v === target : false;
          result = rt.edge.test(cond);
          break;
        }
        case 'trigger.cross': {
          const fast = rt.smaFast?.value;
          const slow = rt.smaSlow?.value;
          if (fast === undefined || slow === undefined) { result = false; break; }
          const dir = String(node.config.direction ?? 'up');
          const crossed = dir === 'up' ? fast > slow : fast < slow;
          result = rt.edge.test(crossed);
          break;
        }
        case 'logic.and': {
          const incoming = radj.get(nodeId) ?? [];
          if (incoming.length === 0) { result = false; break; }
          result = incoming.every(evalNode);
          break;
        }
        case 'logic.or': {
          const incoming = radj.get(nodeId) ?? [];
          if (incoming.length === 0) { result = false; break; }
          result = incoming.some(evalNode);
          break;
        }
        case 'logic.not': {
          const incoming = radj.get(nodeId) ?? [];
          if (incoming.length === 0) { result = false; break; }
          result = !incoming.some(evalNode);
          break;
        }
        case 'action.buy':
        case 'action.sell': {
          // Actions are "active" when ANY incoming edge is active
          const incoming = radj.get(nodeId) ?? [];
          result = incoming.some(evalNode);
          break;
        }
      }
      rt.cached = result;
      return result;
    };

    // Walk over action nodes
    for (const node of params.graph.nodes) {
      if (node.kind !== 'action.buy' && node.kind !== 'action.sell') continue;
      const fire = evalNode(node.id);
      if (!fire) continue;

      const lastFired = state.lastFiredAt[node.id] ?? 0;
      if (now - lastFired < params.cooldownSec * 1000) continue;

      try {
        await this.executeAction(ctx, node, lastPriceStr);
        state.lastFiredAt[node.id] = now;
      } catch (err) {
        ctx.logger.error('Action execution failed', {
          nodeId: node.id,
          kind: node.kind,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    await ctx.saveState(state);
  }

  private async executeAction(
    ctx: StrategyContext,
    node: GraphNode,
    lastPriceStr: string,
  ): Promise<void> {
    if (node.kind === 'action.buy') {
      const quoteAmount = Number(node.config.quoteAmount ?? 0);
      if (quoteAmount <= 0) throw new Error('action.buy: quoteAmount must be > 0');
      const price = roundToTickSize(lastPriceStr, ctx.filters.tickSize);
      const qtyRaw = new Decimal(quoteAmount).div(price);
      const qty = roundToStepSize(qtyRaw, ctx.filters.stepSize);
      const v = validateOrder(ctx.filters, price, qty);
      if (!v.ok) {
        await ctx.emit('ACTION_SKIPPED', `BUY skipped: ${v.reason}`, { node: node.id });
        return;
      }
      const cid = `orca-graph-${ctx.botId.slice(0, 6)}-b-${randomUUID().slice(0, 6)}`;
      const res = await ctx.client.placeOrder({
        symbol: ctx.symbol,
        side: 'BUY',
        type: 'LIMIT',
        timeInForce: 'GTC',
        price,
        quantity: qty,
        newClientOrderId: cid,
      });
      await ctx.emit('GRAPH_BUY_PLACED', `BUY ${qty} @ ${price}`, {
        node: node.id,
        clientOrderId: cid,
        exchangeOrderId: res.orderId,
      });
    } else {
      // action.sell — sells `percent` of free base balance
      const percent = Number(node.config.percent ?? 100);
      if (percent <= 0 || percent > 100) throw new Error('action.sell: percent must be in (0,100]');
      const acct = await ctx.client.getAccount();
      const baseAsset = ctx.filters.baseAsset;
      const bal = acct.balances.find((b) => b.asset === baseAsset);
      const free = new Decimal(bal?.free ?? '0');
      if (free.lte(0)) {
        await ctx.emit('ACTION_SKIPPED', `SELL skipped: no ${baseAsset} balance`, { node: node.id });
        return;
      }
      const qtyRaw = free.mul(percent).div(100);
      const qty = roundToStepSize(qtyRaw, ctx.filters.stepSize);
      const price = roundToTickSize(lastPriceStr, ctx.filters.tickSize);
      const v = validateOrder(ctx.filters, price, qty);
      if (!v.ok) {
        await ctx.emit('ACTION_SKIPPED', `SELL skipped: ${v.reason}`, { node: node.id });
        return;
      }
      const cid = `orca-graph-${ctx.botId.slice(0, 6)}-s-${randomUUID().slice(0, 6)}`;
      const res = await ctx.client.placeOrder({
        symbol: ctx.symbol,
        side: 'SELL',
        type: 'LIMIT',
        timeInForce: 'GTC',
        price,
        quantity: qty,
        newClientOrderId: cid,
      });
      await ctx.emit('GRAPH_SELL_PLACED', `SELL ${qty} @ ${price}`, {
        node: node.id,
        clientOrderId: cid,
        exchangeOrderId: res.orderId,
      });
    }
  }

  async stop(ctx: StrategyContext, _params: GraphParams): Promise<void> {
    try {
      await ctx.cancelMyOrders();
      await ctx.emit('GRAPH_STOPPED', 'Cancelled all open orders');
    } catch (err) {
      ctx.logger.error('Failed to cancel on stop', { err: String(err) });
    }
    this.runtimes.delete(ctx.botId);
    this.adjacency.delete(ctx.botId);
    this.reverseAdj.delete(ctx.botId);
  }
}

export const graphStrategy = new GraphStrategy();
