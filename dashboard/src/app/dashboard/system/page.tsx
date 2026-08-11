'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { FilterBar, type FilterSpec } from '@/components/FilterBar';
import { SeverityLamp, ReviewLamp, StatusLamp } from '@/components/StatusLamp';
import { Drawer } from '@/components/Drawer';
import { useSession } from '@/lib/SessionProvider';
import { Layers, List, RefreshCw, ExternalLink, Check, CheckCheck } from 'lucide-react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Hint, HintedHeading } from '@/components/Hint';
import { Table, TableEmpty, TableShell, TBody, TD, TH, THead, TR } from '@/components/Table';
import {
  ACTIVITY_KIND, ACTIVITY_SOURCE, SEVERITY, REVIEW_STATE,
  kindTerm, severityTerm, shortFingerprint, FINGERPRINT_HINT,
} from '@/lib/vocabulary';

interface ActivityRow {
  id: string;
  kind: string;
  source: string;
  severity: string;
  client_id: string | null;
  occurred_at: string;
  title: string;
  detail: string;
  fingerprint: string | null;
  reviewed_at: string | null;
  ref_id: string;
}

interface GroupedRow {
  fingerprint: string;
  errorName: string;
  message: string;
  route: string | null;
  source: string;
  severity: string;
  clientIds: string[];
  count: number;
  firstSeen: string;
  lastSeen: string;
  ticketId: string | null;
  latestSentryEventId: string | null;
}

interface ErrorDetail extends ActivityRow {
  route: string | null;
  method: string | null;
  status_code: number | null;
  stack: string | null;
  context: Record<string, unknown>;
  error_name: string;
  message: string;
  ticket_id: string | null;
}

/** Every option label is read from the shared glossary, so the filter and the
 *  row it filters can never drift apart (they previously did: `startup` was
 *  "Process" in the filter and "Startup" everywhere else). */
const optionsFrom = (table: Record<string, { label: string }>) =>
  Object.entries(table).map(([value, term]) => ({ value, label: term.label }));

const filters: FilterSpec[] = [
  { key: 'kind', label: 'Type', type: 'select', options: optionsFrom(ACTIVITY_KIND) },
  {
    key: 'severity',
    label: 'Severity',
    type: 'select',
    options: optionsFrom(SEVERITY).filter((o) => o.value !== 'info'),
  },
  { key: 'source', label: 'Source', type: 'select', options: optionsFrom(ACTIVITY_SOURCE) },
  {
    key: 'reviewed',
    label: 'Reviewed',
    type: 'select',
    options: [
      { value: 'false', label: REVIEW_STATE.unreviewed.label },
      { value: 'true', label: REVIEW_STATE.reviewed.label },
    ],
  },
  { key: 'q', label: 'Search', type: 'search', placeholder: 'Message contains…' },
];

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function SystemPageInner() {
  const searchParams = useSearchParams();
  const { can } = useSession();
  const canWrite = can('system:write');

  const [view, setView] = useState<'grouped' | 'list'>('grouped');
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [groups, setGroups] = useState<GroupedRow[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<ErrorDetail | null>(null);

  const query = searchParams.toString();

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    const path = view === 'grouped' ? '/system/activity/grouped' : '/system/activity';
    api
      .get(`${path}?${query}`)
      .then((r) => {
        if (view === 'grouped') setGroups(r.data.data ?? []);
        else {
          setRows(r.data.data ?? []);
          setCount(r.data.count ?? 0);
        }
      })
      .catch((e) => setError(e?.response?.data?.error ?? 'Failed to load system activity'))
      .finally(() => setLoading(false));
  }, [query, view]);

  useEffect(load, [load]);

  const openDetail = async (row: ActivityRow) => {
    if (row.kind !== 'system_error') return;
    try {
      const r = await api.get(`/system/errors/${row.ref_id}`);
      setDetail(r.data);
    } catch {
      toast.error('Could not load that error');
    }
  };

  const markReviewed = async (id: string) => {
    try {
      await api.post(`/system/errors/${id}/review`);
      toast.success('Marked reviewed');
      setDetail(null);
      load();
    } catch {
      toast.error('Could not mark reviewed');
    }
  };

  const retryJob = async (refId: string) => {
    try {
      const r = await api.post(`/system/retry/${refId}`);
      toast.success(`Re-queued as job ${r.data.jobId}`);
      load();
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg ?? 'Retry failed');
    }
  };

  const toggleCls = (active: boolean) =>
    `flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 ${
      active ? 'border-primary-200 bg-primary-50 text-primary-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
    }`;

  return (
    <div>
      <PageHeader
        title="System Health"
        description="Errors, failed jobs, and sync failures across every client."
      />

      <div className="mb-4 flex gap-2">
        <button type="button" className={toggleCls(view === 'grouped')} onClick={() => setView('grouped')}
          aria-pressed={view === 'grouped'}>
          <Layers className="h-4 w-4" aria-hidden /> Grouped
        </button>
        <button type="button" className={toggleCls(view === 'list')} onClick={() => setView('list')}
          aria-pressed={view === 'list'}>
          <List className="h-4 w-4" aria-hidden /> All activity
        </button>
      </div>

      <FilterBar filters={filters} />

      {error && (
        <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse border-b border-gray-100 bg-gray-50 last:border-0" />
          ))}
        </div>
      ) : view === 'grouped' ? (
        <GroupedTable groups={groups} canWrite={canWrite} onReviewed={load} />
      ) : (
        <ActivityTable
          rows={rows}
          count={count}
          canWrite={canWrite}
          onOpen={openDetail}
          onRetry={retryJob}
        />
      )}

      <Drawer
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail ? `${detail.error_name}` : ''}
        footer={
          detail && canWrite && !detail.reviewed_at ? (
            <button
              type="button"
              onClick={() => markReviewed(detail.id)}
              className="flex cursor-pointer items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
            >
              <Check className="h-4 w-4" aria-hidden /> Mark reviewed
            </button>
          ) : null
        }
      >
        {detail && <ErrorDetailBody detail={detail} />}
      </Drawer>
    </div>
  );
}

