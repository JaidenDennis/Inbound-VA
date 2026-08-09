import { supabase } from '../db/index.js';

/**
 * CSV of the owner clusters, built server-side.
 *
 * The reason this is not a front-end concern: the tables on the Business page
 * are paginated and capped, so a client-side "export" would write out whatever
 * happened to be on screen and call it the report. Someone would then reconcile
 * that against their books and find it short. Exports read the same sources the
 * page reads, unpaginated.
 *
 * CSV only. PDF is deferred — it needs a rendering dependency and a layout for
 * every cluster, and CSV is the half that actually gets opened, edited, and
 * pivoted. Recorded as a deferral rather than shipped badly.
 */

export type ExportKind = 'calls' | 'appointments' | 'demand' | 'callbacks';

export const EXPORT_KINDS: ExportKind[] = ['calls', 'appointments', 'demand', 'callbacks'];

/**
 * Escape one CSV field.
 *
 * The leading-character guard is not decoration: a caller called `=cmd|...` or a
 * service named `+SUM(A1)` is interpreted as a formula by Excel and Sheets when
 * the file is opened. Prefixing with an apostrophe keeps the value visible and
 * inert. This is a real attack against exported CRM data, and the export is
 * exactly where user-supplied text meets a spreadsheet.
 */
function field(value: unknown): string {
  if (value === null || value === undefined) return '';

  let text = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;

  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  // CRLF and a UTF-8 BOM: Excel on Windows misreads a plain LF UTF-8 file as
  // the local codepage and mangles every accented name in it.
  const body = [headers, ...rows].map((row) => row.map(field).join(',')).join('\r\n');
  return `﻿${body}\r\n`;
}

interface ExportInput {
  clientId: string;
  from: string;
  to: string;
}

interface ExportOutput {
  filename: string;
  csv: string;
  rowCount: number;
}

async function callsExport({ clientId, from, to }: ExportInput): Promise<ExportOutput> {
  const { data } = await supabase
    .from('client_call_log')
    .select(
      'id, started_at, from_number, direction, call_status, duration_seconds, outcome, user_sentiment, appointment_booked, missed_call_recovered, has_transcript'
    )
    .eq('client_id', clientId)
    .gte('started_at', from)
    .lte('started_at', to)
    .order('started_at', { ascending: false });

  const rows = (data ?? []) as Array<Record<string, unknown>>;

  return {
    filename: 'calls',
    rowCount: rows.length,
    // Transcript content is NOT exported. It sits behind its own grant and its
    // own audit trail, and a CSV leaves both behind the moment it is emailed on.
    csv: toCsv(
      ['Call ID', 'Started', 'From', 'Direction', 'Status', 'Duration (s)', 'Outcome', 'Sentiment', 'Booked', 'Recovered', 'Has transcript'],
      rows.map((r) => [
        r.id, r.started_at, r.from_number, r.direction, r.call_status,
        r.duration_seconds, r.outcome, r.user_sentiment,
        r.appointment_booked ? 'yes' : 'no',
        r.missed_call_recovered ? 'yes' : 'no',
        r.has_transcript ? 'yes' : 'no',
      ])
    ),
  };
}

async function appointmentsExport({ clientId, from, to }: ExportInput): Promise<ExportOutput> {
  const { data } = await supabase
    .from('appointments')
    .select('id, title, service_type, status, start_time, end_time, contact_id, external_calendar_id, created_at')
    .eq('client_id', clientId)
    .gte('start_time', from)
    .lte('start_time', to)
    .order('start_time', { ascending: false });

  const rows = (data ?? []) as Array<Record<string, unknown>>;

  return {
    filename: 'appointments',
    rowCount: rows.length,
    csv: toCsv(
      ['Appointment ID', 'Title', 'Service', 'Status', 'Starts', 'Ends', 'Contact', 'Calendar ID', 'Created'],
      rows.map((r) => [
        r.id, r.title, r.service_type, r.status, r.start_time, r.end_time,
        r.contact_id, r.external_calendar_id, r.created_at,
      ])
    ),
  };
}

async function demandExport({ clientId, from, to }: ExportInput): Promise<ExportOutput> {
  // One file, three sections. Splitting demand across three downloads makes the
  // person exporting it do the joining, and they are exporting precisely because
  // they want it all in one place.
  const [reasons, referrals, lost] = await Promise.all([
    supabase.rpc('report_call_reasons', { p_client_id: clientId, p_from: from, p_to: to }),
    supabase.rpc('report_referrals', { p_client_id: clientId, p_from: from, p_to: to }),
    supabase.rpc('report_lost_demand', { p_client_id: clientId, p_from: from, p_to: to }),
  ]);

  const rows: unknown[][] = [];
  for (const r of (reasons.data ?? []) as Array<Record<string, unknown>>) {
    rows.push(['Call reason', r.reason, r.count, '']);
  }
  for (const r of (referrals.data ?? []) as Array<Record<string, unknown>>) {
    rows.push(['Referral source', r.source, r.count, '']);
  }
  for (const r of (lost.data ?? []) as Array<Record<string, unknown>>) {
    // Blank, not zero, where the service has no price — the same rule the page
    // follows. A spreadsheet full of zeroes sums to a number someone will quote.
    rows.push(['Requested, not offered', r.service, r.requests, r.estimated_value ?? '']);
  }

  return {
    filename: 'demand',
    rowCount: rows.length,
    csv: toCsv(['Category', 'Value', 'Count', 'Estimated value'], rows),
  };
}

async function callbacksExport({ clientId, from, to }: ExportInput): Promise<ExportOutput> {
  const { data } = await supabase
    .from('callback_requests')
    .select('id, caller_name, phone, reason, preferred_time, status, created_at')
    .eq('client_id', clientId)
    .gte('created_at', from)
    .lte('created_at', to)
    .order('created_at', { ascending: false });

  const rows = (data ?? []) as Array<Record<string, unknown>>;

  return {
    filename: 'callbacks',
    rowCount: rows.length,
    csv: toCsv(
      ['Callback ID', 'Caller', 'Phone', 'Reason', 'Preferred time', 'Status', 'Requested'],
      rows.map((r) => [r.id, r.caller_name, r.phone, r.reason, r.preferred_time, r.status, r.created_at])
    ),
  };
}

const BUILDERS: Record<ExportKind, (input: ExportInput) => Promise<ExportOutput>> = {
  calls: callsExport,
  appointments: appointmentsExport,
  demand: demandExport,
  callbacks: callbacksExport,
};

export async function buildExport(kind: ExportKind, input: ExportInput): Promise<ExportOutput> {
  return BUILDERS[kind](input);
}

export const exportService = { buildExport, toCsv, EXPORT_KINDS };
