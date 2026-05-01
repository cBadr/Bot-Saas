/**
 * Sentry edge-runtime config for Next.js middleware. No-op when DSN unset.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN_WEB ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    initialScope: { tags: { service: 'orca-web', runtime: 'edge' } },
  });
}
