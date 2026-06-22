import { startWorkers } from './start.js';
import { registerAutomationSubscribers } from '../automation/index.js';
import { logger, initSentry } from '../utils/index.js';

// Standalone worker process entrypoint (separate Render service).
// Report worker crashes/job failures to Sentry (no-op without SENTRY_DSN).
initSentry('workers');

// No API in this process, so wire the post-call automation subscribers here.
registerAutomationSubscribers();

const workers = startWorkers();

async function gracefulShutdown(): Promise<void> {
  logger.info('Shutting down workers...');
  await Promise.all(workers.map((w) => w.close()));
  logger.info('Workers shut down');
  process.exit(0);
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
