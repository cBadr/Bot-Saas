/**
 * Engine ↔ API command bridge over Redis Pub/Sub.
 * The Engine worker subscribes to ENGINE_COMMAND_CHANNEL.
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
