import type { Job } from 'bullmq';
import { supabase } from '../db/index.js';
import { env } from '../config/index.js';
import { logger, captureException, mailer } from '../utils/index.js';

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
  if (job.attemptsMade < maxAttempts) return; // more retries pending — not terminal yet

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

  await sendAlertEmail(queueName, job, err);
}

async function sendAlertEmail(queueName: string, job: Job, err: Error): Promise<void> {
  if (!env.ALERT_EMAIL) return;
  try {
    await mailer.sendMail({
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
