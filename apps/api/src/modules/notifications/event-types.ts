import type { NotificationEvent } from './notifications.service';

/**
 * Mapping from BotEvent.type (free-text strings emitted by strategies +
 * runner) → NotificationEvent (the user-facing taxonomy persisted in
 * NotificationPreference).
 *
 * Each mapping decides:
 *   - Which NotificationEvent to dispatch
 *   - Whether the event should be respected based on user.fillFrequency
 *   - How to format the title and body for Telegram + in-app
 *
 * The NotificationDispatcher consumes BotEvents from Redis Pub/Sub and
 * routes them through here.
 */

export type FillFrequency = 'OFF' | 'PER_CYCLE' | 'PER_FILL' | 'CUSTOM';

/**
 * Custom notification rules applied when `fillFrequency === 'CUSTOM'`.
 * All fields are optional; missing fields fall back to permissive defaults
 * (notify on every event). The shape is forward-compatible — new keys can
 * be added without a schema migration.
 */
export interface NotificationConfig {
  // ─── Fill filters (when fillFrequency = 'CUSTOM') ───
  /** Notify on opening BUY-side fills (ladder accumulation in BUY-mode). Default true. */
  notifyOnBuyFills?: boolean;
  /** Notify on opening SELL-side fills (ladder distribution in SELL-mode). Default true. */
  notifyOnSellFills?: boolean;
  /** Suppress fills whose quote value (price × qty) is below this threshold. Default 0 = no filter. */
  minFillNotional?: number;
  /** Suppress cycle closes whose PnL is below this threshold (absolute value). Default 0 = no filter. */
  minCyclePnl?: number;

  // ─── Periodic status reports ───
  /** How often to send a comprehensive status report. 0 / undefined = disabled. */
  statusReportIntervalMinutes?: number;
  /** Bots to include in the report. 'ALL' = every owned bot, or an explicit list of bot ids. Default 'ALL'. */
  statusReportBots?: 'ALL' | string[];
}

export interface BotEventCtx {
  /** The raw BotEvent.data JSON payload (from ctx.emit). */
  data: Record<string, unknown>;
  /** The bot row (id, name, symbol, paperTrading, strategy.name, quoteAsset). */
  bot: {
    id: string;
    name: string;
    symbol: string;
    paperTrading: boolean;
    quoteAsset: string;
    strategy?: { name: string; builtinKey: string | null } | null;
  };
  /** The user's fillFrequency preference. */
  fillFrequency: FillFrequency;
  /** User's custom rules — only consulted when fillFrequency === 'CUSTOM'. */
  notificationConfig?: NotificationConfig;
  /** Optional public web base URL for deep links. */
  webBaseUrl?: string;
}

export interface FormattedNotification {
  notificationEvent: NotificationEvent;
  title: string;
  body: string;
  /** If false → suppress this notification entirely (frequency gate). */
  send: boolean;
}

type Mapping = (ctx: BotEventCtx) => FormattedNotification | null;

// ─── Helpers ────────────────────────────────────────────────────────

const fmt = (v: unknown, decimals = 4): string => {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return String(v ?? '—');
  return n.toLocaleString('en-US', { maximumFractionDigits: decimals });
};

const sign = (n: unknown, decimals = 4): string => {
  const num = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(num)) return String(n ?? '—');
  return (num >= 0 ? '+' : '') + fmt(num, decimals);
};

const link = (ctx: BotEventCtx): string =>
  ctx.webBaseUrl ? `\n[Open bot](${ctx.webBaseUrl}/bots/${ctx.bot.id})` : '';

const header = (ctx: BotEventCtx, emoji: string): string => {
  const paper = ctx.bot.paperTrading ? ' _(paper)_' : '';
  return `${emoji} *${ctx.bot.name}*${paper}\n\`${ctx.bot.symbol}\` · ${ctx.bot.strategy?.name ?? '—'}`;
};

// ─── Per BotEvent type mappings ─────────────────────────────────────

