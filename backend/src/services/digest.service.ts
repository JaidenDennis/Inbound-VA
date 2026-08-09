import { supabase } from '../db/index.js';
import { env } from '../config/index.js';
import { logger, sendMail } from '../utils/index.js';
import { buildExport } from './export.service.js';
import { periodInsights } from '../ai/insights.service.js';
import { readBranding, brandingHeaderStyle } from './branding.service.js';

/**
 * The weekly digest.
 *
 * For owners who never log in, this IS the product. Everything else in the
 * dashboard is available to someone who chooses to go looking; the digest is
 * what reaches the person who does not.
 *
 * That framing decides the content. It is not a summary of the dashboard — a
 * wall of figures in an email gets archived. It leads with the one number that
 * answers "was this worth it", says what changed, and lists what is waiting on a
 * person. Everything else is in the attached CSV for whoever wants it.
 *
 * NULL SURVIVES HERE TOO. A figure that was not measured says so, in words, and
 * never arrives as a zero. An owner who reads "$0 revenue" when the truth is "no
 * service prices are configured" makes a decision on a number we invented.
 */

const WEEK_MS = 7 * 86_400_000;

interface DigestRecipientRow {
  client_id: string;
  name: string;
  emails: string[];
}

/** Every client with somewhere to send a digest. */
export async function digestRecipients(): Promise<DigestRecipientRow[]> {
  const { data } = await supabase
    .from('client_settings')
    .select('client_id, notification_emails, clients!inner(name, status)');

  return ((data ?? []) as Array<Record<string, unknown>>)
    .map((row) => {
      const client = row.clients as { name: string; status: string } | null;
      return {
        client_id: String(row.client_id),
        name: client?.name ?? 'your account',
        status: client?.status ?? 'active',
        emails: ((row.notification_emails as string[] | null) ?? []).filter(Boolean),
      };
    })
    // A disabled client is one we stopped serving; still emailing them weekly is
    // the kind of detail that turns a cancellation into a complaint.
    .filter((row) => row.status === 'active' && row.emails.length > 0)
    .map(({ client_id, name, emails }) => ({ client_id, name, emails }));
}

function line(label: string, value: number | null, unit = ''): string {
  return value === null || value === undefined
    ? `  ${label}: not measured`
    : `  ${label}: ${unit}${value}`;
}

export interface DigestBody {
  subject: string;
  text: string;
  html: string;
  /** Null when there is genuinely nothing to report — see `buildDigest`. */
  csv: string | null;
}

/**
 * Compose one client's digest.
 *
 * Returns null when the week had no calls at all. A weekly email reporting that
 * nothing happened, every week, is how a sender gets muted — and the owner of a
 * silent agent needs a conversation, not a newsletter.
 */
