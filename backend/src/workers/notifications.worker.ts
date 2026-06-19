import { Worker, type Job } from 'bullmq';
import nodemailer from 'nodemailer';
import { redis } from '../queues/index.js';
import { supabase } from '../db/index.js';
import { env } from '../config/index.js';
import { logger } from '../utils/index.js';
import type { NotificationJobData } from '../types/index.js';

const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
});

async function processNotification(job: Job<NotificationJobData>): Promise<void> {
  const { clientId, type, recipients, subject, body, callId, metadata } = job.data;

  for (const recipient of recipients) {
    await transporter.sendMail({
      from: env.EMAIL_FROM,
      to: recipient,
      subject,
      text: body,
      html: `<pre style="font-family:sans-serif">${body}</pre>`,
    });
  }

  await supabase.from('staff_notifications').insert({
    client_id: clientId,
    call_id: callId ?? null,
    type,
    status: 'pending',
    message: body,
    recipient_email: recipients.join(', '),
    metadata: metadata ?? {},
  });

  logger.info({ jobId: job.id, type, recipients }, 'Notification sent');
}

export function startNotificationsWorker(): Worker<NotificationJobData> {
  return new Worker<NotificationJobData>('notifications', processNotification, {
    connection: redis,
    concurrency: 10,
  });
}
