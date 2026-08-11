import nodemailer, { type SendMailOptions } from 'nodemailer';
import { env } from '../config/index.js';
import { logger } from './logger.js';
import { systemErrorService } from '../services/systemError.service.js';

// Fail fast instead of hanging a worker job forever when SMTP is missing or
// unreachable. A hung sendMail holds a worker concurrency slot indefinitely and
// eventually wedges the notifications queue, so bound every phase of the send.
const SMTP_TIMEOUT_MS = 10_000;
const SMTP_CONFIGURED = Boolean(env.SMTP_PASS);

const transport = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  connectionTimeout: SMTP_TIMEOUT_MS, // TCP connect
  greetingTimeout: SMTP_TIMEOUT_MS, // server greeting after connect
  socketTimeout: SMTP_TIMEOUT_MS, // inactivity once connected
});

/**
 * Has the "SMTP is not configured" warning already been recorded this process?
 *
 * One row, not one per send. Every queued notification, every alert and every
 * SLA breach calls sendMail; recording each skip would push a hundred identical
 * rows into the console and bury the incidents that matter.
 */
let unconfiguredReported = false;

/** Test seam — lets a test observe first-call behaviour more than once. */
export function __resetMailerWarning(): void {
  unconfiguredReported = false;
}

/**
 * Send an email.
 *
 * Never throws. sendMail is called from queue workers whose jobs must still
 * complete and from alert evaluation that must still record its events, so a
 * dead mailer must not cascade. What changed is that it is no longer SILENT:
 * an unconfigured transport and a failing one both leave a system_errors row,
 * visible at /dashboard/system.
 *
 * This distinction is the whole point. Before, `SMTP_PASS` unset made this a
 * logged no-op, so "the client never got the alert" and "everything is fine"
 * looked identical from the dashboard.
 */
export async function sendMail(opts: SendMailOptions): Promise<void> {
  if (!SMTP_CONFIGURED) {
    logger.warn({ to: opts.to, subject: opts.subject }, 'SMTP not configured (SMTP_PASS unset) — email skipped');
    if (!unconfiguredReported) {
      unconfiguredReported = true;
      void systemErrorService.record({
        source: 'email',
        severity: 'warn',
        error: {
          name: 'SmtpNotConfigured',
          message:
            'SMTP_PASS is unset, so no email is being sent. Notifications, client alerts and SLA breach emails are all being skipped.',
        },
        context: { host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER },
      });
    }
    return;
  }

  try {
    await transport.sendMail(opts);
  } catch (err) {
    logger.error({ err, to: opts.to, subject: opts.subject }, 'Email send failed');
    void systemErrorService.record({
      source: 'email',
      severity: 'error',
      error: err as Error,
      // Recipients are deliberately omitted: they are personal data and the
      // subject is enough to identify which send failed.
      context: { subject: String(opts.subject ?? ''), host: env.SMTP_HOST },
    });
  }
}
