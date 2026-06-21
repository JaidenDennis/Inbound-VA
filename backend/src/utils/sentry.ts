import * as Sentry from '@sentry/node';
import { env } from '../config/index.js';
import { logger } from './logger.js';

let enabled = false;

/**
 * Initialize Sentry once per process. No-op when SENTRY_DSN is unset, so the app
 * runs identically with or without error reporting configured. `component`
 * (api | workers) is tagged on every event so issues are attributable.
 */
export function initSentry(component: 'api' | 'workers'): void {
  if (enabled || !env.SENTRY_DSN) return;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: 0, // error reporting only — no performance-tracing overhead
    initialScope: { tags: { component } },
  });
  enabled = true;
  logger.info({ component }, 'Sentry initialized');
}

/** Report an error to Sentry if enabled; safe no-op otherwise. */
export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (!enabled) return;
  Sentry.captureException(err, context ? { extra: context } : undefined);
}
