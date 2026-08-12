'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Circle } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Tabs, useActiveTab, type TabSpec } from '@/components/Tabs';
import { ClientPicker, ChooseClientPrompt, useClientScope } from '@/components/ClientPicker';
import { MoneyCluster, type MoneyData } from './MoneyCluster';
import { TrustCluster, type TrustData } from './TrustCluster';
import { DemandCluster, type DemandData } from './DemandCluster';
import { FollowThroughCluster, type FunnelData, type RoiResponse } from './FollowThroughCluster';
import { Insights, ExportBar } from './Insights';

/**
 * The owner view.
 *
 * Ordered the way the design argues for: money first, then the candid failure
 * data, then the insight nobody else can give them. An owner who opens this once
 * a month should be able to answer "is this worth what I pay for it" from the
 * first screen, and "what should I do about it" from the rest.
 *
 * The six endpoints behind it are careful never to turn "we don't know" into
 * zero. Every component here is careful to render that distinction rather than
 * flattening it back out — see Readout.tsx.
 */

const TABS: TabSpec[] = [
  { key: 'money', label: 'Money' },
  { key: 'trust', label: 'Trust' },
  { key: 'demand', label: 'Demand' },
  { key: 'follow', label: 'Follow-through' },
];

const RANGES = [
  { key: '7', label: '7 days' },
  { key: '30', label: '30 days' },
  { key: '90', label: '90 days' },
] as const;

type RangeKey = (typeof RANGES)[number]['key'];

interface ReadinessItem {
  item: string;
  done: boolean;
  detail: string;
}

interface ReadinessData {
  items: ReadinessItem[];
  done: number;
  total: number;
  showToOwner: boolean;
}

/**
 * Launch checklist, retired 30 days after go-live.
 *
 * A checklist that never goes away becomes furniture. `showToOwner` comes from
 * the API so the retirement rule lives in one place, and staff keep seeing it
 * after it disappears for the client.
 */
function Readiness({ data }: { data: ReadinessData }) {
  const complete = data.done === data.total;

  return (
    <section className="mb-6 border border-panel-200 bg-panel-25 px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-heading text-sm font-semibold text-ink-900">
          {complete ? 'Setup complete' : 'Finish setting up'}
        </h2>
        <span data-numeric className="text-xs text-panel-500">
          {data.done} of {data.total}
        </span>
      </div>

      <ul className="mt-3 space-y-2">
        {data.items.map((item) => (
          <li key={item.item} className="flex items-start gap-2.5">
            {item.done ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-lamp-good" aria-hidden />
            ) : (
              <Circle className="mt-0.5 h-4 w-4 flex-shrink-0 text-panel-300" aria-hidden />
            )}
            <div>
              <span className={item.done ? 'text-sm text-panel-500 line-through' : 'text-sm text-ink-800'}>
                {item.item}
              </span>
              {!item.done && item.detail && (
                <p className="text-xs leading-relaxed text-panel-500">{item.detail}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function BusinessInner() {
  const tab = useActiveTab(TABS);
  const { clientId, needsChoice, ready } = useClientScope();
  const [range, setRange] = useState<RangeKey>('30');

  const [money, setMoney] = useState<MoneyData | null>(null);
  const [trust, setTrust] = useState<TrustData | null>(null);
  const [demand, setDemand] = useState<DemandData | null>(null);
  const [demandCoverage, setDemandCoverage] = useState<{ totalCalls: number; callsWithSignals: number } | null>(null);
  const [funnel, setFunnel] = useState<FunnelData | null>(null);
  const [roi, setRoi] = useState<RoiResponse | null>(null);
  const [readiness, setReadiness] = useState<ReadinessData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Pinned when the range changes rather than recomputed on render, so the
  // clusters, the insights and the exports all describe the same window. A
  // Date.now() evaluated twice produces two slightly different reports.
  const [window, setWindow] = useState(() => {
    const to = new Date().toISOString();
    return { from: new Date(Date.now() - 30 * 86_400_000).toISOString(), to };
  });

  const load = useCallback(() => {
    if (!clientId) return;
    setLoading(true);
    setError('');

    const to = new Date().toISOString();
    const from = new Date(Date.now() - Number(range) * 86_400_000).toISOString();
    setWindow({ from, to });
    const params = { clientId, from, to };

    // One load for the whole surface rather than per tab: the clusters are read
    // together, and lazy-loading each tab makes switching feel broken for the
    // sake of requests that are cheap anyway.
    Promise.all([
      api.get('/reports/money', { params }),
      api.get('/reports/trust', { params }),
      api.get('/reports/demand', { params }),
      api.get('/reports/funnel', { params }),
      api.get('/reports/roi', { params: { clientId } }),
      api.get('/reports/readiness', { params: { clientId } }),
    ])
      .then(([m, t, d, f, r, rd]) => {
        setMoney(m.data.data);
        setTrust(t.data.data);
        setDemand(d.data.data);
        setDemandCoverage(d.data.coverage ?? null);
        setFunnel(f.data.data);
        setRoi(r.data);
        setReadiness(rd.data.data);
      })
      .catch((e) => setError(e?.response?.data?.error ?? 'Could not load your figures'))
      .finally(() => setLoading(false));
  }, [clientId, range]);

  useEffect(load, [load]);

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Business"
        description="What your agent is worth, where it struggles, and what your callers are asking for."
        action={
          <div className="flex gap-1 border border-panel-200 bg-surface-raised p-1">
            {RANGES.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => setRange(r.key)}
                aria-pressed={range === r.key}
                className={`cursor-pointer px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600 ${
 range === r.key ? 'bg-panel-100 text-ink-900' : 'text-panel-600 hover:bg-panel-50'
 }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        }
      />

      <ClientPicker label="Figures for" />

      {error && (
        <div role="alert" className="mb-4 border border-lamp-bad-rim bg-lamp-bad-wash px-4 py-3 text-sm text-lamp-bad-ink">
          {error}
        </div>
      )}

      {!ready ? (
        <div className="h-64 animate-pulse bg-panel-100" />
      ) : needsChoice || !clientId ? (
        <ChooseClientPrompt what="Business figures" />
      ) : loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse bg-panel-100" />
          ))}
        </div>
      ) : (
        <>
          {readiness?.showToOwner && <Readiness data={readiness} />}

          <Insights clientId={clientId} from={window.from} to={window.to} />

          <Tabs tabs={TABS} />

          <div className="space-y-8 pt-2">
            {tab === 'money' && <MoneyCluster data={money} />}
            {tab === 'trust' && <TrustCluster data={trust} />}
            {tab === 'demand' && <DemandCluster data={demand} coverage={demandCoverage} />}
            {tab === 'follow' && <FollowThroughCluster funnel={funnel} roi={roi} />}
          </div>

          <ExportBar clientId={clientId} from={window.from} to={window.to} />

          {/* Stated once, at the foot of the page, rather than repeated beside
              every currency figure — the "est." marks carry it in context. */}
          <p className="mt-8 border-t border-panel-200 pt-4 text-xs leading-relaxed text-panel-500">
            Revenue figures are estimates derived from the prices in your services list, not from
            invoices. They are useful for comparison over time; they are not your books.
          </p>
        </>
      )}
    </div>
  );
}

export default function BusinessPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse bg-panel-100" />}>
      <BusinessInner />
    </Suspense>
  );
}
