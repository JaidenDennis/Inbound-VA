'use client';

import { Info } from 'lucide-react';
import { Cluster, Readout, NothingYet, money } from './Readout';

/**
 * Follow-through and cumulative ROI.
 *
 * Two things that only make sense next to each other: the funnel says where
 * this period's leads stopped, ROI says what the whole relationship has been
 * worth since launch. One is windowed, the other never is.
 */

export interface FunnelData {
  captured: number;
  contacted: number;
  booked: number;
  contactedIsInferred: boolean;
}

export interface RoiData {
  since: string;
  asOf: string;
  bookedAppointments: number;
  attributedRevenue: number;
  afterHoursRevenue: number;
  recoveredCalls: number;
  totalCost: number | null;
  netReturn: number | null;
  revenueIsEstimate: boolean;
}

export interface RoiResponse {
  data: RoiData | null;
  reason?: 'not_live' | 'no_snapshot';
  detail?: string;
}

function Stage({ label, value, of, note }: { label: string; value: number; of: number; note?: string }) {
  const percent = of > 0 ? Math.round((value / of) * 1000) / 10 : null;

  return (
    <div className="rounded-xl border border-panel-200 bg-white px-5 py-4">
      <p className="text-2xs font-semibold uppercase tracking-[0.07em] text-panel-500">{label}</p>
      <p data-numeric className="mt-2.5 font-heading text-3xl font-semibold tracking-[-0.022em] text-ink-900">
        {value}
      </p>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-panel-100">
        <div className="h-full rounded-full bg-panel-400" style={{ width: `${percent ?? 0}%` }} />
      </div>
      <p className="mt-2 text-xs leading-relaxed text-panel-500">
        {percent === null ? 'No leads captured in this period.' : `${percent}% of captured`}
        {note && ` · ${note}`}
      </p>
    </div>
  );
}

export function FollowThroughCluster({ funnel, roi }: { funnel: FunnelData | null; roi: RoiResponse | null }) {
  return (
    <>
      <Cluster
        title="Follow-through"
        description="Where this period's leads stopped. The drop between two stages is the one worth fixing."
      >
        {!funnel || funnel.captured === 0 ? (
          <NothingYet>No leads captured in this period.</NothingYet>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Stage label="Captured" value={funnel.captured} of={funnel.captured} />
              <Stage
                label="Contacted"
                value={funnel.contacted}
                of={funnel.captured}
                note={funnel.contactedIsInferred ? 'inferred' : undefined}
              />
              <Stage label="Booked" value={funnel.booked} of={funnel.captured} />
            </div>

            {/* Flagged rather than presented as measured: there is no explicit
                "contacted" state in the schema, so it is inferred from a contact
                having more than one conversation. */}
            {funnel.contactedIsInferred && (
              <p className="flex items-start gap-1.5 text-xs leading-relaxed text-panel-500">
                <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden />
                <span>
                  &ldquo;Contacted&rdquo; is inferred from a contact having more than one
                  conversation — it is not a status anyone sets, so treat it as an indicator rather
                  than a count.
                </span>
              </p>
            )}
          </>
        )}
      </Cluster>

      <Cluster
        title="Since launch"
        description="Cumulative, never windowed. This is the number to bring to a renewal conversation."
      >
        {!roi ? (
          <NothingYet>Loading.</NothingYet>
        ) : !roi.data ? (
          // "Not launched" and "earned nothing" are different statements, and the
          // API is careful to distinguish them. So is this.
          <NothingYet>{roi.detail ?? 'No cumulative figures yet.'}</NothingYet>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Readout label="Appointments booked" value={roi.data.bookedAppointments} />
              <Readout
                label="Attributed revenue"
                value={money(roi.data.attributedRevenue)}
                estimate={roi.data.revenueIsEstimate}
                hint="Derived from your service prices."
              />
              <Readout
                label="Total cost"
                value={money(roi.data.totalCost)}
                reason="No billing baseline is configured for this client, so cost cannot be compared."
              />
              <Readout
                label="Net return"
                value={money(roi.data.netReturn)}
                estimate
                reason="Needs a billing baseline before a return can be calculated."
              />
            </div>
            <p className="text-xs text-panel-500">
              Since {new Date(roi.data.since).toLocaleDateString()} · as of{' '}
              {new Date(roi.data.asOf).toLocaleDateString()} ·{' '}
              <span data-numeric>{roi.data.recoveredCalls}</span> missed calls recovered ·{' '}
              {money(roi.data.afterHoursRevenue)} of revenue came from after-hours calls
            </p>
          </>
        )}
      </Cluster>
    </>
  );
}
