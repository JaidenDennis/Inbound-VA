'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { BellRing, Info } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { ClientPicker, ChooseClientPrompt, useClientScope } from '@/components/ClientPicker';
import { LampStatus } from '@/components/StatusLamp';
import { useSession } from '@/lib/SessionProvider';

/**
 * Alerts — the half of the product that works when nobody logs in.
 *
 * Two decisions are exposed here rather than hidden in a default, because both
 * are the difference between an alert people act on and one they filter:
 *
 *   the window   — how far back to look. Short windows make one bad call look
 *                  like a collapse.
 *   the cooldown — how long to stay quiet after firing. This is the anti-nag
 *                  control, and it is the reason the rule keeps working.
 *
 * The recent-alerts list below is not decoration either. "Did it ever actually
 * fire?" is the first question anyone asks of an alerting system, and one you
 * cannot answer is one nobody trusts.
 */

interface Rule {
  id: string;
  metric: string;
  threshold: number;
  window_minutes: number;
  cooldown_minutes: number;
  enabled: boolean;
  recipients: string[];
  last_fired_at: string | null;
}

interface AlertEvent {
  id: string;
  metric: string;
  observed: number | null;
  threshold: number | null;
  message: string;
  notified: boolean;
  created_at: string;
}

interface MetricSpec {
  metric: string;
  label: string;
}

/** Sensible starting points, and the unit each threshold is measured in. */
const METRIC_HELP: Record<string, { unit: string; hint: string; suggested: number }> = {
  containment_drop: {
    unit: '%',
    suggested: 70,
    hint: 'Alert when the agent handles fewer than this share of calls without a person.',
  },
  escalation_spike: {
    unit: 'calls',
    suggested: 10,
    hint: 'Alert when more than this many calls reach a person in the window.',
  },
  integration_down: {
    unit: 'integrations',
    suggested: 0,
    hint: 'Alert when more than this many integrations are failing or stalled. Zero means tell me about any.',
  },
  missed_revenue: {
    unit: '$',
    suggested: 500,
    hint: 'Alert when callers ask for more than this estimated value of services you do not sell.',
  },
};

const WINDOWS = [
  { value: 60, label: '1 hour' },
  { value: 720, label: '12 hours' },
  { value: 1440, label: '1 day' },
  { value: 10080, label: '1 week' },
];

const COOLDOWNS = [
  { value: 60, label: 'At most hourly' },
  { value: 1440, label: 'At most daily' },
  { value: 10080, label: 'At most weekly' },
];

