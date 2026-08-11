import { logger } from './logger.js';
import { captureException } from './sentry.js';
import { systemErrorService } from '../services/systemError.service.js';

/**
 * Record process-level faults before the runtime tears down.
 *
 * An unhandled rejection or uncaught exception is the one class of failure that
 * bypasses every other capture point — Fastify's error handler never sees it and
 * no worker reports it. Persisting it here is the difference between "the API
 * restarted at 3am, no idea why" and a row naming the cause.
 *
 * The write is awaited with a short deadline: a hung database must not stop the
 * process from exiting, but a fast write should be allowed to land.
 */
const FLUSH_TIMEOUT_MS = 2_000;

async function recordFatal(kind: string, err: Error, service: string): Promise<void> {
  logger.fatal({ err, kind, service }, 'Fatal process error');
  const sentryEventId = captureException(err, { kind, service });

  const write = systemErrorService.record({
    source: 'startup',
    severity: 'fatal',
    route: kind,
    error: err,
    context: { service, kind },
    sentryEventId,
  });

  await Promise.race([write, new Promise((resolve) => setTimeout(resolve, FLUSH_TIMEOUT_MS))]);
}

export function installFatalHandlers(service: 'api' | 'worker'): void {
  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    void recordFatal('unhandledRejection', err, service);
  });

  process.on('uncaughtException', (err) => {
    void recordFatal('uncaughtException', err, service).finally(() => {
      // An uncaught exception leaves the process in an undefined state. Log it,
      // then let it die so the platform restarts a clean one.
      process.exit(1);
    });
  });
}
