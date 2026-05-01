/**
 * Sentry browser-side config for Next.js. Loaded automatically by
 * `@sentry/nextjs` plugin. No-op when NEXT_PUBLIC_SENTRY_DSN is unset.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? 'development',
    tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    initialScope: { tags: { service: 'orca-web' } },
  });
}
