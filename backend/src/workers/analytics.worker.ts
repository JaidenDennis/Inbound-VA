import { Worker, type Job } from 'bullmq';
import { redis } from '../queues/index.js';
import { logger } from '../utils/index.js';
import type { AnalyticsJobData } from '../types/index.js';

async function processAnalytics(job: Job<AnalyticsJobData>): Promise<void> {
  // Analytics pipeline – currently a no-op placeholder.
  // Future: write to an analytics store (ClickHouse, BigQuery, etc.)
  logger.debug({ jobId: job.id, eventType: job.data.eventType }, 'Analytics event processed');
}

export function startAnalyticsWorker(): Worker<AnalyticsJobData> {
  return new Worker<AnalyticsJobData>('analytics', processAnalytics, {
    connection: redis,
    concurrency: 20,
  });
}
