/**
 * The console's terminology glossary.
 *
 * The backend's vocabulary is not the operator's. `warn`, `fatal`, `startup`,
 * and a 64-character fingerprint are precise names for a database column and
 * poor names for a thing a human has to make a decision about. Every one of
 * them was being rendered straight to screen.
 *
 * One module so the same code always reads the same way, everywhere. Adding a
 * new backend enum means adding it here, not inventing a label at the call site.
 *
 * `label` is what the operator reads. `hint` answers the implicit question the
 * label raises, and is shown through progressive disclosure rather than crowding
 * the row. Unknown codes fall back to a humanised form instead of leaking raw.
 */

/** `snake_case` / `SCREAMING_CASE` -> "Sentence case", for codes we don't know. */
export function humanise(code: string): string {
  const spaced = code.replace(/[_-]+/g, ' ').trim().toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

interface Term {
  label: string;
  hint?: string;
}

/** How bad is it. Drives the lamps. */
export const SEVERITY: Record<string, Term> = {
  fatal: {
    label: 'Fatal',
    hint: 'The process itself failed, not just one request. Usually needs someone now.',
  },
  error: {
    label: 'Error',
    hint: 'A request or background job failed. The work did not complete.',
  },
  warn: {
    label: 'Warning',
    hint: 'Something degraded but still completed. Worth watching, not usually urgent.',
  },
  info: { label: 'Info', hint: 'Recorded for context. Nothing failed.' },
};

/** What kind of thing was recorded. */
export const ACTIVITY_KIND: Record<string, Term> = {
  system_error: { label: 'Error', hint: 'An exception captured from the API or a worker.' },
  failed_job: {
    label: 'Failed job',
    hint: 'A queued job exhausted its retries. It can be re-queued from here.',
  },
  crm_sync: { label: 'CRM sync', hint: 'An attempt to push a contact, note, or transcript to a CRM.' },
  automation_run: { label: 'Automation', hint: 'A configured automation rule that fired.' },
  event: { label: 'Event', hint: 'A normalised provider event, such as a call starting or ending.' },
};

/** Where it came from. */
export const ACTIVITY_SOURCE: Record<string, Term> = {
  api: { label: 'API', hint: 'Raised while handling an inbound request from the dashboard or a client.' },
  worker: { label: 'Worker', hint: 'Raised in a background queue worker, away from any request.' },
  webhook: { label: 'Webhook', hint: 'Raised while processing a provider callback, such as Retell.' },
  startup: { label: 'Startup', hint: 'Raised while the process was booting. Often configuration.' },
  email: { label: 'Email', hint: 'Raised sending mail: an unconfigured SMTP transport, or a send that failed.' },
};

/** Whether a human has looked at it. */
export const REVIEW_STATE: Record<'reviewed' | 'unreviewed', Term> = {
  reviewed: {
    label: 'Reviewed',
    hint: 'Someone has seen this and accepted it. It does not mean the cause is fixed.',
  },
  unreviewed: {
    label: 'Needs attention',
    hint: 'Nobody has looked at this yet.',
  },
};

/** Whether the tenant is live. */
export const CLIENT_STATUS: Record<string, Term> = {
  active: { label: 'Active', hint: 'Inbound calls are matched to this client.' },
  inactive: { label: 'Inactive', hint: 'Inbound calls are not matched to this client.' },
  suspended: { label: 'Suspended', hint: 'Access is withheld. Inbound calls are not matched.' },
};

/** Where a failed job stands. */
export const JOB_STATUS: Record<string, Term> = {
  pending: { label: 'Awaiting review', hint: 'Retries are exhausted. A human decides what happens next.' },
  resolved: { label: 'Re-queued', hint: 'A new job was created from this one’s payload.' },
  ignored: { label: 'Ignored', hint: 'Deliberately left unresolved.' },
};

/** The one term that has no plain-language equivalent, so it gets defined. */
export const FINGERPRINT_HINT =
  'A fingerprint groups every occurrence of the same underlying error, so a fault that fired 96 times is one thing to decide about rather than 96.';

function lookup(table: Record<string, Term>, code: string | null | undefined): Term {
  if (!code) return { label: '—' };
  return table[code] ?? { label: humanise(code) };
}

export const severityTerm = (c?: string | null) => lookup(SEVERITY, c);
export const kindTerm = (c?: string | null) => lookup(ACTIVITY_KIND, c);
export const sourceTerm = (c?: string | null) => lookup(ACTIVITY_SOURCE, c);
export const clientStatusTerm = (c?: string | null) => lookup(CLIENT_STATUS, c);
export const jobStatusTerm = (c?: string | null) => lookup(JOB_STATUS, c);

/**
 * Fingerprints are 64 hex characters. The operator never types one and never
 * reads one aloud; they use it to tell two groups apart. Twelve characters does
 * that, and the full value stays available on the element for copying.
 */
export function shortFingerprint(fp: string | null | undefined): string {
  if (!fp) return '—';
  return fp.length <= 12 ? fp : fp.slice(0, 12);
}
