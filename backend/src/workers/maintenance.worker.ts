import { Worker } from 'bullmq';
import { redis, maintenanceQueue } from '../queues/index.js';
import { supabase } from '../db/index.js';
import { env } from '../config/index.js';
import { logger } from '../utils/index.js';

const PURGE_JOB = 'purge';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Register the daily retention purge. Idempotent: the stable repeat jobId means
 * re-running on every worker boot doesn't stack duplicate schedulers.
 */
export async function scheduleMaintenance(): Promise<void> {
  // Idempotent by scheduler id — safe to call on every worker boot without
  // stacking duplicate schedulers. Fires daily at 03:00 (server time).
  await maintenanceQueue.upsertJobScheduler(
    'retention-purge',
    { pattern: '0 3 * * *' },
    { name: PURGE_JOB }
  );
  logger.info({ retentionDays: env.AUDIT_RETENTION_DAYS }, 'Scheduled daily retention purge (03:00)');
}

/**
 * Delete rows past the retention window. Each table is independent so one
 * failure doesn't block the others. Supabase requires a filter on delete, which
 * the `.lt('created_at', …)` provides (never a full-table wipe).
 */
async function processMaintenance(): Promise<void> {
  const cutoff = new Date(Date.now() - env.AUDIT_RETENTION_DAYS * DAY_MS).toISOString();

  const { count: audit, error: e1 } = await supabase
    .from('audit_logs')
    .delete({ count: 'exact' })
    .lt('created_at', cutoff);
  if (e1) logger.error({ error: e1.message }, 'Retention purge failed: audit_logs');

  // Idempotency keys only matter inside the webhook signature window (minutes),
  // so old events are safe to drop.
  const { count: events, error: e2 } = await supabase
    .from('events')
    .delete({ count: 'exact' })
    .lt('created_at', cutoff);
  if (e2) logger.error({ error: e2.message }, 'Retention purge failed: events');

  // Only clear ALREADY-RESOLVED failed jobs; keep open manual_review items.
  const { count: failed, error: e3 } = await supabase
    .from('failed_jobs')
    .delete({ count: 'exact' })
    .eq('status', 'resolved')
    .lt('created_at', cutoff);
  if (e3) logger.error({ error: e3.message }, 'Retention purge failed: failed_jobs');

  logger.info(
    {
      cutoff,
      retentionDays: env.AUDIT_RETENTION_DAYS,
      audit_logs: audit ?? 0,
      events: events ?? 0,
      resolved_failed_jobs: failed ?? 0,
    },
    'Retention purge complete'
  );
}

export function startMaintenanceWorker(): Worker {
  // Queue name is 'maintenance'; the repeatable job's name is PURGE_JOB.
  return new Worker('maintenance', processMaintenance, {
    connection: redis,
    concurrency: 1,
  });
}
