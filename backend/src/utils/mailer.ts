import nodemailer, { type SendMailOptions } from 'nodemailer';
import { env } from '../config/index.js';
import { logger } from './logger.js';

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
 * Send an email. If SMTP isn't configured (no SMTP_PASS), this is a logged no-op
 * so notification jobs still COMPLETE (and their staff_notifications rows
 * persist) instead of hanging/failing on every send. Set SMTP_PASS to enable
 * real delivery; if the server is then unreachable, the timeouts above make the
 * send fail fast (job fails → retries → failed_jobs) rather than hang.
 */
export async function sendMail(opts: SendMailOptions): Promise<void> {
  if (!SMTP_CONFIGURED) {
    logger.warn({ to: opts.to, subject: opts.subject }, 'SMTP not configured (SMTP_PASS unset) — email skipped');
    return;
  }
  await transport.sendMail(opts);
}
