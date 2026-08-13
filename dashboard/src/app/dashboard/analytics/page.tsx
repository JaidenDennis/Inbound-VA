'use client';

import { useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

/**
 * Staff-only cross-company roll-up. `/analytics/overview` is gated by
 * `requirePlatform` (backend/src/dashboard-api/analytics.route.ts) precisely
 * because it aggregates every tenant when no `clientId` is given — a client's
 * own figures live on the Business tab instead.
 *
 * This page deliberately does NOT use `useClientScope()` /
 * `ChooseClientPrompt` (dashboard/src/components/ClientPicker.tsx). That hook
 * treats "no client chosen" as an error state for platform users to resolve
 * before seeing anything. Here, no selection IS the primary view — every
 * company, rolled up — so it needs its own plain `<select>` instead of
 * bending a hook every other page relies on meaning the opposite thing.
 */

interface Overview {
  totalCalls: number;
  leadsCapured: number;
  appointmentsBooked: number;
  avgCallDurationSeconds: number;
  conversionRate: string;
  period: { from: string; to: string };
}

interface ClientOption {
  id: string;
  name: string;
}

export default function AnalyticsPage() {
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  // '' = All companies, and is omitted from the /analytics/overview request.
  const [clientId, setClientId] = useState('');

  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  // Distinct from `loading`. Rendering on `loading || !data` alone meant a
  // failed request — which sets data to null — left "Loading analytics..."
  // pulsing forever, so a 403 or a dead service was indistinguishable from a
  // slow one.
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get('/clients', { params: { limit: 200 } })
      .then((r) => setClients((r.data.data ?? []).map((c: ClientOption) => ({ id: c.id, name: c.name }))))
      .catch(() => setClients([]))
      .finally(() => setClientsLoading(false));
  }, []);

  useEffect(() => {
    // No synchronous state reset here: both branches below set `data` and
    // `error` together, so the pair can never disagree, and resetting in the
    // effect body would add a cascading render for no benefit.
    api
      .get('/analytics/overview', { params: clientId ? { clientId } : {} })
      .then((r) => {
        setData(r.data);
        setError(null);
      })
      .catch((e) => {
        setData(null);
        const status = (e as { response?: { status?: number } })?.response?.status;
        setError(
          status === 403
            ? 'This roll-up is staff-only. Your own figures are on the Business page.'
            : (errorMessage(e, 'The analytics service did not respond.'))
        );
      })
      .finally(() => setLoading(false));
  }, [clientId]);

  const selectedName = clientId ? clients.find((c) => c.id === clientId)?.name : null;

  const chartData = data
    ? [
        { name: 'Calls', value: data.totalCalls, fill: 'var(--series-1)' },
        { name: 'Leads', value: data.leadsCapured, fill: 'var(--series-2)' },
        { name: 'Bookings', value: data.appointmentsBooked, fill: 'var(--series-1)' },
      ]
    : [];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Analytics</h1>
      <p className="mb-6 text-sm text-panel-500">
        {clientId
          ? `Showing ${selectedName ?? 'the selected company'} only.`
          : 'Cross-company totals, rolled up across every client.'}
      </p>

      {/* Styled to match ClientPicker's visual treatment (border, label,
          select) even though it is a plain, page-local control rather than
          the shared client-scope hook. */}
      <div className="mb-6 flex flex-wrap items-end gap-3 border border-panel-200 bg-surface-raised p-4">
        <div className="flex min-w-[16rem] flex-col gap-1.5">
          <label htmlFor="analytics-company" className="text-2xs font-semibold uppercase tracking-[0.07em] text-panel-500">
            Company
          </label>
          <select
            id="analytics-company"
            value={clientId}
            disabled={clientsLoading}
            onChange={(e) => setClientId(e.target.value)}
            className="cursor-pointer border border-panel-300 bg-surface-raised px-3 py-2 text-sm text-ink-900 transition-colors duration-150 hover:border-panel-400 focus:border-signal-600 focus:outline-none focus:ring-2 focus:ring-signal-600/25 disabled:cursor-wait disabled:bg-panel-50"
          >
            <option value="">{clientsLoading ? 'Loading companies…' : 'All companies'}</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="text-gray-400 animate-pulse">Loading analytics...</div>
      ) : error || !data ? (
        <div
          role="alert"
          className="border border-lamp-bad-rim bg-lamp-bad-wash px-5 py-4 text-sm text-lamp-bad-ink"
        >
          <p className="font-semibold">Figures did not load.</p>
          <p className="mt-1 text-xs leading-relaxed">
            {error ?? 'The analytics service did not respond.'} Reload to try again.
          </p>
        </div>
      ) : (
        <>
          <p className="text-sm text-gray-400 mb-6">
            {new Date(data.period.from).toLocaleDateString()} – {new Date(data.period.to).toLocaleDateString()}
          </p>
          {/* These three figures were blue / green / purple, which read as a
              traffic light over metrics that carry no health meaning at all — and
              purple is not in the token system, so it rendered as stock Tailwind.
              Figures are ink; chroma stays with real status. */}
          <div className="mb-8 grid grid-cols-1 overflow-hidden border border-panel-200 bg-surface-raised sm:grid-cols-3">
            {[
              { label: 'Total calls', value: data.totalCalls },
              { label: 'Leads captured', value: data.leadsCapured },
              { label: 'Conversion rate', value: `${data.conversionRate}%` },
            ].map((m, i) => (
              <div
                key={m.label}
                className={`px-5 py-4 ${i > 0 ? 'border-t border-panel-200 sm:border-l sm:border-t-0' : ''}`}
              >
                <p className="text-2xs font-semibold uppercase tracking-[0.07em] text-panel-500">
                  {m.label}
                </p>
                <p data-numeric className="mt-2 font-heading text-3xl font-semibold tracking-[-0.022em] text-ink-900">
                  {m.value}
                </p>
              </div>
            ))}
          </div>
          <div className="bg-surface-raised border p-6 viz-root">
            <h2 className="font-semibold text-gray-700 mb-4">Performance Overview</h2>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--gridline)" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="value" fill="var(--series-1)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}