/**
 * The grouped view is where an operator actually decides, because the unit of
 * judgement is the fingerprint, not the row. Clearing a 96-occurrence group one
 * row at a time was the single worst ergonomic failure in the console, so the
 * group carries its own action.
 */
function GroupedTable({
  groups,
  canWrite,
  onReviewed,
}: {
  groups: GroupedRow[];
  canWrite: boolean;
  onReviewed: () => void;
}) {
  const [pending, setPending] = useState<GroupedRow | null>(null);
  const [busy, setBusy] = useState(false);

  const clearGroup = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const r = await api.post('/system/errors/review-group', { fingerprint: pending.fingerprint });
      const n = r.data?.reviewed ?? 0;
      toast.success(`Marked ${n} ${n === 1 ? 'error' : 'errors'} reviewed`);
      setPending(null);
      onReviewed();
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg ?? 'Could not clear that group');
    } finally {
      setBusy(false);
    }
  };

  if (groups.length === 0) {
    return (
      <TableEmpty
        icon={<StatusLamp level="good" size="lg" label="Good" />}
        title="Nothing is failing"
        body="No errors recorded in this window."
      />
    );
  }

  return (
    <>
      <TableShell>
        <Table caption="Recurring errors grouped by fingerprint">
          <THead sticky>
            <TH>
              <HintedHeading term="this count" hint={FINGERPRINT_HINT}>Count</HintedHeading>
            </TH>
            <TH>
              <HintedHeading
                term="severity"
                hint={`${SEVERITY.fatal.hint} ${SEVERITY.error.hint} ${SEVERITY.warn.hint}`}
              >
                Severity
              </HintedHeading>
            </TH>
            <TH>Error</TH>
            <TH>Route</TH>
            <TH>Clients</TH>
            <TH>Last seen</TH>
            <TH>Ticket</TH>
            <TH align="right" srOnly>Actions</TH>
          </THead>
          <TBody>
            {groups.map((g) => (
              <TR key={g.fingerprint}>
                <TD numeric className="font-heading text-base font-semibold text-ink-900">
                  {g.count}
                </TD>
                <TD><SeverityLamp severity={g.severity} /></TD>
                <TD className="max-w-md">
                  <p className="font-medium text-ink-900">{g.errorName}</p>
                  <p className="truncate text-panel-500" title={g.message}>{g.message}</p>
                  {g.latestSentryEventId && (
                    <a
                      href={`https://sentry.io/issues/?query=${encodeURIComponent(g.latestSentryEventId)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs underline underline-offset-2 text-panel-500 hover:text-panel-700"
                      title={`Most recent occurrence: Sentry event ${g.latestSentryEventId}`}
                    >
                      Sentry
                    </a>
                  )}
                </TD>
                <TD mono>{g.route ?? '—'}</TD>
                <TD className="text-panel-600">{g.clientIds.length || '—'}</TD>
                <TD className="whitespace-nowrap text-panel-600">{timeAgo(g.lastSeen)}</TD>
                <TD>
                  {g.ticketId ? (
                    <Link
                      href={`/dashboard/support/${g.ticketId}`}
                      className="inline-flex items-center gap-1 text-signal-700 underline decoration-signal-300 underline-offset-2 transition-colors hover:text-signal-800 hover:decoration-signal-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600"
                    >
                      Open <ExternalLink className="h-3 w-3" aria-hidden />
                    </Link>
                  ) : (
                    <span className="text-panel-400">&mdash;</span>
                  )}
                </TD>
                <TD align="right">
                  {canWrite && (
                    <button
                      type="button"
                      onClick={() => setPending(g)}
                      className="inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md border border-panel-300 bg-white px-2.5 py-1.5 text-2xs font-semibold text-ink-800 transition-colors duration-150 hover:border-panel-400 hover:bg-panel-25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600"
                    >
                      <CheckCheck className="h-3.5 w-3.5" aria-hidden />
                      Clear group
                    </button>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </TableShell>

      <ConfirmDialog
        open={!!pending}
        title="Clear this error group?"
        body={
          pending
            ? `This marks all ${pending.count} unreviewed ${pending.count === 1 ? 'occurrence' : 'occurrences'} of ${pending.errorName} as reviewed, under your name. It does not fix the underlying error, and it cannot be undone.`
            : ''
        }
        confirmLabel="Mark group reviewed"
        busy={busy}
        onConfirm={clearGroup}
        onCancel={() => setPending(null)}
      />
    </>
  );
}

function ActivityTable({
  rows, count, canWrite, onOpen, onRetry,
}: {
  rows: ActivityRow[];
  count: number;
  canWrite: boolean;
  onOpen: (row: ActivityRow) => void;
  onRetry: (refId: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <TableEmpty
        icon={<StatusLamp level="off" size="lg" label="No signal" />}
        title="No activity"
        body="Nothing matched these filters. Widen the range or clear them."
      />
    );
  }

  return (
    <TableShell>
      <Table caption={`${count} system activity records`}>
        <THead sticky>
          <TH>When</TH>
          <TH>Type</TH>
          <TH>
            <HintedHeading
              term="severity"
              hint={`${SEVERITY.fatal.hint} ${SEVERITY.error.hint} ${SEVERITY.warn.hint}`}
            >
              Severity
            </HintedHeading>
          </TH>
          <TH>What</TH>
          <TH>
            <HintedHeading term="reviewed" hint={REVIEW_STATE.reviewed.hint ?? ''}>
              Status
            </HintedHeading>
          </TH>
          <TH align="right" srOnly>Actions</TH>
        </THead>
        <TBody>
          {rows.map((row) => (
            <TR key={`${row.kind}-${row.ref_id}`}>
              <TD className="whitespace-nowrap text-panel-600">{timeAgo(row.occurred_at)}</TD>
              <TD className="text-panel-600">{kindTerm(row.kind).label}</TD>
              <TD><SeverityLamp severity={row.severity} /></TD>
              <TD className="max-w-md">
                <p className="font-medium text-ink-900">{row.title}</p>
                <p className="truncate text-panel-500" title={row.detail}>{row.detail}</p>
              </TD>
              <TD>
                <ReviewLamp reviewedAt={row.reviewed_at} />
              </TD>
              <TD align="right" className="whitespace-nowrap">
                  {row.kind === 'system_error' && (
                    <button
                      type="button"
                      onClick={() => onOpen(row)}
                      className="cursor-pointer rounded px-2 py-1 text-xs font-medium text-signal-700 transition-colors hover:bg-signal-50 hover:text-signal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600"
                    >
                      Details
                    </button>
                  )}
                  {row.kind === 'failed_job' && canWrite && (
                    <button
                      type="button"
                      onClick={() => onRetry(row.ref_id)}
                      aria-label={`Retry ${row.title}`}
                      className="inline-flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-xs font-medium text-signal-700 transition-colors hover:bg-signal-50 hover:text-signal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600"
                    >
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Retry
                    </button>
                  )}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </TableShell>
  );
}

function ErrorDetailBody({ detail }: { detail: ErrorDetail }) {
  return (
    <div className="space-y-5 text-sm">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Message</p>
        <p className="mt-1 text-gray-900">{detail.message}</p>
      </div>

      <dl className="grid grid-cols-2 gap-4">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Route</dt>
          <dd className="mt-1 font-mono text-xs text-gray-700">{detail.method} {detail.route ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Status</dt>
          <dd className="mt-1 text-gray-700">{detail.status_code ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Occurred</dt>
          <dd className="mt-1 text-gray-700">{new Date(detail.occurred_at).toLocaleString()}</dd>
        </div>
        <div>
          <dt className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.07em] text-panel-500">
            Fingerprint
            <Hint term="a fingerprint">{FINGERPRINT_HINT}</Hint>
          </dt>
          {/* Truncated for reading; the full value stays selectable via title
              and is what a copy of the element yields. */}
          <dd
            className="mt-1 font-mono text-xs text-panel-700"
            title={detail.fingerprint ?? undefined}
          >
            {shortFingerprint(detail.fingerprint)}
          </dd>
        </div>
      </dl>

      {detail.stack && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Stack</p>
          <pre className="mt-1 max-h-72 overflow-auto rounded-lg bg-gray-900 p-3 text-xs leading-relaxed text-gray-100">
            {detail.stack}
          </pre>
        </div>
      )}

      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Context</p>
        <pre className="mt-1 max-h-60 overflow-auto rounded-lg bg-gray-50 p-3 text-xs text-gray-700">
          {JSON.stringify(detail.context, null, 2)}
        </pre>
        <p className="mt-1 text-xs text-gray-400">
          Credentials and caller PII are stripped before storage.
        </p>
      </div>
    </div>
  );
}

export default function SystemPage() {
  // useSearchParams needs a Suspense boundary in the app router.
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-gray-100" />}>
      <SystemPageInner />
    </Suspense>
  );
}
