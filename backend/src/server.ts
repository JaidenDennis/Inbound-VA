import type { Worker } from 'bullmq';
import { buildApp } from './app.js';
import { env } from './config/index.js';
import { logger } from './utils/index.js';

async function start(): Promise<void> {
  const app = await buildApp();

  // Budget mode: co-locate the BullMQ workers in the API process so background
  // jobs (emails, automations, retention, alerts) run without a separate paid
  // worker service. buildApp already registered the automation subscribers, so
  // startWorkers must NOT (avoids double-firing). Only viable if the API is
  // always-on. Default off — workers normally run as their own service.
  let workers: Worker[] = [];
  if (env.RUN_WORKERS_IN_API) {
    const { startWorkers } = await import('./workers/start.js');
    workers = startWorkers();
    logger.info('Workers co-located in the API process (RUN_WORKERS_IN_API=true)');
  }

  const gracefulShutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    await app.close();
    await Promise.all(workers.map((w) => w.close()));
    logger.info('Server closed');
    process.exit(0);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'Gravvia Engage API started');
  } catch (err) {
    logger.error({ err }, 'Failed to start server');
    process.exit(1);
  }
}

start();
