import { Worker } from 'bullmq';
import { redis, maintenanceQueue } from '../queues/index.js';
import { supabase } from '../db/index.js';
import { env } from '../config/index.js';
import { logger, sendMail } from '../utils/index.js';
import { systemErrorService } from '../services/systemError.service.js';
import { systemAlertService } from '../services/systemAlert.service.js';
import { ticketService } from '../services/ticket.service.js';

const PURGE_JOB = 'purge';
const SLA_JOB = 'sla-sweep';
const DAY_MS = 24 * 60 * 60 * 1000;
/** Fixed 90 days — not tied to AUDIT_RETENTION_DAYS. See processMaintenance. */
const SYSTEM_ERROR_RETENTION_DAYS = 90;

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

  // SLA breaches need catching within minutes, not once a day. A sweep every
  // five minutes is cheap (one indexed UPDATE) and keeps the queue honest.
  await maintenanceQueue.upsertJobScheduler(
    'sla-sweep',
    { pattern: '*/5 * * * *' },
    { name: SLA_JOB }
  );

  logger.info({ retentionDays: env.AUDIT_RETENTION_DAYS }, 'Scheduled retention purge (03:00) and SLA sweep (5m)');
}

/**
 * Flag tickets past their first-response deadline and tell whoever owns them.
 * An unassigned breach emails ALERT_EMAIL instead — nobody owning it is exactly
 * the case that needs escalating.
 */
async function processSlaSweep(): Promise<void> {
  const breached = await ticketService.sweepBreaches();
  if (breached.length === 0) return;

  logger.warn({ count: breached.length }, 'Tickets breached their response SLA');

  for (const ticket of breached) {
    const recipient = await resolveBreachRecipient(ticket.assigned_to);
    if (!recipient) continue;
    try {
      await sendMail({
        from: env.EMAIL_FROM,
        to: recipient,
        subject: `[Gravvia] SLA breached: ${ticket.subject}`,
        text:
          `A support ticket passed its first-response deadline without a reply.\n\n` +
          `Subject:  ${ticket.subject}\n` +
          `Priority: ${ticket.priority}\n` +
          `Due:      ${ticket.sla_response_due_at}\n\n` +
          `${env.DASHBOARD_URL}/dashboard/support/${ticket.id}`,
      });
    } catch (err) {
      logger.error({ err, ticketId: ticket.id }, 'Failed to send SLA breach email');
    }
  }
}

async function resolveBreachRecipient(assignedTo: string | null): Promise<string | null> {
  if (!assignedTo) return env.ALERT_EMAIL ?? null;
  const { data } = await supabase.from('users').select('email').eq('id', assignedTo).maybeSingle();
  return (data as { email: string } | null)?.email ?? env.ALERT_EMAIL ?? null;
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

  // system_errors keeps its own 90-day window regardless of review state. It is
  // the highest-volume table in the schema — one bad deploy can add thousands of
  // rows in minutes — so it must not inherit the (longer) audit retention.
  const purgedErrors = await systemErrorService.purgeOlderThan(SYSTEM_ERROR_RETENTION_DAYS);

  // Close auto-opened tickets whose fault has stopped and that nobody picked up,
  // so the support queue reflects real work rather than resolved noise.
  const autoClosed = await systemAlertService.autoCloseQuietTickets();

  logger.info(
    {
      cutoff,
      retentionDays: env.AUDIT_RETENTION_DAYS,
      audit_logs: audit ?? 0,
      events: events ?? 0,
      resolved_failed_jobs: failed ?? 0,
      system_errors: purgedErrors,
      auto_closed_tickets: autoClosed,
    },
    'Retention purge complete'
  );
}

export function startMaintenanceWorker(): Worker {
  // One worker, two schedules: the nightly purge and the five-minute SLA sweep.
  // Dispatch on job name so they cannot be confused for one another.
  return new Worker(
    'maintenance',
    async (job) => {
      if (job.name === SLA_JOB) return processSlaSweep();
      return processMaintenance();
    },
    { connection: redis, concurrency: 1 }
  );
}
