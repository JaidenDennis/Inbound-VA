import nodemailer from 'nodemailer';
import { env } from '../config/index.js';

// Single shared SMTP transport, reused by the notifications worker and ops
// failure alerts so SMTP config lives in one place.
export const mailer = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
});
