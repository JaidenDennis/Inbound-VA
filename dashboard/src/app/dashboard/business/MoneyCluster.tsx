'use client';

import { AlertTriangle } from 'lucide-react';
import { Cluster, Readout, NothingYet, money } from './Readout';

/**
 * Money — the counterfactual.
 *
 * The question this answers is "what would have happened without the agent",
 * which is why after-hours is its own row rather than a slice of the total: a
 * call at 9pm is one the practice would simply have missed.
 *
 * Revenue carries an "est." mark everywhere it appears. There are no invoices in
 * this system — it is derived from service prices — and a client who discovers
 * that for themselves stops trusting the rest of the page.
 */

export interface MoneyData {
  bookedAppointments: number;
  attributedRevenue: number | null;
  revenueIsEstimate: boolean;
  unmatchedAppointments: number;
  afterHoursCalls: number | null;
  afterHoursBookings: number | null;
  afterHoursRevenue: number | null;
  hoursConfigured: boolean;
  recoveredCalls: number;
  monthlyCost: number | null;
  costPerAppointment: number | null;
}

const NO_HOURS =
  'Your opening hours are not set, so we cannot tell an after-hours call from one during the day. Set them under Knowledge → Hours.';

export function MoneyCluster({ data }: { data: MoneyData | null }) {
  if (!data) {
    return (
      <Cluster title="Money" description="What the agent booked, and what it caught outside your hours.">
        <NothingYet>No calls in this period, so there is nothing to attribute yet.</NothingYet>
      </Cluster>
    );
  }

  return (
    <Cluster
      title="Money"
      description="What the agent booked, and what it caught outside your hours — the appointments that would otherwise have gone to voicemail."
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Readout label="Appointments booked" value={data.bookedAppointments} />
        <Readout
          label="Attributed revenue"
          value={money(data.attributedRevenue)}
          estimate={data.revenueIsEstimate}
          hint="Derived from your service prices, not from invoices."
          reason="No booked appointment in this period matched a priced service."
        />
        <Readout
          label="Missed calls recovered"
          value={data.recoveredCalls}
          hint="Callers the agent handled who would have reached voicemail."
        />
        <Readout
          label="After-hours calls"
          value={data.afterHoursCalls}
          reason={NO_HOURS}
          hint="Calls answered outside your opening hours."
        />
        <Readout label="After-hours bookings" value={data.afterHoursBookings} reason={NO_HOURS} />
        <Readout
          label="After-hours revenue"
          value={money(data.afterHoursRevenue)}
          estimate
          reason={NO_HOURS}
        />
      </div>

      {(data.monthlyCost !== null || data.costPerAppointment !== null) && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Readout label="Monthly cost" value={money(data.monthlyCost)} />
          <Readout
            label="Cost per appointment"
            value={money(data.costPerAppointment)}
            hint="Your monthly cost divided by appointments booked."
          />
        </div>
      )}

      {/* Named rather than dropped or averaged. Dropping them under-reports
          revenue and averaging over-reports it; showing the count is what gets
          the service names fixed. */}
      {data.unmatchedAppointments > 0 && (
        <div className="flex items-start gap-2 border border-lamp-fair-rim bg-lamp-fair-wash px-4 py-3 text-sm leading-relaxed text-lamp-fair-ink">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
          <p>
            <span data-numeric className="font-semibold">{data.unmatchedAppointments}</span>{' '}
            {data.unmatchedAppointments === 1 ? 'appointment is' : 'appointments are'} not counted in
            revenue because the service booked does not match a priced service in your list. Add the
            missing prices under Knowledge → Pricing and they will be included.
          </p>
        </div>
      )}
    </Cluster>
  );
}