/**
 * A single fill of one ladder rung. Fires from grid_simple's BUY_FILLED /
 * SELL_FILLED and dca_simple's DCA_BUY_FILLED / DCA_SELL_FILLED.
 *
 * Two cases:
 *  - cycleClosed === true → notification event = CYCLE_COMPLETED (always send)
 *  - cycleClosed === false → notification event = ORDER_FILLED (gated by fillFrequency)
 */
const fillMapping: Mapping = (ctx) => {
  const cycleClosed = Boolean(ctx.data.cycleClosed);
  const price = ctx.data.price;
  const qty = ctx.data.quantity ?? ctx.data.executedQty;
  const cyclePnl = ctx.data.cyclePnl as string | number | undefined;
  const cyclesCompleted = ctx.data.cyclesCompleted as number | undefined;
  const realized = ctx.data.realizedPnlQuote as string | number | undefined;
  const side = (ctx.data.side as string | undefined)?.toUpperCase();
  // Side fallback — the raw BotEvent.type carries it (BUY_FILLED, SELL_FILLED, DCA_*_FILLED)
  const inferredSide = side ?? '?';

  // Default = pass; only flip to false if a rule explicitly suppresses.
  const cfg = ctx.notificationConfig ?? {};
  const isCustom = ctx.fillFrequency === 'CUSTOM';

  if (cycleClosed) {
    // Cycle close — always notify, EXCEPT in CUSTOM mode if the cycle's
    // realized PnL is below the user's `minCyclePnl` threshold.
    if (isCustom && typeof cfg.minCyclePnl === 'number' && cfg.minCyclePnl > 0) {
      const pnl = Math.abs(Number(cyclePnl ?? 0));
      if (pnl < cfg.minCyclePnl) return null;
    }
    const pnlNum = Number(cyclePnl ?? 0);
    const positive = pnlNum >= 0;
    const body = [
      header(ctx, positive ? '✅' : '⚠️'),
      '',
      `*Cycle #${cyclesCompleted ?? '?'} closed*`,
      `${inferredSide} @ \`${fmt(price, 2)}\``,
      `Cycle PnL: *${sign(cyclePnl, 6)}* ${ctx.bot.quoteAsset}`,
      realized !== undefined
        ? `Total realized: *${sign(realized, 4)}* ${ctx.bot.quoteAsset}`
        : '',
      link(ctx),
    ].filter(Boolean).join('\n');
    return {
      notificationEvent: 'CYCLE_COMPLETED',
      title: `Cycle #${cyclesCompleted ?? '?'} closed (${sign(cyclePnl, 4)})`,
      body,
      send: true,
    };
  }

  // Opening leg — gate by user's fillFrequency
  if (ctx.fillFrequency === 'OFF' || ctx.fillFrequency === 'PER_CYCLE') {
    return null;
  }
  if (isCustom) {
    // Side filter: notify on BUYs / SELLs based on user toggles (default both on).
    const sideUpper = inferredSide === 'BUY' ? 'BUY' : inferredSide === 'SELL' ? 'SELL' : null;
    if (sideUpper === 'BUY' && cfg.notifyOnBuyFills === false) return null;
    if (sideUpper === 'SELL' && cfg.notifyOnSellFills === false) return null;

    // Min notional filter: skip tiny fills.
    if (typeof cfg.minFillNotional === 'number' && cfg.minFillNotional > 0) {
      const notional = Number(price ?? 0) * Number(qty ?? 0);
      if (Number.isFinite(notional) && notional < cfg.minFillNotional) return null;
    }
  }
  // PER_FILL or CUSTOM (rules passed) — emit the message
  const body = [
    header(ctx, inferredSide === 'BUY' ? '🟢' : '🔴'),
    '',
    `${inferredSide} filled @ \`${fmt(price, 2)}\``,
    `Qty: \`${fmt(qty, 8)}\``,
    link(ctx),
  ].filter(Boolean).join('\n');
  return {
    notificationEvent: 'ORDER_FILLED',
    title: `${inferredSide} filled @ ${fmt(price, 2)}`,
    body,
    send: true,
  };
};

