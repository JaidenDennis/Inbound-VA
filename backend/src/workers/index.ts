import { startCrmSyncWorker } from './crm-sync.worker.js';
import { startNotificationsWorker } from './notifications.worker.js';
import { startCallProcessingWorker } from './call-processing.worker.js';
import { startTranscriptProcessingWorker } from './transcript-processing.worker.js';
import { startAnalyticsWorker } from './analytics.worker.js';
import { startBookingWorker } from './booking.worker.js';
import { logger } from '../utils/index.js';

const workers = [
  startCrmSyncWorker(),
  startNotificationsWorker(),
  startCallProcessingWorker(),
  startTranscriptProcessingWorker(),
  startAnalyticsWorker(),
  startBookingWorker(),
];

logger.info(`Started ${workers.length} workers`);

async function gracefulShutdown(): Promise<void> {
  logger.info('Shutting down workers...');
  await Promise.all(workers.map((w) => w.close()));
  logger.info('Workers shut down');
  process.exit(0);
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
