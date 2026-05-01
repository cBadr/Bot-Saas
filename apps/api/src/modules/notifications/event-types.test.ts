/**
 * Unit tests for the BotEvent → NotificationEvent mapping.
 *
 * Focus: the fill-frequency gate logic and CUSTOM rule application.
 * These rules are the user-facing knobs in /settings/notifications.
 */

import { describe, it, expect } from 'vitest';
import { mapBotEvent, type BotEventCtx } from './event-types';

const baseBot: BotEventCtx['bot'] = {
  id: 'bot-1',
  name: 'Test Bot',
  symbol: 'BTCFDUSD',
  paperTrading: false,
  quoteAsset: 'FDUSD',
  strategy: { name: 'Grid Simple', builtinKey: 'grid_simple' },
};

const makeCtx = (overrides: Partial<BotEventCtx> = {}): BotEventCtx => ({
  data: {},
  bot: baseBot,
  fillFrequency: 'PER_CYCLE',
  ...overrides,
});

describe('event-types — fillMapping', () => {
  describe('cycle close (cycleClosed=true)', () => {
    it('always notifies in PER_CYCLE mode', () => {
      const result = mapBotEvent('SELL_FILLED', makeCtx({
        fillFrequency: 'PER_CYCLE',
        data: { cycleClosed: true, cyclePnl: '0.05', cyclesCompleted: 1, side: 'SELL', price: '78100', quantity: '0.001' },
      }));
      expect(result?.notificationEvent).toBe('CYCLE_COMPLETED');
      expect(result?.send).toBe(true);
    });

    it('always notifies in PER_FILL mode too', () => {
      const result = mapBotEvent('SELL_FILLED', makeCtx({
        fillFrequency: 'PER_FILL',
        data: { cycleClosed: true, cyclePnl: '0.05', cyclesCompleted: 1, side: 'SELL', price: '78100', quantity: '0.001' },
      }));
      expect(result?.notificationEvent).toBe('CYCLE_COMPLETED');
    });

    it('CUSTOM with minCyclePnl=0.10 suppresses small cycle of 0.05', () => {
      const result = mapBotEvent('SELL_FILLED', makeCtx({
        fillFrequency: 'CUSTOM',
        notificationConfig: { minCyclePnl: 0.10 },
        data: { cycleClosed: true, cyclePnl: '0.05', cyclesCompleted: 1, side: 'SELL', price: '78100', quantity: '0.001' },
      }));
      expect(result).toBeNull();
    });

    it('CUSTOM with minCyclePnl=0.10 sends cycle of 0.20', () => {
      const result = mapBotEvent('SELL_FILLED', makeCtx({
        fillFrequency: 'CUSTOM',
        notificationConfig: { minCyclePnl: 0.10 },
        data: { cycleClosed: true, cyclePnl: '0.20', cyclesCompleted: 1, side: 'SELL', price: '78100', quantity: '0.001' },
      }));
      expect(result?.notificationEvent).toBe('CYCLE_COMPLETED');
    });

    it('CUSTOM minCyclePnl works on absolute value (negative cycles too)', () => {
      const result = mapBotEvent('SELL_FILLED', makeCtx({
        fillFrequency: 'CUSTOM',
        notificationConfig: { minCyclePnl: 0.10 },
        data: { cycleClosed: true, cyclePnl: '-0.20', cyclesCompleted: 1, side: 'SELL', price: '78100', quantity: '0.001' },
      }));
      // |-0.20| >= 0.10 → still send
      expect(result?.notificationEvent).toBe('CYCLE_COMPLETED');
    });
  });

  describe('opening leg (cycleClosed=false)', () => {
    it('OFF mode suppresses opening fills', () => {
      const result = mapBotEvent('BUY_FILLED', makeCtx({
        fillFrequency: 'OFF',
        data: { cycleClosed: false, side: 'BUY', price: '77900', quantity: '0.001' },
      }));
      expect(result).toBeNull();
    });

    it('PER_CYCLE mode suppresses opening fills', () => {
      const result = mapBotEvent('BUY_FILLED', makeCtx({
        fillFrequency: 'PER_CYCLE',
        data: { cycleClosed: false, side: 'BUY', price: '77900', quantity: '0.001' },
      }));
      expect(result).toBeNull();
    });

    it('PER_FILL mode emits opening fills', () => {
      const result = mapBotEvent('BUY_FILLED', makeCtx({
        fillFrequency: 'PER_FILL',
        data: { cycleClosed: false, side: 'BUY', price: '77900', quantity: '0.001' },
      }));
      expect(result?.notificationEvent).toBe('ORDER_FILLED');
    });
  });

  describe('CUSTOM side filters', () => {
    it('notifyOnBuyFills=false suppresses BUY opening fills', () => {
      const result = mapBotEvent('BUY_FILLED', makeCtx({
        fillFrequency: 'CUSTOM',
        notificationConfig: { notifyOnBuyFills: false, notifyOnSellFills: true },
        data: { cycleClosed: false, side: 'BUY', price: '77900', quantity: '0.001' },
      }));
      expect(result).toBeNull();
    });

    it('notifyOnSellFills=false suppresses SELL opening fills', () => {
      const result = mapBotEvent('SELL_FILLED', makeCtx({
        fillFrequency: 'CUSTOM',
        notificationConfig: { notifyOnBuyFills: true, notifyOnSellFills: false },
        data: { cycleClosed: false, side: 'SELL', price: '78100', quantity: '0.001' },
      }));
      expect(result).toBeNull();
    });

    it('notifyOnBuyFills=true sends BUY opening fills', () => {
      const result = mapBotEvent('BUY_FILLED', makeCtx({
        fillFrequency: 'CUSTOM',
        notificationConfig: { notifyOnBuyFills: true },
        data: { cycleClosed: false, side: 'BUY', price: '77900', quantity: '0.001' },
      }));
      expect(result?.notificationEvent).toBe('ORDER_FILLED');
    });
  });

  describe('CUSTOM minFillNotional', () => {
    it('skips fills below threshold', () => {
      const result = mapBotEvent('BUY_FILLED', makeCtx({
        fillFrequency: 'CUSTOM',
        notificationConfig: { notifyOnBuyFills: true, minFillNotional: 50 },
        // notional = 77900 × 0.0001 = 7.79
        data: { cycleClosed: false, side: 'BUY', price: '77900', quantity: '0.0001' },
      }));
      expect(result).toBeNull();
    });

    it('emits fills at or above threshold', () => {
      const result = mapBotEvent('BUY_FILLED', makeCtx({
        fillFrequency: 'CUSTOM',
        notificationConfig: { notifyOnBuyFills: true, minFillNotional: 5 },
        // notional = 77900 × 0.0001 = 7.79
        data: { cycleClosed: false, side: 'BUY', price: '77900', quantity: '0.0001' },
      }));
      expect(result?.notificationEvent).toBe('ORDER_FILLED');
    });
  });

  describe('non-fill event types', () => {
    it('FATAL_API_ERROR maps to BOT_ERROR and always sends', () => {
      const result = mapBotEvent('FATAL_API_ERROR', makeCtx({
        data: { msg: 'API key invalid', category: 'AUTH', code: -2014 },
      }));
      expect(result?.notificationEvent).toBe('BOT_ERROR');
      expect(result?.send).toBe(true);
    });

    it('RISK_DAILY_LOSS maps to STOP_LOSS_HIT and always sends', () => {
      const result = mapBotEvent('RISK_DAILY_LOSS', makeCtx({
        data: { todayLoss: 50, limit: 30 },
      }));
      expect(result?.notificationEvent).toBe('STOP_LOSS_HIT');
    });

    it('RISK_MAX_DRAWDOWN maps to BOT_ERROR', () => {
      const result = mapBotEvent('RISK_MAX_DRAWDOWN', makeCtx({
        data: { ddPct: 12.5, limit: 10 },
      }));
      expect(result?.notificationEvent).toBe('BOT_ERROR');
    });

    it('unknown event types return null (info-only events not surfaced)', () => {
      // GRID_INTEGRITY_OK and ORDER_PLACED are info-only — no notification mapping
      expect(mapBotEvent('GRID_INTEGRITY_OK', makeCtx())).toBeNull();
      expect(mapBotEvent('ORDER_PLACED', makeCtx())).toBeNull();
      expect(mapBotEvent('GRID_INITIALIZED', makeCtx())).toBeNull();
    });
  });
});