export async function buildDigest(clientId: string, name: string, now = new Date()): Promise<DigestBody | null> {
  const to = now.toISOString();
  const from = new Date(now.getTime() - WEEK_MS).toISOString();

  const rpc = async (fn: string) => {
    const { data, error } = await supabase.rpc(fn, { p_client_id: clientId, p_from: from, p_to: to });
    if (error) throw new Error(`${fn}: ${error.message}`);
    return ((data ?? []) as Array<Record<string, unknown>>)[0] ?? {};
  };

  const [money, trust] = await Promise.all([rpc('report_money'), rpc('report_trust')]);

  const totalCalls = Number(trust.total_calls ?? 0);
  if (totalCalls === 0) return null;

  const transferred = Number(trust.transferred_calls ?? 0);
  const containment = totalCalls > 0 ? Math.round(((totalCalls - transferred) / totalCalls) * 1000) / 10 : null;
  const booked = Number(money.booked_appointments ?? 0);
  const revenue = money.attributed_revenue === null || money.attributed_revenue === undefined
    ? null
    : Math.round(Number(money.attributed_revenue));
  const hoursConfigured = money.hours_configured === true;
  const afterHours = hoursConfigured ? Number(money.after_hours_calls ?? 0) : null;

  // Work waiting on a person — the part of the digest that produces an action
  // rather than a feeling.
  const { data: queue } = await supabase
    .from('manager_queue')
    .select('kind')
    .eq('client_id', clientId);
  const waiting = (queue ?? []).length;

  const insight = await periodInsights(clientId, from, to);
  const headlines = insight.insights.slice(0, 3);

  const dateLabel = `${new Date(from).toLocaleDateString()} – ${new Date(to).toLocaleDateString()}`;

  const text = [
    `Your week with the agent — ${dateLabel}`,
    '',
    `  Calls answered: ${totalCalls}`,
    line('Handled without a person', containment, ''),
    `  Appointments booked: ${booked}`,
    revenue === null
      ? '  Attributed revenue: not measured (no booked appointment matched a priced service)'
      : `  Attributed revenue: $${revenue} (estimated from your service prices)`,
    afterHours === null
      ? '  After-hours calls: not measured (your opening hours are not set)'
      : `  After-hours calls: ${afterHours}`,
    '',
    waiting > 0
      ? `${waiting} item${waiting === 1 ? '' : 's'} waiting on someone: ${env.DASHBOARD_URL}/dashboard/queue`
      : 'Nothing is waiting on anyone. Your queue is clear.',
    '',
    ...(headlines.length > 0
      ? ['What changed:', ...headlines.map((i) => `  • ${i.headline} — ${i.detail}`), '']
      : []),
    `Full figures: ${env.DASHBOARD_URL}/dashboard/business`,
    'The attached CSV has every call in the period.',
  ].join('\n');

  const branding = await readBranding(clientId);
  const wordmark = branding.wordmark_text ?? 'Gravvia';

  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;color:#1a1f1f">
  <div style="${brandingHeaderStyle(branding)}">
    <span style="font-weight:600;font-size:15px">${escapeHtml(wordmark)}</span>
  </div>
  <h1 style="font-size:18px;margin:24px 0 4px">Your week with the agent</h1>
  <p style="color:#6b7575;font-size:13px;margin:0 0 20px">${escapeHtml(dateLabel)} · ${escapeHtml(name)}</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    ${htmlRow('Calls answered', String(totalCalls))}
    ${htmlRow('Handled without a person', containment === null ? 'not measured' : `${containment}%`)}
    ${htmlRow('Appointments booked', String(booked))}
    ${htmlRow('Attributed revenue', revenue === null ? 'not measured' : `$${revenue} (est.)`)}
    ${htmlRow('After-hours calls', afterHours === null ? 'not measured — set your opening hours' : String(afterHours))}
  </table>
  <p style="font-size:14px;margin:20px 0 0">
    ${waiting > 0
      ? `<a href="${env.DASHBOARD_URL}/dashboard/queue" style="color:#0f766e">${waiting} item${waiting === 1 ? '' : 's'} waiting on someone</a>`
      : 'Nothing is waiting on anyone. Your queue is clear.'}
  </p>
  ${headlines.length > 0
    ? `<h2 style="font-size:14px;margin:24px 0 8px">What changed</h2><ul style="font-size:14px;padding-left:18px;margin:0">${headlines
        .map((i) => `<li style="margin-bottom:6px"><strong>${escapeHtml(i.headline)}</strong> — ${escapeHtml(i.detail)}</li>`)
        .join('')}</ul>`
    : ''}
  <p style="font-size:12px;color:#6b7575;margin-top:28px;border-top:1px solid #e3e7e7;padding-top:12px">
    Revenue is estimated from the prices in your services list, not from invoices.
    <a href="${env.DASHBOARD_URL}/dashboard/business" style="color:#0f766e">See the full figures</a>.
  </p>
</div>`;

  let csv: string | null = null;
  try {
    csv = (await buildExport('calls', { clientId, from, to })).csv;
  } catch (err) {
    // An attachment failure must not cost the whole digest.
    logger.warn({ err, clientId }, 'digest CSV attachment failed; sending without it');
  }

  return { subject: `Your week with the agent — ${name}`, text, html, csv };
}

function htmlRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:6px 0;color:#6b7575">${escapeHtml(label)}</td>
    <td style="padding:6px 0;text-align:right;font-weight:600">${escapeHtml(value)}</td>
  </tr>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Build and send every client's digest. One failure never blocks the rest. */
export async function sendWeeklyDigests(now = new Date()): Promise<{ sent: number; skipped: number }> {
  const recipients = await digestRecipients();
  let sent = 0;
  let skipped = 0;

  for (const row of recipients) {
    try {
      const digest = await buildDigest(row.client_id, row.name, now);
      if (!digest) {
        skipped += 1;
        continue;
      }

      await sendMail({
        from: env.EMAIL_FROM,
        to: row.emails.join(', '),
        subject: digest.subject,
        text: digest.text,
        html: digest.html,
        ...(digest.csv
          ? { attachments: [{ filename: `gravvia-calls-${now.toISOString().slice(0, 10)}.csv`, content: digest.csv }] }
          : {}),
      });

      sent += 1;
    } catch (err) {
      logger.error({ err, clientId: row.client_id }, 'weekly digest failed');
    }
  }

  return { sent, skipped };
}

export const digestService = { sendWeeklyDigests, buildDigest, digestRecipients };
