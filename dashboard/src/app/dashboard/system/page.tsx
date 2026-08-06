'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { FilterBar, type FilterSpec } from '@/components/FilterBar';
import { SeverityPill, StatusPill } from '@/components/StatusPill';
import { Drawer } from '@/components/Drawer';
import { useSession } from '@/lib/SessionProvider';
import { Layers, List, RefreshCw, ExternalLink, Check } from 'lucide-react';

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

const KIND_LABELS: Record<string, string> = {
  system_error: 'Error',
  failed_job: 'Failed job',
  crm_sync: 'CRM sync',
  automation_run: 'Automation',
  event: 'Event',
};

const filters: FilterSpec[] = [
  {
    key: 'kind',
    label: 'Type',
    type: 'select',
    options: Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label })),
  },
  {
    key: 'severity',
    label: 'Severity',
    type: 'select',
    options: [
      { value: 'fatal', label: 'Fatal' },
      { value: 'error', label: 'Error' },
      { value: 'warn', label: 'Warning' },
    ],
  },
  {
    key: 'source',
    label: 'Source',
    type: 'select',
    options: [
      { value: 'api', label: 'API' },
      { value: 'worker', label: 'Worker' },
      { value: 'webhook', label: 'Webhook' },
      { value: 'startup', label: 'Process' },
    ],
  },
  {
    key: 'reviewed',
    label: 'Reviewed',
    type: 'select',
    options: [
      { value: 'false', label: 'Needs attention' },
      { value: 'true', label: 'Reviewed' },
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
        <GroupedTable groups={groups} />
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

function GroupedTable({ groups }: { groups: GroupedRow[] }) {
  if (groups.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
        <p className="text-lg text-gray-500">Nothing is failing</p>
        <p className="mt-1 text-sm text-gray-400">No errors recorded in this window.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full">
          <caption className="sr-only">Recurring errors grouped by fingerprint</caption>
          <thead className="sticky top-0 bg-gray-50">
            <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase tracking-wide text-gray-700">
              <th scope="col" className="px-6 py-3">Count</th>
              <th scope="col" className="px-6 py-3">Severity</th>
              <th scope="col" className="px-6 py-3">Error</th>
              <th scope="col" className="px-6 py-3">Route</th>
              <th scope="col" className="px-6 py-3">Clients</th>
              <th scope="col" className="px-6 py-3">Last seen</th>
              <th scope="col" className="px-6 py-3">Ticket</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {groups.map((g) => (
              <tr key={g.fingerprint} className="text-sm">
                <td className="px-6 py-4 font-semibold text-gray-900">{g.count}</td>
                <td className="px-6 py-4"><SeverityPill severity={g.severity} /></td>
                <td className="max-w-md px-6 py-4">
                  <p className="font-medium text-gray-900">{g.errorName}</p>
                  <p className="truncate text-gray-500" title={g.message}>{g.message}</p>
                </td>
                <td className="px-6 py-4 font-mono text-xs text-gray-600">{g.route ?? '—'}</td>
                <td className="px-6 py-4 text-gray-600">{g.clientIds.length || '—'}</td>
                <td className="px-6 py-4 text-gray-600">{timeAgo(g.lastSeen)}</td>
                <td className="px-6 py-4">
                  {g.ticketId ? (
                    <Link
                      href={`/dashboard/support/${g.ticketId}`}
                      className="inline-flex items-center gap-1 text-primary-600 hover:underline focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      Open <ExternalLink className="h-3 w-3" aria-hidden />
                    </Link>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
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
      <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
        <p className="text-lg text-gray-500">No activity</p>
        <p className="mt-1 text-sm text-gray-400">Nothing matched these filters.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full">
          <caption className="sr-only">{count} system activity records</caption>
          <thead className="sticky top-0 bg-gray-50">
            <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase tracking-wide text-gray-700">
              <th scope="col" className="px-6 py-3">When</th>
              <th scope="col" className="px-6 py-3">Type</th>
              <th scope="col" className="px-6 py-3">Severity</th>
              <th scope="col" className="px-6 py-3">What</th>
              <th scope="col" className="px-6 py-3">Status</th>
              <th scope="col" className="px-6 py-3"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row) => (
              <tr key={`${row.kind}-${row.ref_id}`} className="text-sm transition-colors hover:bg-gray-50">
                <td className="whitespace-nowrap px-6 py-4 text-gray-600">{timeAgo(row.occurred_at)}</td>
                <td className="px-6 py-4 text-gray-600">{KIND_LABELS[row.kind] ?? row.kind}</td>
                <td className="px-6 py-4"><SeverityPill severity={row.severity} /></td>
                <td className="max-w-md px-6 py-4">
                  <p className="font-medium text-gray-900">{row.title}</p>
                  <p className="truncate text-gray-500" title={row.detail}>{row.detail}</p>
                </td>
                <td className="px-6 py-4">
                  {row.reviewed_at
                    ? <StatusPill tone="success" label="Reviewed" />
                    : <StatusPill tone="warning" label="Needs attention" />}
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-right">
                  {row.kind === 'system_error' && (
                    <button
                      type="button"
                      onClick={() => onOpen(row)}
                      className="cursor-pointer rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      Details
                    </button>
                  )}
                  {row.kind === 'failed_job' && canWrite && (
                    <button
                      type="button"
                      onClick={() => onRetry(row.ref_id)}
                      aria-label={`Retry ${row.title}`}
                      className="inline-flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Retry
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
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
          <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Fingerprint</dt>
          <dd className="mt-1 font-mono text-xs text-gray-700">{detail.fingerprint}</dd>
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
