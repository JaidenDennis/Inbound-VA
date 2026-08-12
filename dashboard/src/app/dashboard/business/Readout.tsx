'use client';

import type { ReactNode } from 'react';
import { Info } from 'lucide-react';

/**
 * Null-aware readouts for the owner view.
 *
 * The API is careful never to turn "we don't know" into 0 — no hours configured
 * means no after-hours figure, no billing baseline means no cost card, nothing
 * scored means no average. That care is wasted if the UI renders `null` as a
 * dash and lets the reader assume zero, so every unmeasured figure here says
 * *why* it is unmeasured, in a sentence the client can act on.
 *
 * A dashboard that quietly reports 0 for something it never measured is the one
 * a client eventually catches out, and after that they believe none of it.
 */

export function Readout({
  label,
  value,
  reason,
  hint,
  estimate = false,
}: {
  label: string;
  /** null means not measured. Zero is a real, rendered value. */
  value: string | number | null;
  /** Why it is not measured, and what to do about it. Required when value is null. */
  reason?: string;
  hint?: string;
  /** Marks a derived figure as an estimate. See the money cluster. */
  estimate?: boolean;
}) {
  const measured = value !== null && value !== undefined;

  return (
    <div className="border border-panel-200 bg-surface-raised px-5 py-4">
      <p className="truncate text-2xs font-semibold uppercase tracking-[0.07em] text-panel-500">
        {label}
      </p>

      {measured ? (
        <p
          data-numeric
          className="mt-2.5 font-heading text-3xl font-semibold tracking-[-0.022em] text-ink-900"
        >
          {value}
          {estimate && (
            <span className="ml-1.5 align-middle text-2xs font-semibold uppercase tracking-[0.06em] text-panel-500">
              est.
            </span>
          )}
        </p>
      ) : (
        <p className="mt-2.5 font-heading text-xl font-medium tracking-[-0.01em] text-panel-400">
          Not measured
        </p>
      )}

      {(hint || (!measured && reason)) && (
        <p className="mt-2 text-xs leading-relaxed text-panel-500">
          {measured ? hint : reason}
        </p>
      )}
    </div>
  );
}

/**
 * Coverage, travelling with the figure it qualifies.
 *
 * Signal capture starts at each agent's next re-provision and there is no
 * backfill, so a demand list covering 4 of 41 calls is not "what callers want",
 * it is a sample. Without this line a thin list reads as a business nobody is
 * asking anything — a wrong conclusion drawn from a correct number.
 */
export function Coverage({
  analyzed,
  total,
  noun = 'calls',
}: {
  analyzed: number;
  total: number;
  noun?: string;
}) {
  if (total === 0) return null;
  const percent = Math.round((analyzed / total) * 1000) / 10;
  const thin = percent < 100;

  return (
    <p className="flex items-start gap-1.5 text-xs leading-relaxed text-panel-500">
      <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden />
      <span>
        Based on{' '}
        <span data-numeric className="font-medium text-ink-800">
          {analyzed} of {total}
        </span>{' '}
        {noun} ({percent}%).
        {thin && ' Signal capture starts when an agent is next updated and cannot be backfilled, so earlier calls are not counted.'}
      </span>
    </p>
  );
}

/** A cluster heading with its own explanation, so each panel stands alone. */
export function Cluster({
  title,
  description,
  children,
  aside,
}: {
  title: string;
  description: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-base font-semibold text-ink-900">{title}</h2>
          <p className="mt-0.5 max-w-2xl text-sm leading-relaxed text-panel-600">{description}</p>
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** An empty state that explains itself rather than showing an empty box. */
export function NothingYet({ children }: { children: ReactNode }) {
  return (
    <div className="border border-dashed border-panel-300 bg-panel-25 px-5 py-8 text-center text-sm leading-relaxed text-panel-500">
      {children}
    </div>
  );
}

/** Money, formatted once so every cluster agrees. */
export function money(value: number | null): string | null {
  if (value === null || value === undefined) return null;
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}
