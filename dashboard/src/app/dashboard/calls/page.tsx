'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Phone, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { StatusPill, type Tone } from '@/components/StatusPill';
import { Table, TableEmpty, TableShell, TBody, TD, TH, THead, TR } from '@/components/Table';

/**
 * The staff call log — every tenant at once.
 *
 * This page rendered empty for staff for a long time: `/admin/calls` demanded a
 * clientId, staff have none, so the request 400'd and the table drew an empty
 * state that read as "no calls happened". The endpoint now treats an unnamed
 * client as the estate view, and this page shows *whose* call each row was.
 */

interface Call {
  id: string;
  from_number: string | null;
  to_number: string | null;
  status: string;
  duration_seconds: number | null;
  started_at: string | null;
  client_id: string;
  /** Joined by the API so the estate view can name the tenant. */
  clients?: { id: string; name: string } | null;
}

const STATUS_TONES: Record<string, Tone> = {
  completed: 'success',
  in_progress: 'pending',
  failed: 'error',
  transferred: 'warning',
  no_answer: 'warning',
};

/** Numbers arrive E.164 and are unreadable as one run of digits at a glance. */
function formatNumber(raw: string | null): string {
  if (!raw) return '—';
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return raw;
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function CallsPageInner() {
  const [calls, setCalls] = useState<Call[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  const load = useCallback((q: string) => {
    setError('');
    api
      .get('/admin/calls', { params: q.trim() ? { q: q.trim() } : {} })
      .then((r) => {
        setCalls(r.data.data ?? []);
        setTotal(r.data.count ?? 0);
      })
      .catch((e) => setError(e?.response?.data?.error ?? 'Could not load calls'))
      .finally(() => setLoading(false));
  }, []);

  // Search runs on the server, so it covers every call rather than the page
  // already in memory. Debounced so typing does not fire a request per key.
  useEffect(() => {
    const t = setTimeout(() => load(query), query ? 300 : 0);
    return () => clearTimeout(t);
  }, [query, load]);

  const searching = query.trim().length > 0;

  return (
    <div>
      <PageHeader
        title="Calls"
        description="Every inbound call across all clients, newest first."
        breadcrumbs={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Calls' }]}
      />

      <div className="mb-4 border border-panel-200 bg-surface-raised p-4">
        <label htmlFor="call-search" className="mb-1.5 block text-2xs font-semibold uppercase tracking-[0.07em] text-panel-500">
          Search
        </label>
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-panel-400" aria-hidden />
          <input
            id="call-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Phone number or status"
            className="w-full border border-panel-300 bg-surface-raised py-2 pl-9 pr-3 text-sm text-ink-900 placeholder:text-panel-400 transition-colors duration-150 hover:border-panel-400 focus:border-signal-600 focus:outline-none focus:ring-2 focus:ring-signal-600/25"
          />
        </div>
      </div>

      {error && (
        <div role="alert" className="mb-4 border border-lamp-bad-rim bg-lamp-bad-wash px-4 py-3 text-sm text-lamp-bad-ink">
          {error}
        </div>
      )}

      {loading ? (
        <TableShell>
          <Table caption="Loading calls">
            <THead>
              <TH>Client</TH><TH>From</TH><TH>To</TH><TH>Status</TH><TH>Duration</TH><TH>Started</TH>
            </THead>
            <tbody aria-hidden className="divide-y divide-panel-100">
              {Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 6 }).map((__, j) => (
                    <td key={j} className="px-5 py-4">
                      <div className="h-3.5 w-3/5 animate-pulse bg-panel-200" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
        </TableShell>
      ) : calls.length === 0 ? (
        <TableEmpty
          icon={<Phone className="h-8 w-8 text-panel-300" aria-hidden />}
          title={searching ? 'Nothing matched that search' : 'No calls recorded yet'}
          body={
            searching
              ? 'Try a partial number, or clear the search to see every call.'
              : 'Calls appear here once a caller reaches an agent with a phone number mapped to it.'
          }
        />
      ) : (
        <>
          <TableShell>
            <Table caption="Inbound calls across all clients">
              <THead sticky>
                <TH>Client</TH>
                <TH>From</TH>
                <TH>To</TH>
                <TH>Status</TH>
                <TH align="right">Duration</TH>
                <TH>Started</TH>
                <TH srOnly>Actions</TH>
              </THead>
              <TBody>
                {calls.map((c) => (
                  <TR key={c.id}>
                    <TD>
                      {c.clients?.name ? (
                        <Link
                          href={`/dashboard/clients/${c.client_id}`}
                          className="font-medium text-signal-700 underline decoration-signal-200 underline-offset-2 transition-colors hover:decoration-signal-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600"
                        >
                          {c.clients.name}
                        </Link>
                      ) : (
                        <span className="text-panel-400">Unknown</span>
                      )}
                    </TD>
                    <TD mono>{formatNumber(c.from_number)}</TD>
                    <TD mono>{formatNumber(c.to_number)}</TD>
                    <TD>
                      <StatusPill tone={STATUS_TONES[c.status] ?? 'neutral'} label={c.status.replace(/_/g, ' ')} />
                    </TD>
                    <TD align="right" numeric>{formatDuration(c.duration_seconds)}</TD>
                    <TD className="whitespace-nowrap text-panel-600">
                      {c.started_at ? new Date(c.started_at).toLocaleString() : '—'}
                    </TD>
                    <TD align="right">
                      <Link
                        href={`/dashboard/calls/${c.id}`}
                        className="px-2 py-1 text-xs font-medium text-signal-700 transition-colors hover:bg-signal-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600"
                      >
                        View
                      </Link>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableShell>

          <p className="mt-3 text-xs text-panel-500" role="status">
            Showing {calls.length} of {total} call{total === 1 ? '' : 's'}
            {searching && ' matching this search'}.
          </p>
        </>
      )}
    </div>
  );
}

export default function CallsPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse bg-panel-100" />}>
      <CallsPageInner />
    </Suspense>
  );
}
