'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { Check, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { StatusPill } from '@/components/StatusPill';
import { useSession } from '@/lib/SessionProvider';
import { stageLabel, ONBOARDING_STATUSES, type Milestone, type OnboardingStatus } from '@/lib/onboarding';
import { type ActionItem } from '@/lib/actionItems';

/**
 * Staff view of one client's onboarding: advance stages, and add the items the
 * client has to come back to you on. The client sees the same stages read-only
 * and ticks their own items off.
 */

const STATUS_LABEL: Record<OnboardingStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  complete: 'Complete',
};

export default function StaffOnboardingDetail() {
  const { clientId } = useParams<{ clientId: string }>();
  const { can } = useSession();
  const canWrite = can('clients:write');

  const [clientName, setClientName] = useState('');
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [items, setItems] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      api.get('/onboarding', { params: { clientId } }).then((r) => setMilestones(r.data.data ?? [])),
      api.get('/action-items', { params: { clientId } }).then((r) => setItems(r.data.data ?? [])),
      api.get(`/clients/${clientId}`).then((r) => setClientName(r.data?.name ?? '')).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [clientId]);

  useEffect(load, [load]);

  const setStage = async (stageKey: string, status: OnboardingStatus) => {
    const previous = milestones;
    setMilestones((ms) => ms.map((m) => (m.stage_key === stageKey ? { ...m, status } : m)));
    try {
      await api.patch(`/onboarding/${stageKey}`, { clientId, status });
      toast.success(`${stageLabel(stageKey)} → ${STATUS_LABEL[status]}`);
    } catch (e) {
      setMilestones(previous);
      toast.error((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Could not update that stage');
    }
  };

  const addItem = async () => {
    const title = newTitle.trim();
    if (!title) return;
    setAdding(true);
    try {
      const { data } = await api.post('/action-items', { clientId, title });
      setItems((xs) => [...xs, data]);
      setNewTitle('');
    } catch (e) {
      toast.error((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Could not add that item');
    } finally {
      setAdding(false);
    }
  };

  if (loading) return <div className="h-64 animate-pulse bg-panel-100" />;

  const done = milestones.filter((m) => m.status === 'complete').length;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={clientName || 'Onboarding'}
        description={`${done} of ${milestones.length} stages complete.`}
        breadcrumbs={[
          { label: 'Onboarding', href: '/dashboard/onboarding' },
          { label: clientName || 'Client' },
        ]}
      />

      <section className="mb-8 border border-panel-200 bg-surface-raised">
        <h2 className="border-b border-panel-200 px-5 py-3.5 font-heading text-sm font-semibold text-ink-900">
          Launch stages
        </h2>
        <ul className="divide-y divide-panel-100">
          {milestones.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
              <div className="flex min-w-0 items-center gap-3">
                <span
                  className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full ${
 m.status === 'complete' ? 'bg-lamp-good' : m.status === 'in_progress' ? 'bg-ink-700' : 'bg-panel-300'
 }`}
                  aria-hidden
                >
                  {m.status === 'complete' && <Check className="h-3 w-3 text-white" />}
                </span>
                <span className="truncate text-sm font-medium text-ink-800">{stageLabel(m.stage_key)}</span>
              </div>

              {canWrite ? (
                <label className="flex items-center gap-2">
                  <span className="sr-only">{stageLabel(m.stage_key)} status</span>
                  <select
                    value={m.status}
                    onChange={(e) => setStage(m.stage_key, e.target.value as OnboardingStatus)}
                    className="cursor-pointer border border-panel-300 bg-surface-raised px-2.5 py-1.5 text-xs text-ink-900 transition-colors hover:border-panel-400 focus:border-signal-600 focus:outline-none focus:ring-2 focus:ring-signal-600/25"
                  >
                    {ONBOARDING_STATUSES.map((s) => (
                      <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <StatusPill
                  tone={m.status === 'complete' ? 'success' : m.status === 'in_progress' ? 'pending' : 'neutral'}
                  label={STATUS_LABEL[m.status]}
                />
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="border border-panel-200 bg-surface-raised">
        <h2 className="border-b border-panel-200 px-5 py-3.5 font-heading text-sm font-semibold text-ink-900">
          Waiting on the client
        </h2>

        {items.length === 0 ? (
          <p className="px-5 py-6 text-sm text-panel-500">
            Nothing outstanding. Items you add here appear on the client&apos;s onboarding page for them to tick off.
          </p>
        ) : (
          <ul className="divide-y divide-panel-100">
            {items.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className={`text-sm text-ink-800 ${item.status === 'done' ? 'line-through opacity-50' : ''}`}>
                    {item.title}
                  </p>
                  {item.description && <p className="text-xs text-panel-500">{item.description}</p>}
                </div>
                <StatusPill
                  tone={item.status === 'done' ? 'success' : 'warning'}
                  label={item.status === 'done' ? 'Done' : 'Pending'}
                />
              </li>
            ))}
          </ul>
        )}

        {canWrite && (
          <div className="flex gap-2 border-t border-panel-200 px-5 py-4">
            <label htmlFor="new-item" className="sr-only">New action item</label>
            <input
              id="new-item"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addItem(); }}
              placeholder="Something the client needs to send or decide"
              className="flex-1 border border-panel-300 bg-surface-raised px-3 py-2 text-sm text-ink-900 placeholder:text-panel-400 transition-colors hover:border-panel-400 focus:border-signal-600 focus:outline-none focus:ring-2 focus:ring-signal-600/25"
            />
            <button
              type="button"
              onClick={addItem}
              disabled={adding || !newTitle.trim()}
              className="flex cursor-pointer items-center gap-1.5 bg-action px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-action-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus className="h-4 w-4" aria-hidden /> Add
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
