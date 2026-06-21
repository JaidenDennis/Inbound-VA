import { startCrmSyncWorker } from './crm-sync.worker.js';
import { startNotificationsWorker } from './notifications.worker.js';
import { startCallProcessingWorker } from './call-processing.worker.js';
import { startTranscriptProcessingWorker } from './transcript-processing.worker.js';
import { startAnalyticsWorker } from './analytics.worker.js';
import { startBookingWorker } from './booking.worker.js';
import { startMaintenanceWorker, scheduleMaintenance } from './maintenance.worker.js';
import { onFinalFailure } from './failure-alerts.js';
import { registerAutomationSubscribers } from '../automation/index.js';
import { logger, initSentry } from '../utils/index.js';

// Report worker crashes/job failures to Sentry (no-op without SENTRY_DSN).
initSentry('workers');

// Booking can be created inside the worker process; ensure follow-ups fire there too.
registerAutomationSubscribers();

const workers = [
  startCrmSyncWorker(),
  startNotificationsWorker(),
  startCallProcessingWorker(),
  startTranscriptProcessingWorker(),
  startAnalyticsWorker(),
  startBookingWorker(),
  startMaintenanceWorker(),
];

// Centralized terminal-failure handling for EVERY queue: records exhausted jobs
// in failed_jobs and alerts (Sentry + email). `w.name` is the queue name.
for (const w of workers) {
  w.on('failed', (job, err) => {
    void onFinalFailure(w.name, job, err);
  });
}

// Register the daily retention purge (idempotent).
scheduleMaintenance().catch((err) => logger.error({ err }, 'Failed to schedule maintenance'));

logger.info(`Started ${workers.length} workers`);

async function gracefulShutdown(): Promise<void> {
  logger.info('Shutting down workers...');
  await Promise.all(workers.map((w) => w.close()));
  logger.info('Workers shut down');
  process.exit(0);
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
