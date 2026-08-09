'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { ArrowDown, ArrowUp, Check, Minus, RefreshCw, X } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { ClientPicker, useClientScope } from '@/components/ClientPicker';
import { StatusLamp, type LampLevel } from '@/components/StatusLamp';
import { useSession } from '@/lib/SessionProvider';

/**
 * The manager view: a work queue, not a report.
 *
 * Everything on this page is something a person can finish today, which is the
 * rule the backend enforces structurally — every kind in the queue has a close
 * path, and a kind without one fails to compile. If a manager cannot act on it,
 * it belongs on the Business page instead.
 *
 * Sorted worst-first by severity then age, so the oldest broken promise rises to
 * the top without anyone sorting anything. The most important row on the page is
 * usually an unreturned callback: a promise the agent made and a human did not
 * keep, invisible everywhere else in the product.
 */

const KIND_LABEL: Record<string, string> = {
  flagged_call: 'Flagged calls',
  unreturned_callback: 'Callbacks owed',
  failed_booking: 'Failed bookings',
  untouched_escalation: 'Untracked transfers',
  calendar_conflict: 'Double bookings',
};

/** Derived items have no row of their own; closing them records a judgement. */
const DERIVED_KINDS = new Set(['untouched_escalation', 'calendar_conflict']);

interface QueueItem {
  kind: string;
  id: string;
  client_id: string;
  occurred_at: string;
  title: string;
  detail: string | null;
  age_seconds: number;
  assignee_id: string | null;
  severity: 'bad' | 'fair';
  ref: string | null;
}

interface PulseRow {
  metric: string;
  today: number;
  sameDayLastWeek: number;
  changePercent: number | null;
}

