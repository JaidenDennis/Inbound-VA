'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Save, Trash2 } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';

/**
 * Opening hours.
 *
 * These are stored inside booking_rules, which the booking service already reads
 * for availability — so what the agent *says* it is open and what it will
 * actually book cannot drift apart.
 *
 * Times are 24h in storage and in the inputs (native <input type="time">), and
 * rendered to callers as 12h by the prompt layer.
 */

interface DayHours {
  day: number;
  open: string;
  close: string;
  closed: boolean;
}

interface Exception {
  date: string;
  open?: string;
  close?: string;
  closed: boolean;
}

interface Hours {
  tz: string;
  weekly: DayHours[];
  exceptions: Exception[];
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** A sensible starting week beats an empty form nobody knows how to fill. */
function defaultHours(tz: string): Hours {
  return {
    tz,
    weekly: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
      day,
      open: '09:00',
      close: '17:00',
      closed: day === 0 || day === 6,
    })),
    exceptions: [],
  };
}

const timeCls =
  'border border-panel-300 bg-surface-raised px-2.5 py-1.5 text-sm text-ink-900 transition-colors ' +
  'hover:border-panel-400 focus:border-signal-600 focus:outline-none focus:ring-2 focus:ring-signal-600/25 ' +
  'disabled:cursor-not-allowed disabled:bg-panel-50 disabled:text-panel-400';

