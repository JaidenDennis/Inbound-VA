import type { Job } from 'bullmq';
import { supabase } from '../db/index.js';
import { env } from '../config/index.js';
import { logger, captureException, sendMail } from '../utils/index.js';
import { systemErrorService, fingerprintFor } from '../services/systemError.service.js';
import { systemAlertService } from '../services/systemAlert.service.js';

/**
 * Shared terminal-failure handler for EVERY queue. BullMQ fires 'failed' on each
 * attempt; this acts only once retries are exhausted, then:
 *   1. records the job in failed_jobs (status manual_review) → shows in dashboard,
 *   2. reports to Sentry,
 *   3. emails ALERT_EMAIL if configured.
 * Best-effort: it never throws, so alerting problems can't crash a worker.
 */
export async function onFinalFailure(queueName: string, job: Job | undefined, err: Error): Promise<void> {
  if (!job) return;
  const maxAttempts = job.opts.attempts ?? 1;
  // UnrecoverableError fails the job immediately regardless of attempts left
  // (e.g. a CRM 401 that a retry can't fix), so it is always terminal.
  const unrecoverable = err.name === 'UnrecoverableError';
  if (!unrecoverable && job.attemptsMade < maxAttempts) return; // more retries pending — not terminal yet

  logger.error(
    { queue: queueName, jobId: job.id, attempts: job.attemptsMade, err },
    'Job exhausted retries → MANUAL_REVIEW'
  );
  captureException(err, { queue: queueName, jobId: job.id, jobData: job.data });

  try {
    await supabase.from('failed_jobs').insert({
      queue_name: queueName,
      job_id: String(job.id ?? 'unknown'),
      job_data: (job.data ?? {}) as Record<string, unknown>,
      error_message: err.message,
      attempts: job.attemptsMade,
      status: 'manual_review',
    });
  } catch (e) {
    logger.error({ e, queue: queueName, jobId: job.id }, 'Failed to record failed_job row');
  }

  await recordSystemError(queueName, job, err);
  await sendAlertEmail(queueName, job, err);
}

/**
 * Mirror the terminal failure into system_errors so the console shows queue
 * faults beside API and webhook faults, and open a ticket immediately.
 *
 * `immediate` is right here in a way it would not be for a 500: reaching this
 * function already means the job retried and still failed, so the recurrence
 * threshold has effectively been met.
 */
async function recordSystemError(queueName: string, job: Job, err: Error): Promise<void> {
  const data = (job.data ?? {}) as Record<string, unknown>;
  const clientId =
    (typeof data.clientId === 'string' && data.clientId) ||
    (typeof data.client_id === 'string' && data.client_id) ||
    null;

  await systemErrorService.record({
    source: 'worker',
    severity: 'error',
    clientId,
    route: queueName,
    error: err,
    context: { queue: queueName, jobId: job.id, attempts: job.attemptsMade, jobData: data },
  });

  await systemAlertService.maybeOpenTicket({
    fingerprint: fingerprintFor({
      source: 'worker',
      errorName: err.name || 'Error',
      route: queueName,
      message: err.message ?? '',
    }),
    clientId,
    title: `${queueName} job failed`,
    detail: err.message ?? 'Job exhausted retries',
    immediate: true,
  });
}

async function sendAlertEmail(queueName: string, job: Job, err: Error): Promise<void> {
  if (!env.ALERT_EMAIL) return;
  try {
    await sendMail({
      from: env.EMAIL_FROM,
      to: env.ALERT_EMAIL,
      subject: `[Gravvia] Job needs manual review: ${queueName}`,
      text:
        `A background job exhausted its retries and was marked for manual review.\n\n` +
        `Queue:    ${queueName}\n` +
        `Job ID:   ${job.id}\n` +
        `Attempts: ${job.attemptsMade}\n` +
        `Error:    ${err.message}\n\n` +
        `Data:\n${JSON.stringify(job.data, null, 2)}\n\n` +
        `Review and retry from the dashboard (Settings → Failed Jobs) or POST /admin/retry-job.`,
    });
    logger.info({ queue: queueName, jobId: job.id }, 'Failure alert emailed');
  } catch (e) {
    logger.error({ e, queue: queueName, jobId: job.id }, 'Failed to send failure alert email');
  }
}
