'use client';

import { Cluster, Readout, Coverage, NothingYet } from './Readout';
import { LampStatus } from '@/components/StatusLamp';

/**
 * Trust — how often the agent handled it alone, and where it did not.
 *
 * Deliberately candid. Escalation reasons and flagged calls are the numbers a
 * vendor is tempted to bury, and they are exactly the ones that make the rest
 * credible: a client who can see what went wrong believes the figures that say
 * what went right.
 */

export interface TrustData {
  totalCalls: number;
  transferredCalls: number;
  containmentRate: number | null;
  flaggedCalls: number;
  avgQuality: number | null;
  quality: { analyzedCalls: number; totalCalls: number; coveragePercent: number | null };
  escalationsByReason: Array<{ reason: string; count: number }>;
}

/**
 * Containment as a lamp.
 *
 * The thresholds are judgement, not measurement, so they are stated here rather
 * than implied by colour alone — the label always carries the number.
 */
function containmentLevel(rate: number): 'good' | 'fair' | 'bad' {
  if (rate >= 80) return 'good';
  if (rate >= 60) return 'fair';
  return 'bad';
}

/** Reason codes are stored as slugs; render them as language. */
function humanise(reason: string): string {
  return reason.replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

export function TrustCluster({ data }: { data: TrustData | null }) {
  if (!data || data.totalCalls === 0) {
    return (
      <Cluster title="Trust" description="How often the agent handled a call on its own.">
        <NothingYet>No calls in this period.</NothingYet>
      </Cluster>
    );
  }

  const maxEscalation = Math.max(1, ...data.escalationsByReason.map((e) => e.count));

  return (
    <Cluster
      title="Trust"
      description="How often the agent handled the call on its own, and every reason it did not."
      aside={
        data.containmentRate !== null && (
          <LampStatus
            level={containmentLevel(data.containmentRate)}
            label={`${data.containmentRate}% handled without a person`}
            seated
          />
        )
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Readout label="Calls" value={data.totalCalls} />
        <Readout
          label="Handled alone"
          value={data.containmentRate === null ? null : `${data.containmentRate}%`}
          reason="No calls in this period, so there is no rate to report."
          hint={`${data.totalCalls - data.transferredCalls} of ${data.totalCalls} needed nobody.`}
        />
        <Readout label="Transferred to a person" value={data.transferredCalls} />
        <Readout
          label="Average quality"
          value={data.avgQuality === null ? null : `${Math.round(data.avgQuality * 10) / 10}`}
          reason="No call in this period has been scored yet. Scoring starts once call analysis has run."
          hint="Every call is scored, not a sample."
        />
      </div>

      <Coverage
        analyzed={data.quality.analyzedCalls}
        total={data.quality.totalCalls}
        noun="calls scored"
      />

      <div>
        <h3 className="mb-3 text-2xs font-semibold uppercase tracking-[0.07em] text-panel-500">
          Why calls reached a person
        </h3>
        {data.escalationsByReason.length === 0 ? (
          <NothingYet>
            No call was escalated in this period — the agent handled every one it took.
          </NothingYet>
        ) : (
          <ul className="space-y-2">
            {data.escalationsByReason.map((e) => (
              <li key={e.reason} className="rounded-lg border border-panel-200 bg-white px-4 py-3">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm text-ink-800">{humanise(e.reason)}</span>
                  <span data-numeric className="text-sm font-semibold text-ink-900">{e.count}</span>
                </div>
                {/* Proportion as length, not hue: chroma on this surface means
                    state, and an escalation reason is a quantity. */}
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-panel-100">
                  <div
                    className="h-full rounded-full bg-panel-400"
                    style={{ width: `${(e.count / maxEscalation) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {data.flaggedCalls > 0 && (
        <p className="text-sm text-panel-600">
          <span data-numeric className="font-semibold text-ink-900">{data.flaggedCalls}</span>{' '}
          {data.flaggedCalls === 1 ? 'call was' : 'calls were'} flagged for review. They are in the
          work queue.
        </p>
      )}
    </Cluster>
  );
}