export function HoursEditor({
  clientId,
  readOnly,
  timezone,
}: {
  clientId: string;
  readOnly: boolean;
  timezone: string;
}) {
  const [hours, setHours] = useState<Hours | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api
      .get('/knowledge/hours', { params: { clientId } })
      .then((r) => setHours(r.data.data ?? defaultHours(timezone)))
      .catch(() => setHours(defaultHours(timezone)))
      .finally(() => { setLoading(false); setDirty(false); });
  }, [clientId, timezone]);

  useEffect(load, [load]);

  const setDay = (day: number, patch: Partial<DayHours>) => {
    setHours((h) =>
      h ? { ...h, weekly: h.weekly.map((d) => (d.day === day ? { ...d, ...patch } : d)) } : h
    );
    setDirty(true);
  };

  const setException = (i: number, patch: Partial<Exception>) => {
    setHours((h) =>
      h ? { ...h, exceptions: h.exceptions.map((e, j) => (j === i ? { ...e, ...patch } : e)) } : h
    );
    setDirty(true);
  };

  const save = async () => {
    if (!hours) return;
    setSaving(true);
    try {
      // Drop exceptions with no date — a half-filled row would fail validation
      // server-side and the operator would not know which one.
      const payload = { ...hours, exceptions: hours.exceptions.filter((e) => e.date) };
      await api.put('/knowledge/hours', payload, { params: { clientId } });
      setHours(payload);
      setDirty(false);
      toast.success('Hours saved — publishing to the agent shortly');
    } catch (e) {
      toast.error(errorMessage(e, 'Could not save hours'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="h-64 animate-pulse bg-panel-100" />;
  if (!hours) return null;

  const ordered = [...hours.weekly].sort((a, b) => ((a.day + 6) % 7) - ((b.day + 6) % 7));

  return (
    <div className="space-y-4">
      <div className="border border-panel-200 bg-surface-raised">
        <div className="border-b border-panel-200 px-5 py-3.5">
          <h2 className="font-heading text-sm font-semibold text-ink-900">Opening hours</h2>
          <p className="mt-0.5 text-xs text-panel-500">
            What the agent tells callers, and the window it will offer appointments in. Times are in {hours.tz}.
          </p>
        </div>

        <ul className="divide-y divide-panel-100">
          {ordered.map((d) => (
            <li key={d.day} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <span className="w-24 flex-shrink-0 text-sm font-medium text-ink-800">{DAY_NAMES[d.day]}</span>

              <label className="flex cursor-pointer items-center gap-2 text-sm text-panel-600">
                <input
                  type="checkbox"
                  checked={!d.closed}
                  disabled={readOnly}
                  onChange={(e) => setDay(d.day, { closed: !e.target.checked })}
                  className="h-4 w-4 cursor-pointer border-panel-300 text-ink-800 focus:ring-2 focus:ring-signal-600"
                />
                Open
              </label>

              <div className="flex items-center gap-2">
                <label className="sr-only" htmlFor={`open-${d.day}`}>{DAY_NAMES[d.day]} opening time</label>
                <input
                  id={`open-${d.day}`}
                  type="time"
                  value={d.open}
                  disabled={readOnly || d.closed}
                  onChange={(e) => setDay(d.day, { open: e.target.value })}
                  className={timeCls}
                />
                <span className="text-panel-400">to</span>
                <label className="sr-only" htmlFor={`close-${d.day}`}>{DAY_NAMES[d.day]} closing time</label>
                <input
                  id={`close-${d.day}`}
                  type="time"
                  value={d.close}
                  disabled={readOnly || d.closed}
                  onChange={(e) => setDay(d.day, { close: e.target.value })}
                  className={timeCls}
                />
              </div>

              {d.closed && <span className="text-xs text-panel-500">Closed all day</span>}
            </li>
          ))}
        </ul>
      </div>

      <div className="border border-panel-200 bg-surface-raised">
        <div className="border-b border-panel-200 px-5 py-3.5">
          <h2 className="font-heading text-sm font-semibold text-ink-900">Holidays &amp; exceptions</h2>
          <p className="mt-0.5 text-xs text-panel-500">
            One-off closures or changed hours. These override the weekly schedule on that date.
          </p>
        </div>

        {hours.exceptions.length === 0 ? (
          <p className="px-5 py-6 text-sm text-panel-500">No exceptions set.</p>
        ) : (
          <ul className="divide-y divide-panel-100">
            {hours.exceptions.map((e, i) => (
              <li key={i} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <label className="sr-only" htmlFor={`exc-date-${i}`}>Exception date</label>
                <input
                  id={`exc-date-${i}`}
                  type="date"
                  value={e.date}
                  disabled={readOnly}
                  onChange={(ev) => setException(i, { date: ev.target.value })}
                  className={timeCls}
                />
                <label className="flex cursor-pointer items-center gap-2 text-sm text-panel-600">
                  <input
                    type="checkbox"
                    checked={e.closed}
                    disabled={readOnly}
                    onChange={(ev) => setException(i, { closed: ev.target.checked })}
                    className="h-4 w-4 cursor-pointer border-panel-300 text-ink-800 focus:ring-2 focus:ring-signal-600"
                  />
                  Closed
                </label>
                {!e.closed && (
                  <div className="flex items-center gap-2">
                    <input
                      type="time"
                      aria-label="Exception opening time"
                      value={e.open ?? '09:00'}
                      disabled={readOnly}
                      onChange={(ev) => setException(i, { open: ev.target.value })}
                      className={timeCls}
                    />
                    <span className="text-panel-400">to</span>
                    <input
                      type="time"
                      aria-label="Exception closing time"
                      value={e.close ?? '17:00'}
                      disabled={readOnly}
                      onChange={(ev) => setException(i, { close: ev.target.value })}
                      className={timeCls}
                    />
                  </div>
                )}
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => {
                      setHours((h) => (h ? { ...h, exceptions: h.exceptions.filter((_, j) => j !== i) } : h));
                      setDirty(true);
                    }}
                    aria-label={`Remove exception ${i + 1}`}
                    className="ml-auto cursor-pointer p-1.5 text-panel-500 transition-colors hover:bg-lamp-bad-wash hover:text-lamp-bad-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lamp-bad"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2 border-t border-panel-200 px-5 py-4">
            <button
              type="button"
              onClick={() => {
                setHours((h) =>
                  h ? { ...h, exceptions: [...h.exceptions, { date: '', closed: true }] } : h
                );
                setDirty(true);
              }}
              className="flex cursor-pointer items-center gap-1.5 border border-panel-300 bg-surface-raised px-3 py-2 text-sm font-medium text-ink-800 transition-colors hover:border-panel-400 hover:bg-panel-25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600"
            >
              <Plus className="h-4 w-4" aria-hidden /> Add exception
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || !dirty}
              className="flex cursor-pointer items-center gap-1.5 bg-action px-3.5 py-2 text-sm font-semibold text-[rgb(var(--action-contrast-rgb))] transition-colors hover:bg-action-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Save className="h-4 w-4" aria-hidden /> {saving ? 'Saving…' : 'Save hours'}
            </button>
            {dirty && <span className="text-xs text-lamp-fair-ink">Unsaved changes</span>}
          </div>
        )}
      </div>
    </div>
  );
}
