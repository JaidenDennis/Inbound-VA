'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Download, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/SessionProvider';
import { NothingYet } from './Readout';

/**
 * What changed, with the calls that prove it.
 *
 * The rule the backend enforces and this component depends on: every insight
 * carries the ids of calls that evidence it, and any the service could not trace
 * to a real call has already been dropped. So there is no "no evidence" branch
 * below — an insight without a working click-through never reaches here.
 *
 * That is the whole difference between analysis and decoration. An owner told
 * "containment fell because callers keep asking about parking" should be one
 * click from the four calls where that happened, or the sentence is just a
 * confident-sounding guess.
 */

interface Insight {
  headline: string;
  detail: string;
  severity: 'watch' | 'act';
  callIds: string[];
}

interface InsightResponse {
  insights: Insight[];
  dropped: number;
  reason?: 'not_configured' | 'no_calls' | 'unavailable';
}

const UNAVAILABLE: Record<string, string> = {
  not_configured: 'Automatic analysis is not switched on for this deployment.',
  no_calls: 'No calls in this period, so there is nothing to compare.',
  unavailable: 'Analysis could not run just now. The figures above are unaffected.',
};

export function Insights({ clientId, from, to }: { clientId: string; from: string; to: string }) {
  const [data, setData] = useState<InsightResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api
      .get('/reports/insights', { params: { clientId, from, to } })
      .then((r) => setData(r.data))
      .catch(() => setData({ insights: [], dropped: 0, reason: 'unavailable' }))
      .finally(() => setLoading(false));
  }, [clientId, from, to]);

  useEffect(load, [load]);

  if (loading) return <div className="h-24 animate-pulse bg-panel-100" />;
  if (!data) return null;

  return (
    <section className="mb-6">
      <h2 className="mb-3 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.07em] text-panel-500">
        <Sparkles className="h-3.5 w-3.5" aria-hidden /> What changed
      </h2>

      {data.reason ? (
        <NothingYet>{UNAVAILABLE[data.reason]}</NothingYet>
      ) : data.insights.length === 0 ? (
        <NothingYet>
          Nothing moved meaningfully against the period before this one. That is usually good news.
        </NothingYet>
      ) : (
        <ul className="space-y-2">
          {data.insights.map((insight, i) => (
            <li key={i} className="border border-panel-200 bg-surface-raised px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-medium text-ink-900">{insight.headline}</span>
                {insight.severity === 'act' && (
                  <span className="border border-lamp-fair-rim bg-lamp-fair-wash px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-[0.06em] text-lamp-fair-ink">
                    Needs a decision
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm leading-relaxed text-panel-700">{insight.detail}</p>

              {/* The click-through is not a nicety — it is the reason the claim
                  is allowed on the page at all. */}
              <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-panel-500">
                <span>Based on:</span>
                {insight.callIds.slice(0, 6).map((id, n) => (
                  <Link
                    key={id}
                    href={`/dashboard/reports?call=${id}`}
                    className="text-signal-600 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600"
                  >
                    call {n + 1}
                  </Link>
                ))}
                {insight.callIds.length > 6 && <span>+{insight.callIds.length - 6} more</span>}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const EXPORTS = [
  { kind: 'calls', label: 'Calls' },
  { kind: 'appointments', label: 'Appointments' },
  { kind: 'demand', label: 'Demand' },
  { kind: 'callbacks', label: 'Callbacks' },
] as const;

/**
 * Download the period, generated server-side.
 *
 * The tables on this page are capped, so an export built in the browser would
 * write out what happened to be on screen and call it the report. These call the
 * API, which reads the same sources unpaginated.
 */
export function ExportBar({ clientId, from, to }: { clientId: string; from: string; to: string }) {
  const { can } = useSession();
  const [busy, setBusy] = useState<string | null>(null);

  if (!can('exports:read')) return null;

  const download = async (kind: string, label: string) => {
    setBusy(kind);
    try {
      const response = await api.get(`/reports/export/${kind}`, {
        params: { clientId, from, to },
        responseType: 'blob',
      });

      const url = URL.createObjectURL(new Blob([response.data as BlobPart], { type: 'text/csv' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `gravvia-${kind}-${to.slice(0, 10)}.csv`;
      link.click();
      // Revoking immediately can cancel the download in some browsers; a tick is
      // enough for the click to have been handled.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-8 border-t border-panel-200 pt-4">
      <p className="mb-2 text-2xs font-semibold uppercase tracking-[0.07em] text-panel-500">
        Download this period
      </p>
      <div className="flex flex-wrap gap-2">
        {EXPORTS.map((e) => (
          <button
            key={e.kind}
            type="button"
            onClick={() => download(e.kind, e.label)}
            disabled={busy !== null}
            className="flex cursor-pointer items-center gap-1.5 border border-panel-300 bg-surface-raised px-3 py-1.5 text-xs font-medium text-ink-800 transition-colors hover:border-panel-400 hover:bg-panel-25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
            {busy === e.kind ? 'Preparing…' : e.label}
          </button>
        ))}
      </div>
    </div>
  );
}
