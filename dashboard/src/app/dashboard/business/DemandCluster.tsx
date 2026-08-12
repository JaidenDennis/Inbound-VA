'use client';

import { Cluster, Coverage, NothingYet, money } from './Readout';

/**
 * Demand — what callers actually asked for.
 *
 * The differentiator and the most coverage-dependent surface in the product.
 * These figures come from signals captured during the call, and signal capture
 * starts at an agent's next re-provision with no backfill, so an empty list here
 * can mean "nobody asked" or "we weren't listening yet". The coverage line is
 * what tells those apart, and it is not optional.
 */

export interface DemandData {
  callReasons: Array<{ reason: string; count: number }>;
  referralSources: Array<{ source: string; count: number }>;
  lostDemand: Array<{ service: string; requests: number; unitPrice: number | null; estimatedValue: number | null }>;
  peakTimes: Array<{ dow: number; hour: number; count: number }>;
  knowledgeGaps: Array<{ id: string; question: string; occurrences: number; lastSeenAt: string }>;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function humanise(text: string): string {
  return text.replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

function hourLabel(hour: number): string {
  if (hour === 0) return '12am';
  if (hour === 12) return '12pm';
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
}

/** A ranked list where the bar is length only — hue stays reserved for state. */
function Ranked({
  items,
  empty,
}: {
  items: Array<{ key: string; label: string; count: number }>;
  empty: string;
}) {
  if (items.length === 0) return <NothingYet>{empty}</NothingYet>;
  const max = Math.max(...items.map((i) => i.count));

  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.key} className="border border-panel-200 bg-surface-raised px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-ink-800">{item.label}</span>
            <span data-numeric className="text-sm font-semibold text-ink-900">{item.count}</span>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-panel-100">
            <div className="h-full rounded-full bg-panel-400" style={{ width: `${(item.count / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function DemandCluster({
  data,
  coverage,
}: {
  data: DemandData | null;
  coverage: { totalCalls: number; callsWithSignals: number } | null;
}) {
  if (!data) {
    return (
      <Cluster title="Demand" description="What callers asked for.">
        <NothingYet>No calls in this period.</NothingYet>
      </Cluster>
    );
  }

  const peakMax = Math.max(1, ...data.peakTimes.map((p) => p.count));

  return (
    <Cluster
      title="Demand"
      description="What callers asked for, where they came from, and what you were asked for and could not sell."
    >
      {coverage && (
        <Coverage
          analyzed={coverage.callsWithSignals}
          total={coverage.totalCalls}
          noun="calls with captured signals"
        />
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-3 text-2xs font-semibold uppercase tracking-[0.07em] text-panel-500">
            Why people called
          </h3>
          <Ranked
            items={data.callReasons.map((r) => ({ key: r.reason, label: humanise(r.reason), count: r.count }))}
            empty="No call reasons captured in this period."
          />
        </div>

        <div>
          <h3 className="mb-3 text-2xs font-semibold uppercase tracking-[0.07em] text-panel-500">
            How they heard about you
          </h3>
          <Ranked
            items={data.referralSources.map((r) => ({ key: r.source, label: humanise(r.source), count: r.count }))}
            empty="No referral sources captured in this period."
          />
        </div>
      </div>

      <div>
        <h3 className="mb-1 text-2xs font-semibold uppercase tracking-[0.07em] text-panel-500">
          Asked for, not offered
        </h3>
        <p className="mb-3 text-sm leading-relaxed text-panel-600">
          Services callers requested that you do not currently sell or price.
        </p>
        {data.lostDemand.length === 0 ? (
          <NothingYet>Nothing was requested that you do not already offer.</NothingYet>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-panel-200 text-left text-2xs font-semibold uppercase tracking-[0.06em] text-panel-500">
                  <th scope="col" className="px-3 py-2">Service</th>
                  <th scope="col" className="px-3 py-2">Requests</th>
                  <th scope="col" className="px-3 py-2">Your price</th>
                  <th scope="col" className="px-3 py-2">Estimated value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-panel-100">
                {data.lostDemand.map((row) => (
                  <tr key={row.service}>
                    <td className="px-3 py-2 text-ink-800">{humanise(row.service)}</td>
                    <td data-numeric className="px-3 py-2 text-panel-600">{row.requests}</td>
                    {/* Not priced ⇒ no figure. A dollar value on a service the
                        business does not sell would be invented. */}
                    <td className="px-3 py-2 text-panel-600">{money(row.unitPrice) ?? <span className="text-panel-400">Not priced</span>}</td>
                    <td className="px-3 py-2 text-panel-600">
                      {money(row.estimatedValue) ?? <span className="text-panel-400">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-1 text-2xs font-semibold uppercase tracking-[0.07em] text-panel-500">
          Questions the agent could not answer
        </h3>
        <p className="mb-3 text-sm leading-relaxed text-panel-600">
          Each of these is one FAQ away from being handled on the next call.
        </p>
        {data.knowledgeGaps.length === 0 ? (
          <NothingYet>The agent answered everything it was asked.</NothingYet>
        ) : (
          <ul className="space-y-2">
            {data.knowledgeGaps.map((gap) => (
              <li
                key={gap.id}
                className="flex flex-wrap items-start justify-between gap-3 border border-panel-200 bg-surface-raised px-4 py-3"
              >
                <span className="text-sm leading-relaxed text-ink-800">{gap.question}</span>
                <span className="whitespace-nowrap text-xs text-panel-500">
                  asked <span data-numeric className="font-semibold text-ink-800">{gap.occurrences}</span>×
                  {' · '}
                  last {new Date(gap.lastSeenAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="mb-3 text-2xs font-semibold uppercase tracking-[0.07em] text-panel-500">
          When people call
        </h3>
        {data.peakTimes.length === 0 ? (
          <NothingYet>Not enough calls yet to show a pattern.</NothingYet>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {data.peakTimes.map((p) => (
              <li
                key={`${p.dow}-${p.hour}`}
                className="border border-panel-200 bg-surface-raised px-3 py-2 text-xs"
                // Weight by volume without spending chroma on it.
                style={{ opacity: 0.45 + (p.count / peakMax) * 0.55 }}
              >
                <span className="font-medium text-ink-800">
                  {DAYS[p.dow] ?? '?'} {hourLabel(p.hour)}
                </span>
                <span data-numeric className="ml-2 text-panel-500">{p.count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Cluster>
  );
}