/** Ages read as duration, not as a timestamp someone has to subtract. */
function age(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  if (hours < 1) return `${Math.max(1, Math.floor(seconds / 60))}m`;
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function humanise(text: string): string {
  return text.replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/**
 * Today against the same weekday last week.
 *
 * The same weekday rather than yesterday because a Monday compared to a Sunday
 * is noise, and a manager reading noise as a trend acts on nothing real.
 */
function Pulse({ rows }: { rows: PulseRow[] }) {
  if (rows.length === 0) return null;

  return (
    <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {rows.map((row) => {
        const flat = row.changePercent === null || row.changePercent === 0;
        const up = (row.changePercent ?? 0) > 0;
        const Arrow = flat ? Minus : up ? ArrowUp : ArrowDown;

        return (
          <div key={row.metric} className="rounded-xl border border-panel-200 bg-white px-5 py-4">
            <p className="truncate text-2xs font-semibold uppercase tracking-[0.07em] text-panel-500">
              {humanise(row.metric)}
            </p>
            <p data-numeric className="mt-2.5 font-heading text-3xl font-semibold tracking-[-0.022em] text-ink-900">
              {row.today}
            </p>
            <p className="mt-2 flex items-center gap-1 text-xs text-panel-500">
              <Arrow className="h-3 w-3 flex-shrink-0" aria-hidden />
              {/* Achromatic: up is not automatically good here — more flagged
                  calls is worse, more bookings is better, and the page does not
                  know which metric it is looking at. */}
              {row.changePercent === null ? (
                <span>none this day last week</span>
              ) : (
                <span data-numeric>
                  {Math.abs(row.changePercent)}% vs {row.sameDayLastWeek} last {new Date().toLocaleDateString(undefined, { weekday: 'long' })}
                </span>
              )}
            </p>
          </div>
        );
      })}
    </section>
  );
}

function QueueInner() {
  const { can } = useSession();
  const canClose = can('flags:write');
  const { clientId, ready } = useClientScope();

  const [items, setItems] = useState<QueueItem[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [pulse, setPulse] = useState<PulseRow[]>([]);
  const [kind, setKind] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [closing, setClosing] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError('');

    // The queue itself works cross-tenant for staff with no client chosen —
    // that is the point of a work queue for an operator covering every account.
    // The pulse does not, because a figure summed across tenants means nothing.
    const params: Record<string, string> = {};
    if (clientId) params.clientId = clientId;
    if (kind) params.kind = kind;

    const jobs: Array<Promise<unknown>> = [
      api.get('/queue', { params }).then((r) => {
        setItems(r.data.items ?? []);
        setCounts(r.data.counts ?? {});
      }),
    ];

    if (clientId) {
      jobs.push(
        api
          .get('/queue/pulse', { params: { clientId } })
          .then((r) => setPulse(r.data.data ?? []))
          .catch(() => setPulse([]))
      );
    } else {
      setPulse([]);
    }

    Promise.all(jobs)
      .catch((e) => setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Could not load the queue'))
      .finally(() => setLoading(false));
  }, [clientId, kind]);

  useEffect(load, [load]);

  const close = async (item: QueueItem, resolution?: 'completed' | 'cancelled') => {
    setClosing(`${item.kind}:${item.id}`);
    try {
      await api.post(`/queue/${item.kind}/${item.id}/close`, resolution ? { resolution } : {});
      // Drop it locally rather than refetching the whole queue: the row is gone
      // either way, and a full reload loses the operator's place in a long list.
      setItems((list) => list.filter((i) => !(i.kind === item.kind && i.id === item.id)));
      setCounts((c) => ({ ...c, [item.kind]: Math.max(0, (c[item.kind] ?? 1) - 1) }));
    } catch (e) {
      toast.error((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Could not close that');
    } finally {
      setClosing(null);
    }
  };

  const total = Object.values(counts).reduce((n, v) => n + v, 0);

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Work queue"
        description="Everything waiting on a person, worst first. Empty is the goal."
        action={
          <button
            type="button"
            onClick={load}
            className="flex cursor-pointer items-center gap-1.5 rounded-md border border-panel-300 bg-white px-3 py-2 text-sm font-medium text-ink-800 transition-colors hover:border-panel-400 hover:bg-panel-25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600"
          >
            <RefreshCw className="h-4 w-4" aria-hidden /> Refresh
          </button>
        }
      />

      <ClientPicker label="Queue for" />

      {error && (
        <div role="alert" className="mb-4 rounded-lg border border-lamp-bad-rim bg-lamp-bad-wash px-4 py-3 text-sm text-lamp-bad-ink">
          {error}
        </div>
      )}

      {!ready ? (
        <div className="h-64 animate-pulse rounded-xl bg-panel-100" />
      ) : (
        <>
          <Pulse rows={pulse} />

          <div className="mb-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setKind(null)}
              aria-pressed={kind === null}
              className={`cursor-pointer rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600 ${
                kind === null ? 'border-ink-800 bg-ink-800 text-white' : 'border-panel-300 bg-white text-panel-600 hover:border-panel-400'
              }`}
            >
              All <span data-numeric className="ml-1">{total}</span>
            </button>
            {Object.entries(KIND_LABEL).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setKind(kind === key ? null : key)}
                aria-pressed={kind === key}
                className={`cursor-pointer rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600 ${
                  kind === key ? 'border-ink-800 bg-ink-800 text-white' : 'border-panel-300 bg-white text-panel-600 hover:border-panel-400'
                }`}
              >
                {label} <span data-numeric className="ml-1">{counts[key] ?? 0}</span>
              </button>
            ))}
          </div>

          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-20 animate-pulse rounded-xl bg-panel-100" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-panel-300 bg-panel-25 px-5 py-12 text-center">
              <p className="font-heading text-base font-semibold text-ink-900">Nothing waiting</p>
              <p className="mt-1 text-sm text-panel-600">
                {kind
                  ? 'Nothing of this kind is outstanding.'
                  : 'No flagged calls, no callbacks owed, no failed bookings. This is what done looks like.'}
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {items.map((item) => {
                const busy = closing === `${item.kind}:${item.id}`;
                const level: LampLevel = item.severity === 'bad' ? 'bad' : 'fair';

                return (
                  <li
                    key={`${item.kind}:${item.id}`}
                    className="rounded-xl border border-panel-200 bg-white px-4 py-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <StatusLamp level={level} size="sm" live={item.severity === 'bad'} className="mt-1.5" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-ink-900">{item.title}</p>
                          {item.detail && (
                            <p className="mt-0.5 text-xs leading-relaxed text-panel-600">{item.detail}</p>
                          )}
                          <p className="mt-1 text-2xs uppercase tracking-[0.06em] text-panel-500">
                            {KIND_LABEL[item.kind] ?? item.kind} · waiting{' '}
                            <span data-numeric>{age(item.age_seconds)}</span>
                            {item.ref && ` · ${item.ref}`}
                          </p>
                        </div>
                      </div>

                      {canClose && (
                        <div className="flex flex-shrink-0 items-center gap-2">
                          {/* Callbacks are the one kind where closing is
                              ambiguous: "we called them back" and "they no
                              longer need us" are different outcomes and the
                              backend records which. */}
                          {item.kind === 'unreturned_callback' ? (
                            <>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => close(item, 'completed')}
                                className="flex cursor-pointer items-center gap-1.5 rounded-md bg-ink-800 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                <Check className="h-3.5 w-3.5" aria-hidden /> Called back
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => close(item, 'cancelled')}
                                className="flex cursor-pointer items-center gap-1.5 rounded-md border border-panel-300 px-3 py-1.5 text-xs font-medium text-panel-600 transition-colors hover:border-panel-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                <X className="h-3.5 w-3.5" aria-hidden /> No longer needed
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => close(item)}
                              className="flex cursor-pointer items-center gap-1.5 rounded-md border border-panel-300 px-3 py-1.5 text-xs font-medium text-ink-800 transition-colors hover:border-panel-400 hover:bg-panel-25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <Check className="h-3.5 w-3.5" aria-hidden />
                              {busy ? 'Closing…' : DERIVED_KINDS.has(item.kind) ? 'Dismiss' : 'Mark done'}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

export default function QueuePage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-panel-100" />}>
      <QueueInner />
    </Suspense>
  );
}