function AlertsInner() {
  const { can } = useSession();
  const canWrite = can('configure:alerts');
  const { clientId, needsChoice, ready } = useClientScope();

  const [rules, setRules] = useState<Rule[]>([]);
  const [recent, setRecent] = useState<AlertEvent[]>([]);
  const [metrics, setMetrics] = useState<MetricSpec[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!clientId) return;
    setLoading(true);
    api
      .get('/alerts', { params: { clientId } })
      .then((r) => {
        setRules(r.data.data ?? []);
        setRecent(r.data.recent ?? []);
        setMetrics(r.data.metrics ?? []);
      })
      .catch(() => setRules([]))
      .finally(() => setLoading(false));
  }, [clientId]);

  useEffect(load, [load]);

  const save = async (metric: string, patch: Partial<Rule>) => {
    if (!clientId) return;
    const existing = rules.find((r) => r.metric === metric);
    const help = METRIC_HELP[metric];

    setSaving(metric);
    try {
      const { data } = await api.put(
        '/alerts',
        {
          metric,
          threshold: patch.threshold ?? existing?.threshold ?? help?.suggested ?? 0,
          windowMinutes: patch.window_minutes ?? existing?.window_minutes ?? 1440,
          cooldownMinutes: patch.cooldown_minutes ?? existing?.cooldown_minutes ?? 1440,
          enabled: patch.enabled ?? existing?.enabled ?? true,
          recipients: patch.recipients ?? existing?.recipients ?? [],
        },
        { params: { clientId } }
      );

      setRules((list) => {
        const next = list.filter((r) => r.metric !== metric);
        return [...next, { ...(existing ?? { id: metric, last_fired_at: null }), ...data } as Rule].sort((a, b) =>
          a.metric.localeCompare(b.metric)
        );
      });
    } catch (e) {
      toast.error(errorMessage(e, 'Could not save that rule'));
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Alerts"
        description="Get told when something goes wrong, without having to come and look."
      />

      <ClientPicker label="Alerts for" />

      {!ready ? (
        <div className="h-64 animate-pulse bg-panel-100" />
      ) : needsChoice || !clientId ? (
        <ChooseClientPrompt what="Alerts" />
      ) : loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-32 animate-pulse bg-panel-100" />
          ))}
        </div>
      ) : (
        <>
          {!canWrite && (
            <div className="mb-4 flex items-start gap-2 border border-panel-200 bg-panel-50 px-4 py-3 text-sm text-panel-700">
              <Info className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
              <p>You can see these rules but not change them. Ask an account owner.</p>
            </div>
          )}

          <div className="space-y-3">
            {metrics.map((spec) => {
              const rule = rules.find((r) => r.metric === spec.metric);
              const help = METRIC_HELP[spec.metric];
              const busy = saving === spec.metric;

              return (
                <section key={spec.metric} className="border border-panel-200 bg-surface-raised px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold text-ink-900">{spec.label}</h2>
                      <p className="mt-0.5 max-w-lg text-xs leading-relaxed text-panel-600">{help?.hint}</p>
                    </div>

                    <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-panel-700">
                      <input
                        type="checkbox"
                        checked={rule?.enabled ?? false}
                        disabled={!canWrite || busy}
                        onChange={(e) => save(spec.metric, { enabled: e.target.checked })}
                        className="h-4 w-4 cursor-pointer border-panel-300 text-ink-800 focus:ring-2 focus:ring-signal-600 disabled:cursor-not-allowed"
                      />
                      {rule?.enabled ? 'On' : 'Off'}
                    </label>
                  </div>

                  {rule?.enabled && (
                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      <label className="block">
                        <span className="mb-1 block text-2xs font-semibold uppercase tracking-[0.06em] text-panel-500">
                          Threshold ({help?.unit})
                        </span>
                        <input
                          type="number"
                          defaultValue={rule.threshold}
                          disabled={!canWrite || busy}
                          onBlur={(e) => {
                            const value = Number(e.target.value);
                            if (value !== rule.threshold) save(spec.metric, { threshold: value });
                          }}
                          className="w-full border border-panel-300 bg-surface-raised px-3 py-2 text-sm text-ink-900 focus:border-signal-600 focus:outline-none focus:ring-2 focus:ring-signal-600/25 disabled:bg-panel-50"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-2xs font-semibold uppercase tracking-[0.06em] text-panel-500">
                          Look back over
                        </span>
                        <select
                          value={rule.window_minutes}
                          disabled={!canWrite || busy}
                          onChange={(e) => save(spec.metric, { window_minutes: Number(e.target.value) })}
                          className="w-full cursor-pointer border border-panel-300 bg-surface-raised px-3 py-2 text-sm text-ink-900 focus:border-signal-600 focus:outline-none focus:ring-2 focus:ring-signal-600/25 disabled:bg-panel-50"
                        >
                          {WINDOWS.map((w) => (
                            <option key={w.value} value={w.value}>{w.label}</option>
                          ))}
                        </select>
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-2xs font-semibold uppercase tracking-[0.06em] text-panel-500">
                          Tell me
                        </span>
                        <select
                          value={rule.cooldown_minutes}
                          disabled={!canWrite || busy}
                          onChange={(e) => save(spec.metric, { cooldown_minutes: Number(e.target.value) })}
                          className="w-full cursor-pointer border border-panel-300 bg-surface-raised px-3 py-2 text-sm text-ink-900 focus:border-signal-600 focus:outline-none focus:ring-2 focus:ring-signal-600/25 disabled:bg-panel-50"
                        >
                          {COOLDOWNS.map((c) => (
                            <option key={c.value} value={c.value}>{c.label}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  )}

                  {rule?.enabled && (
                    <p className="mt-3 text-xs text-panel-500">
                      Sent to your notification email addresses.
                      {rule.last_fired_at
                        ? ` Last fired ${new Date(rule.last_fired_at).toLocaleString()}.`
                        : ' Has not fired yet.'}
                    </p>
                  )}
                </section>
              );
            })}
          </div>

          <section className="mt-8">
            <h2 className="mb-3 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.07em] text-panel-500">
              <BellRing className="h-3.5 w-3.5" aria-hidden /> Recently sent
            </h2>
            {recent.length === 0 ? (
              <div className="border border-dashed border-panel-300 bg-panel-25 px-5 py-8 text-center text-sm text-panel-500">
                Nothing has triggered an alert. Nothing has gone wrong badly enough to tell you about.
              </div>
            ) : (
              <ul className="space-y-2">
                {recent.map((event) => (
                  <li key={event.id} className="border border-panel-200 bg-surface-raised px-4 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-sm text-ink-800">{event.message}</span>
                      <span className="whitespace-nowrap text-xs text-panel-500">
                        {new Date(event.created_at).toLocaleString()}
                      </span>
                    </div>
                    {/* "We decided to alert" and "an email went out" are genuinely
                        different facts — email is a no-op without SMTP configured. */}
                    {!event.notified && (
                      <LampStatus
                        level="fair"
                        label="Detected, but no email was sent — email delivery is not configured"
                        className="mt-1.5"
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export default function AlertsPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse bg-panel-100" />}>
      <AlertsInner />
    </Suspense>
  );
}