const fatalMapping: Mapping = (ctx) => {
  const msg = (ctx.data.msg as string | undefined) ?? 'Unknown fatal error';
  const category = (ctx.data.category ?? ctx.data.errCategory) as string | undefined;
  const code = ctx.data.code as number | undefined;
  const body = [
    header(ctx, '🛑'),
    '',
    '*Bot stopped due to a fatal error.*',
    category ? `Category: \`${category}\`${code ? ` (${code})` : ''}` : '',
    `Reason: ${msg.slice(0, 200)}`,
    link(ctx),
  ].filter(Boolean).join('\n');
  return {
    notificationEvent: 'BOT_ERROR',
    title: `Fatal: ${category ?? 'error'}`,
    body,
    send: true,
  };
};

const riskMapping = (kind: 'daily_loss' | 'drawdown'): Mapping => (ctx) => {
  const isDaily = kind === 'daily_loss';
  const value = (isDaily ? ctx.data.todayLoss : ctx.data.ddPct) as number | undefined;
  const limit = (isDaily ? ctx.data.limit : ctx.data.limit) as number | undefined;
  const body = [
    header(ctx, '⛔'),
    '',
    isDaily
      ? `*Daily loss limit triggered.*\nLost ${fmt(value, 2)} ≥ limit ${fmt(limit, 2)} ${ctx.bot.quoteAsset}`
      : `*Max drawdown triggered.*\nDrawdown ${fmt(value, 2)}% ≥ limit ${fmt(limit, 2)}%`,
    'Bot has been stopped automatically.',
    link(ctx),
  ].filter(Boolean).join('\n');
  return {
    notificationEvent: isDaily ? 'STOP_LOSS_HIT' : 'BOT_ERROR',
    title: isDaily ? 'Daily loss limit hit' : 'Max drawdown hit',
    body,
    send: true,
  };
};

const tpMapping: Mapping = (ctx) => {
  const lastPrice = ctx.data.lastPrice ?? ctx.data.price;
  const body = [
    header(ctx, '🎯'),
    '',
    `*Take profit hit* @ \`${fmt(lastPrice, 2)}\``,
    link(ctx),
  ].filter(Boolean).join('\n');
  return {
    notificationEvent: 'TAKE_PROFIT_HIT',
    title: 'Take profit hit',
    body,
    send: true,
  };
};

const slMapping: Mapping = (ctx) => {
  const lastPrice = ctx.data.lastPrice ?? ctx.data.price;
  const body = [
    header(ctx, '🛑'),
    '',
    `*Stop loss hit* @ \`${fmt(lastPrice, 2)}\``,
    link(ctx),
  ].filter(Boolean).join('\n');
  return {
    notificationEvent: 'STOP_LOSS_HIT',
    title: 'Stop loss hit',
    body,
    send: true,
  };
};

// ─── Master registry ────────────────────────────────────────────────

export const BOT_EVENT_MAPPINGS: Record<string, Mapping> = {
  // Grid Simple fills
  BUY_FILLED: fillMapping,
  SELL_FILLED: fillMapping,
  // DCA Simple fills
  DCA_BUY_FILLED: fillMapping,
  DCA_SELL_FILLED: fillMapping,
  // Fatal errors → BOT_ERROR
  FATAL_API_ERROR: fatalMapping,
  // Risk limits
  RISK_DAILY_LOSS: riskMapping('daily_loss'),
  RISK_MAX_DRAWDOWN: riskMapping('drawdown'),
  // Direct TP/SL hits (legacy strategies + grid_simple's own TAKE_PROFIT_HIT event)
  TAKE_PROFIT_HIT: tpMapping,
  STOP_LOSS_HIT: slMapping,
  TRAILING_STOP_HIT: slMapping,
};

/**
 * Look up a mapping for a BotEvent type. Returns null if the event type
 * has no associated notification (most BotEvents are info-only, like
 * GRID_INITIALIZED, ORDER_PLACED, GRID_INTEGRITY_OK, etc.).
 */
export function mapBotEvent(eventType: string, ctx: BotEventCtx): FormattedNotification | null {
  const mapping = BOT_EVENT_MAPPINGS[eventType];
  if (!mapping) return null;
  return mapping(ctx);
}
