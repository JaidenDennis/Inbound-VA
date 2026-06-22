import type { Worker } from 'bullmq';
import { startCrmSyncWorker } from './crm-sync.worker.js';
import { startNotificationsWorker } from './notifications.worker.js';
import { startCallProcessingWorker } from './call-processing.worker.js';
import { startTranscriptProcessingWorker } from './transcript-processing.worker.js';
import { startAnalyticsWorker } from './analytics.worker.js';
import { startBookingWorker } from './booking.worker.js';
import { startMaintenanceWorker, scheduleMaintenance } from './maintenance.worker.js';
import { onFinalFailure } from './failure-alerts.js';
import { logger } from '../utils/index.js';

/**
 * Start every BullMQ worker, wire centralized terminal-failure handling, and
 * register the daily retention purge. Shared by the standalone worker entrypoint
 * (workers/index.ts) and the co-located mode (server.ts, RUN_WORKERS_IN_API).
 *
 * The CALLER owns automation-subscriber registration (the API does it once in
 * buildApp; the standalone entrypoint does it itself) and process shutdown — so
 * co-locating never double-registers event handlers.
 */
export function startWorkers(): Worker[] {
  const workers: Worker[] = [
    startCrmSyncWorker(),
    startNotificationsWorker(),
    startCallProcessingWorker(),
    startTranscriptProcessingWorker(),
    startAnalyticsWorker(),
    startBookingWorker(),
    startMaintenanceWorker(),
  ];

  // Centralized terminal-failure handling for EVERY queue (`w.name` = queue name).
  for (const w of workers) {
    w.on('failed', (job, err) => {
      void onFinalFailure(w.name, job, err);
    });
  }

  scheduleMaintenance().catch((err) => logger.error({ err }, 'Failed to schedule maintenance'));

  logger.info(`Started ${workers.length} workers`);
  return workers;
}
