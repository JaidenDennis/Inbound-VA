'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { Check, ListChecks } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { StatusPill } from '@/components/StatusPill';
import { Table, TableEmpty, TableShell, TBody, TD, TH, THead, TR } from '@/components/Table';
import { useSession } from '@/lib/SessionProvider';
import { stageLabel, currentStageIndex, type Milestone } from '@/lib/onboarding';
import { type ActionItem } from '@/lib/actionItems';

/**
 * Onboarding, in two shapes.
 *
 * A client sees their own eight-stage timeline. Staff have no single client to
 * scope to, so they get the estate rollup — which is what this page used to
 * fail to draw at all: it asked `/onboarding` with no clientId, the endpoint
 * replied 400, and the page rendered an empty timeline that looked blank.
 */

interface PlatformRow {
  client_id: string;
  client_name: string;
  status: string;
  total: number;
  complete: number;
  current_stage: string | null;
}

/** A small horizontal meter — reads faster down a column than "3 of 8". */
function Progress({ complete, total }: { complete: number; total: number }) {
  const pct = total > 0 ? Math.round((complete / total) * 100) : 0;
  const done = pct === 100;
  return (
    <div className="flex items-center gap-2.5">
      <div
        className="h-1.5 w-24 overflow-hidden rounded-full bg-panel-200"
        role="progressbar"
        aria-valuenow={complete}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={`${complete} of ${total} stages complete`}
      >
        <div
          className={done ? 'h-full rounded-full bg-lamp-good' : 'h-full rounded-full bg-ink-500'}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-2xs tabular-nums text-panel-600">
        {complete}/{total}
      </span>
    </div>
  );
}

function PlatformRollup() {
  const [rows, setRows] = useState<PlatformRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get('/onboarding')
      .then((r) => setRows(r.data.data ?? []))
      .catch((e) => setError(e?.response?.data?.error ?? 'Could not load onboarding'))
      .finally(() => setLoading(false));
  }, []);

  const live = rows.filter((r) => r.current_stage === null).length;

  return (
    <div>
      <PageHeader
        title="Onboarding"
        description="Where every client sits between signing and going live."
      />

      {error && (
        <div role="alert" className="mb-4 rounded-lg border border-lamp-bad-rim bg-lamp-bad-wash px-4 py-3 text-sm text-lamp-bad-ink">
          {error}
        </div>
      )}

      {!loading && rows.length > 0 && (
        <p className="mb-4 text-sm text-panel-600">
          {live} of {rows.length} client{rows.length === 1 ? '' : 's'} fully onboarded.
        </p>
      )}

      {loading ? (
        <div className="h-64 animate-pulse rounded-xl bg-panel-100" />
      ) : rows.length === 0 ? (
        <TableEmpty
          icon={<ListChecks className="h-8 w-8 text-panel-300" aria-hidden />}
          title="No clients yet"
          body="Onboarding stages are created automatically when you add a client."
        />
      ) : (
        <TableShell>
          <Table caption="Client onboarding progress">
            <THead sticky>
              <TH>Client</TH>
              <TH>Progress</TH>
              <TH>Current stage</TH>
              <TH>Account</TH>
              <TH srOnly>Actions</TH>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.client_id}>
                  <TD>
                    <Link
                      href={`/dashboard/clients/${r.client_id}`}
                      className="font-medium text-signal-700 underline decoration-signal-200 underline-offset-2 transition-colors hover:decoration-signal-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600"
                    >
                      {r.client_name}
                    </Link>
                  </TD>
                  <TD><Progress complete={r.complete} total={r.total} /></TD>
                  <TD>
                    {r.current_stage
                      ? <span className="text-ink-800">{stageLabel(r.current_stage)}</span>
                      : <StatusPill tone="success" label="Live" />}
                  </TD>
                  <TD>
                    <StatusPill
                      tone={r.status === 'active' ? 'success' : 'neutral'}
                      label={r.status}
                    />
                  </TD>
                  <TD align="right">
                    <Link
                      href={`/dashboard/onboarding/${r.client_id}`}
                      className="rounded px-2 py-1 text-xs font-medium text-signal-700 transition-colors hover:bg-signal-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600"
                    >
                      Open
                    </Link>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableShell>
      )}
    </div>
  );
}

