/**
 * Sentry initialization — must be imported BEFORE NestFactory.create().
 *
 * Usage in main.ts:
 *   import './sentry';   // ← MUST be the very first import
 *   import { NestFactory } from '@nestjs/core';
 *   ...
 *
 * If SENTRY_DSN_API is unset, this is a silent no-op (safe in dev).
 */

import * as Sentry from '@sentry/nestjs';
import { env } from '@orca/config';

const dsn = env.SENTRY_DSN_API;
if (dsn) {
  Sentry.init({
    dsn,
    environment: env.SENTRY_ENVIRONMENT,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    // Capture unhandled rejections + uncaught exceptions automatically.
    integrations: [],
    // Don't ship 5xx with full stack traces in production.
    sendDefaultPii: false,
    // Tag every event with a service identifier so we can filter in Sentry.
    initialScope: { tags: { service: 'orca-api' } },
  });

  console.log(`[sentry] API init OK (env=${env.SENTRY_ENVIRONMENT})`);
}
