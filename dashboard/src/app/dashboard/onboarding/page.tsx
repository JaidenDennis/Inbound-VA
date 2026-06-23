'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Check } from 'lucide-react';
import { stageLabel, currentStageIndex, type Milestone } from '@/lib/onboarding';
import { type ActionItem } from '@/lib/actionItems';

export default function OnboardingPage() {
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [items, setItems] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get('/onboarding')
      .then((r) => setMilestones(r.data.data ?? []))
      .finally(() => setLoading(false));
    api.get('/action-items').then((r) => setItems(r.data.data ?? []));
  }, []);

  const toggleItem = async (item: ActionItem) => {
    const status = item.status === 'done' ? 'pending' : 'done';
    const { data } = await api.patch(`/action-items/${item.id}`, { status });
    setItems((xs) => xs.map((x) => (x.id === item.id ? data : x)));
  };

  if (loading) return <div className="text-gray-400 animate-pulse">Loading onboarding...</div>;

  const pending = items.filter((i) => i.status === 'pending');

  const current = currentStageIndex(milestones);
  const done = milestones.filter((m) => m.status === 'complete').length;

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-1">Onboarding</h1>
      <p className="text-sm text-gray-400 mb-6">
        {done} of {milestones.length} stages complete
      </p>

      {items.length > 0 && (
        <section className="bg-white rounded-xl border border-gray-200 p-5 mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-700">Waiting on You</h2>
            {pending.length > 0 && (
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                {pending.length} pending
              </span>
            )}
          </div>
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item.id} className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={item.status === 'done'}
                  onChange={() => toggleItem(item)}
                  className="mt-1 accent-brand-500"
                />
                <div className={item.status === 'done' ? 'opacity-50 line-through' : ''}>
                  <p className="text-sm font-medium text-gray-800">{item.title}</p>
                  {item.description && <p className="text-xs text-gray-500">{item.description}</p>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ol className="relative border-l-2 border-gray-200 ml-3">
        {milestones.map((m, i) => {
          const isComplete = m.status === 'complete';
          const isCurrent = i === current;
          return (
            <li key={m.id} className="mb-6 ml-6">
              <span
                className={`absolute -left-[0.7rem] flex items-center justify-center w-5 h-5 rounded-full ring-4 ring-white ${
                  isComplete ? 'bg-green-500' : isCurrent ? 'bg-brand-500' : 'bg-gray-300'
                }`}
              >
                {isComplete && <Check className="w-3 h-3 text-white" />}
              </span>
              <div className="flex items-center gap-2">
                <h3 className={`font-medium ${isCurrent ? 'text-brand-600' : isComplete ? 'text-gray-800' : 'text-gray-500'}`}>
                  {stageLabel(m.stage_key)}
                </h3>
                {isCurrent && !isComplete && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-brand-50 text-brand-600">
                    {m.status === 'in_progress' ? 'In progress' : 'Up next'}
                  </span>
                )}
              </div>
              {isComplete && m.completed_at && (
                <p className="text-xs text-gray-400 mt-0.5">Completed {new Date(m.completed_at).toLocaleDateString()}</p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
