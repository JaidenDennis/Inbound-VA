'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { GripVertical, Plus, Save, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';

type Policy = { id?: string; title: string; body: string };

/**
 * Business policies: the lines the agent must state rather than improvise —
 * cancellation windows, deposits, insurance, age limits, parking.
 *
 * Edited as a whole list. They are short, get reordered as often as reworded,
 * and have no stable id to patch individually, so per-row CRUD would add
 * machinery without buying anything.
 */
export function PoliciesEditor({ clientId, readOnly }: { clientId: string; readOnly: boolean }) {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api
      .get('/knowledge/policies', { params: { clientId } })
      .then((r) => setPolicies(r.data.data ?? []))
      .catch(() => setPolicies([]))
      .finally(() => { setLoading(false); setDirty(false); });
  }, [clientId]);

  useEffect(load, [load]);

  const editTitle = (i: number, value: string) => {
    setPolicies((ps) => ps.map((p, j) => (j === i ? { ...p, title: value } : p)));
    setDirty(true);
  };

  const editBody = (i: number, value: string) => {
    setPolicies((ps) => ps.map((p, j) => (j === i ? { ...p, body: value } : p)));
    setDirty(true);
  };

  const remove = (i: number) => {
    setPolicies((ps) => ps.filter((_, j) => j !== i));
    setDirty(true);
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= policies.length) return;
    setPolicies((ps) => {
      const next = [...ps];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    setDirty(true);
  };

  const blankTitleIndexes = policies
    .map((p, i) => (p.title.trim() === '' ? i : -1))
    .filter((i) => i >= 0);
  const hasBlankTitle = blankTitleIndexes.length > 0;

  const save = async () => {
    if (hasBlankTitle) {
      toast.error('Every policy needs a title before it can be saved');
      return;
    }
    const cleaned = policies
      .map((p) => ({ title: p.title.trim(), body: p.body.trim() }))
      .filter((p) => p.title !== '');
    setSaving(true);
    try {
      const res = await api.put('/knowledge/policies', { policies: cleaned }, { params: { clientId } });
      setPolicies(res.data.data ?? cleaned);
      setDirty(false);
      const warning = res.data?.warning as string | undefined;
      if (warning) {
        toast(
          `Policies saved, but the agent hasn't picked them up yet: ${warning}`,
          {
            icon: '⚠️',
            duration: 10000,
            style: { background: '#FCF2E0', color: '#8A5600', border: '1px solid #EFD5A6' },
          },
        );
      } else {
        toast.success('Policies saved — publishing to the agent shortly');
      }
    } catch (e) {
      toast.error((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Could not save policies');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="h-48 animate-pulse rounded-xl bg-panel-100" />;

  return (
    <div className="rounded-xl border border-panel-200 bg-white">
      <div className="border-b border-panel-200 px-5 py-3.5">
        <h2 className="font-heading text-sm font-semibold text-ink-900">Business policies</h2>
        <p className="mt-0.5 text-xs text-panel-500">
          Stated to callers when relevant. Give each one a short title and write the body as plain sentences the agent can say aloud.
        </p>
      </div>

      {policies.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-panel-500">
          No policies yet. Add the ones callers ask about most — cancellations, deposits, insurance.
        </p>
      ) : (
        <ul className="divide-y divide-panel-100">
          {policies.map((p, i) => {
            const titleBlank = p.title.trim() === '';
            return (
              <li key={p.id ?? i} className="flex items-start gap-2 px-5 py-3">
                {!readOnly && (
                  <div className="flex flex-col pt-1.5">
                    <button
                      type="button"
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      aria-label={`Move policy ${i + 1} up`}
                      className="cursor-pointer text-panel-400 transition-colors hover:text-ink-700 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <GripVertical className="h-3.5 w-3.5 rotate-90" aria-hidden />
                    </button>
                  </div>
                )}
                <div className="flex flex-1 flex-col gap-1.5">
                  <input
                    type="text"
                    value={p.title}
                    readOnly={readOnly}
                    onChange={(e) => editTitle(i, e.target.value)}
                    placeholder="Title"
                    maxLength={200}
                    aria-label={`Policy ${i + 1} title`}
                    className={`w-full rounded-md border bg-white px-3 py-1.5 text-sm font-medium text-ink-900 transition-colors hover:border-panel-400 focus:border-signal-600 focus:outline-none focus:ring-2 focus:ring-signal-600/25 read-only:bg-panel-50 read-only:text-panel-600 ${titleBlank ? 'border-lamp-bad' : 'border-panel-300'}`}
                  />
                  {titleBlank && (
                    <span className="text-xs text-lamp-bad-ink">Title is required</span>
                  )}
                  <textarea
                    value={p.body}
                    readOnly={readOnly}
                    onChange={(e) => editBody(i, e.target.value)}
                    rows={2}
                    maxLength={4000}
                    placeholder="Body"
                    aria-label={`Policy ${i + 1} body`}
                    className="w-full resize-y rounded-md border border-panel-300 bg-white px-3 py-2 text-sm text-ink-900 transition-colors hover:border-panel-400 focus:border-signal-600 focus:outline-none focus:ring-2 focus:ring-signal-600/25 read-only:bg-panel-50 read-only:text-panel-600"
                  />
                </div>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    aria-label={`Remove policy ${i + 1}`}
                    className="mt-1 cursor-pointer rounded p-1.5 text-panel-500 transition-colors hover:bg-lamp-bad-wash hover:text-lamp-bad-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lamp-bad"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2 border-t border-panel-200 px-5 py-4">
          <button
            type="button"
            onClick={() => { setPolicies((ps) => [...ps, { title: '', body: '' }]); setDirty(true); }}
            className="flex cursor-pointer items-center gap-1.5 rounded-md border border-panel-300 bg-white px-3 py-2 text-sm font-medium text-ink-800 transition-colors hover:border-panel-400 hover:bg-panel-25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600"
          >
            <Plus className="h-4 w-4" aria-hidden /> Add policy
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty}
            className="flex cursor-pointer items-center gap-1.5 rounded-md bg-ink-800 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Save className="h-4 w-4" aria-hidden /> {saving ? 'Saving…' : 'Save policies'}
          </button>
          {dirty && <span className="text-xs text-lamp-fair-ink">Unsaved changes</span>}
        </div>
      )}
    </div>
  );
}
