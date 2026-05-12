/**
 * Engine ↔ API Pub/Sub channels (mirror of apps/api/src/modules/bots/engine-bridge.ts).
 * Kept duplicated to avoid cross-app imports.
 */
export const ENGINE_COMMAND_CHANNEL = 'orca:engine:cmd';
export const ENGINE_EVENT_CHANNEL = 'orca:engine:evt';

export type EngineCommand =
  | { type: 'START'; botId: string }
  | { type: 'STOP'; botId: string }
  | { type: 'EMERGENCY_STOP_USER'; userId: string }
  | { type: 'CANCEL_PENDING'; botId: string };

export type EngineEvent =
  | { type: 'BOT_STATUS'; botId: string; status: string; message?: string }
  | { type: 'BOT_EVENT'; botId: string; event: string; data?: Record<string, unknown> };
