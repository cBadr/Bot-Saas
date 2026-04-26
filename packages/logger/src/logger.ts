import { mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import pino, { type Logger as PinoLogger, type LoggerOptions } from 'pino';
import { env } from '@orca/config';
import type { LogCategory, LogLevel } from '@orca/shared';

let rootLogger: PinoLogger | undefined;

function buildTransport() {
  const targets: Array<{ target: string; level: string; options: Record<string, unknown> }> = [];

  if (env.LOG_PRETTY) {
    targets.push({
      target: 'pino-pretty',
      level: env.LOG_LEVEL,
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss.l',
        ignore: 'pid,hostname',
        singleLine: false,
      },
    });
  } else {
    targets.push({ target: 'pino/file', level: env.LOG_LEVEL, options: { destination: 1 } });
  }

  if (env.LOG_FILE_ENABLED) {
    const dir = resolve(process.cwd(), env.LOG_FILE_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    targets.push({
      target: 'pino-roll',
      level: env.LOG_LEVEL,
      options: {
        file: resolve(dir, 'app.log'),
        frequency: 'daily',
        size: '50m',
        mkdir: true,
        dateFormat: 'yyyy-MM-dd',
      },
    });
  }

  return pino.transport({ targets });
}

export function getRootLogger(): PinoLogger {
  if (rootLogger) return rootLogger;
  const options: LoggerOptions = {
    level: env.LOG_LEVEL,
    base: { service: process.env.ORCA_SERVICE_NAME ?? 'orca' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        '*.password',
        '*.token',
        '*.apiKey',
        '*.apiSecret',
        '*.secret',
        'req.headers.authorization',
        'req.headers.cookie',
      ],
      censor: '***',
    },
  };
  rootLogger = pino(options, buildTransport());
  return rootLogger;
}

export interface OrcaLogContext {
  category?: LogCategory;
  userId?: string;
  botId?: string;
  strategyId?: string;
  symbol?: string;
  orderId?: string | number;
  requestId?: string;
  [key: string]: unknown;
}

export class OrcaLogger {
  private readonly base: PinoLogger;

  constructor(bindings: OrcaLogContext = {}) {
    this.base = getRootLogger().child(bindings);
  }

  child(bindings: OrcaLogContext): OrcaLogger {
    const next = new OrcaLogger();
    (next as unknown as { base: PinoLogger }).base = this.base.child(bindings);
    return next;
  }

  private log(level: LogLevel, msg: string, ctx?: OrcaLogContext): void {
    if (ctx) this.base[level](ctx, msg);
    else this.base[level](msg);
  }

  trace(msg: string, ctx?: OrcaLogContext) { this.log('trace', msg, ctx); }
  debug(msg: string, ctx?: OrcaLogContext) { this.log('debug', msg, ctx); }
  info(msg: string, ctx?: OrcaLogContext) { this.log('info', msg, ctx); }
  warn(msg: string, ctx?: OrcaLogContext) { this.log('warn', msg, ctx); }
  error(msg: string, ctx?: OrcaLogContext) { this.log('error', msg, ctx); }
  fatal(msg: string, ctx?: OrcaLogContext) { this.log('fatal', msg, ctx); }
}

export function createLogger(category: LogCategory, extra: OrcaLogContext = {}): OrcaLogger {
  return new OrcaLogger({ category, ...extra });
}
