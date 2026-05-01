/**
 * Sentry init for the Engine — must be imported BEFORE any other module
 * that may throw async errors.
 *
 * No-op if SENTRY_DSN_ENGINE is unset.
 */

import * as Sentry from '@sentry/node';
import { env } from '@orca/config';

const dsn = env.SENTRY_DSN_ENGINE;
if (dsn) {
  Sentry.init({
    dsn,
    environment: env.SENTRY_ENVIRONMENT,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    sendDefaultPii: false,
    initialScope: { tags: { service: 'orca-engine' } },
  });
  console.log(`[sentry] Engine init OK (env=${env.SENTRY_ENVIRONMENT})`);
}