function ClientTimeline() {
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [items, setItems] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    api
      .get('/onboarding')
      .then((r) => setMilestones(r.data.data ?? []))
      .finally(() => setLoading(false));
    api.get('/action-items').then((r) => setItems(r.data.data ?? [])).catch(() => setItems([]));
  }, []);

  useEffect(load, [load]);

  const toggleItem = async (item: ActionItem) => {
    const status = item.status === 'done' ? 'pending' : 'done';
    // Optimistic: the checkbox must respond to the click, not to the round trip.
    setItems((xs) => xs.map((x) => (x.id === item.id ? { ...x, status } : x)));
    try {
      const { data } = await api.patch(`/action-items/${item.id}`, { status });
      setItems((xs) => xs.map((x) => (x.id === item.id ? data : x)));
    } catch {
      setItems((xs) => xs.map((x) => (x.id === item.id ? item : x)));
      toast.error('Could not save that — try again.');
    }
  };

  if (loading) return <div className="h-64 animate-pulse rounded-xl bg-panel-100" />;

  const pending = items.filter((i) => i.status === 'pending');
  const current = currentStageIndex(milestones);
  const done = milestones.filter((m) => m.status === 'complete').length;

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Onboarding"
        description={
          milestones.length === 0
            ? 'Your launch plan will appear here shortly.'
            : `${done} of ${milestones.length} stages complete.`
        }
      />

      {items.length > 0 && (
        <section className="mb-8 rounded-xl border border-panel-200 bg-white p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-heading text-sm font-semibold text-ink-900">Waiting on you</h2>
            {pending.length > 0 && <StatusPill tone="warning" label={`${pending.length} pending`} />}
          </div>
          <ul className="space-y-2.5">
            {items.map((item) => (
              <li key={item.id} className="flex items-start gap-3">
                <input
                  id={`item-${item.id}`}
                  type="checkbox"
                  checked={item.status === 'done'}
                  onChange={() => toggleItem(item)}
                  className="mt-0.5 h-4 w-4 cursor-pointer rounded border-panel-300 text-ink-800 focus:ring-2 focus:ring-signal-600"
                />
                <label
                  htmlFor={`item-${item.id}`}
                  className={`cursor-pointer ${item.status === 'done' ? 'opacity-50' : ''}`}
                >
                  <span className={`block text-sm font-medium text-ink-800 ${item.status === 'done' ? 'line-through' : ''}`}>
                    {item.title}
                  </span>
                  {item.description && <span className="block text-xs text-panel-500">{item.description}</span>}
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}

      {milestones.length === 0 ? (
        <TableEmpty
          icon={<ListChecks className="h-8 w-8 text-panel-300" aria-hidden />}
          title="Nothing scheduled yet"
          body="Your account manager sets these stages up as your launch begins."
        />
      ) : (
        <ol className="relative ml-3 border-l-2 border-panel-200">
          {milestones.map((m, i) => {
            const isComplete = m.status === 'complete';
            const isCurrent = i === current;
            return (
              <li key={m.id} className="mb-6 ml-6 last:mb-0">
                <span
                  className={`absolute -left-[0.7rem] flex h-5 w-5 items-center justify-center rounded-full ring-4 ring-panel-50 ${
                    isComplete ? 'bg-lamp-good' : isCurrent ? 'bg-ink-700' : 'bg-panel-300'
                  }`}
                >
                  {isComplete && <Check className="h-3 w-3 text-white" aria-hidden />}
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className={`text-sm font-medium ${isCurrent ? 'text-ink-900' : isComplete ? 'text-ink-800' : 'text-panel-500'}`}>
                    {stageLabel(m.stage_key)}
                  </h3>
                  {isCurrent && !isComplete && (
                    <StatusPill tone="pending" label={m.status === 'in_progress' ? 'In progress' : 'Up next'} />
                  )}
                </div>
                {isComplete && m.completed_at && (
                  <p className="mt-0.5 text-xs text-panel-500">
                    Completed {new Date(m.completed_at).toLocaleDateString()}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export default function OnboardingPage() {
  const { isPlatform, loading } = useSession();
  if (loading) return <div className="h-64 animate-pulse rounded-xl bg-panel-100" />;
  return isPlatform ? <PlatformRollup /> : <ClientTimeline />;
}
