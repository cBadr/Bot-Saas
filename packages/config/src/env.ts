import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

function loadEnvFiles(): void {
  const cwd = process.cwd();
  const candidates = [
    resolve(cwd, '.env.local'),
    resolve(cwd, '.env'),
    resolve(cwd, '../../.env.local'),
    resolve(cwd, '../../.env'),
  ];
  for (const path of candidates) {
    if (existsSync(path)) loadDotenv({ path, override: false });
  }
}

loadEnvFiles();

const numericString = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .pipe(z.number().int());

const boolString = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v === '') return def;
      return v.toLowerCase() === 'true' || v === '1';
    });

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().url(),

  REDIS_HOST: z.string().default('127.0.0.1'),
  REDIS_PORT: numericString(6379),
  REDIS_PASSWORD: z.string().optional().default(''),
  REDIS_DB: numericString(0),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),

  API_PORT: numericString(4000),
  API_HOST: z.string().default('0.0.0.0'),
  API_PREFIX: z.string().default('api/v1'),
  API_CORS_ORIGIN: z.string().default('http://localhost:3000'),

  WEB_PORT: numericString(3000),
  NEXT_PUBLIC_API_URL: z.string().default('https://orcax.click/api/v1'),
  NEXT_PUBLIC_WS_URL: z.string().default('wss://orcax.click'),
  /** Public-facing web URL — used to build deep-links in Telegram messages. Optional. */
  PUBLIC_WEB_URL: z.string().optional(),

  // ─── Sentry (error tracking) — all optional ───
  SENTRY_DSN_API: z.string().optional(),
  SENTRY_DSN_ENGINE: z.string().optional(),
  SENTRY_DSN_WEB: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
  SENTRY_ENVIRONMENT: z.string().default('development'),

  ENGINE_PORT: numericString(4001),
  ENGINE_MAX_BOTS_PER_WORKER: numericString(10),

  AUTH_SECRET: z.string().min(16),
  AUTH_URL: z.string().default('http://localhost:3000'),
  /** Used to derive AES key for encrypting API secrets at rest. Defaults to AUTH_SECRET if unset. */
  ENCRYPTION_SECRET: z.string().min(16).optional(),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  BINANCE_BASE_URL: z.string().default('https://api.binance.com'),
  BINANCE_WS_URL: z.string().default('wss://stream.binance.com:9443'),
  BINANCE_TIME_SYNC_INTERVAL_MS: numericString(60_000),
  BINANCE_DEFAULT_RECV_WINDOW: numericString(5000),
  BINANCE_REQUESTS_PER_MINUTE: numericString(1100),
  BINANCE_ORDERS_PER_10_SECONDS: numericString(45),
  BINANCE_ORDERS_PER_DAY: numericString(160_000),

  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  LOG_PRETTY: boolString(false),
  LOG_FILE_ENABLED: boolString(true),
  LOG_FILE_PATH: z.string().default('./logs'),

  SENTRY_DSN: z.string().optional().default(''),

  TELEGRAM_BOT_TOKEN: z.string().optional().default(''),
  TELEGRAM_DEFAULT_CHAT_ID: z.string().optional().default(''),

  // ─── Email (Resend) ───
  RESEND_API_KEY: z.string().optional().default(''),
  RESEND_FROM: z.string().optional().default('Orca <notifications@orca.local>'),

  // ─── Web Push (VAPID) ───
  VAPID_PUBLIC_KEY: z.string().optional().default(''),
  VAPID_PRIVATE_KEY: z.string().optional().default(''),
  VAPID_SUBJECT: z.string().optional().default('mailto:admin@orca.local'),
  /** Exposed to web client to subscribe via PushManager. Same value as VAPID_PUBLIC_KEY. */
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().optional().default(''),

  COINPAYMENTS_PUBLIC_KEY: z.string().optional().default(''),
  COINPAYMENTS_PRIVATE_KEY: z.string().optional().default(''),
  COINPAYMENTS_IPN_SECRET: z.string().optional().default(''),
  COINPAYMENTS_MERCHANT_ID: z.string().optional().default(''),
  COINPAYMENTS_IPN_URL: z.string().optional().default(''),

  ADMIN_DEFAULT_EMAIL: z.string().email().default('admin@orca.local'),
  ADMIN_DEFAULT_PASSWORD: z.string().default('ChangeMe123!'),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export const env = new Proxy({} as Env, {
  get(_target, prop: string) {
    return getEnv()[prop as keyof Env];
  },
});
