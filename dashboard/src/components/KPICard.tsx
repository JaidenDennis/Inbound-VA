'use client';

import { LucideIcon, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import clsx from 'clsx';

/**
 * A panel readout, not a metric card.
 *
 * The icon-tile + big-number + accent-pill card is the template every dashboard
 * ships; it spends a whole container on one figure and makes six of them look
 * identical. This renders as a readout cell instead: instrument label, the
 * figure at real scale in tabular figures, and the movement underneath.
 *
 * Props are unchanged so existing routes keep working. `icon` and `color` are
 * still accepted; the icon now sits inline at label scale, and `color` no
 * longer tints the cell, because chroma on this surface is reserved for status.
 */

interface KPICardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  color: 'primary' | 'secondary' | 'accent' | 'success' | 'error';
  trend?: number;
  trendLabel?: string;
  subtitle?: string;
}

export function KPICard({ label, value, icon: Icon, trend, trendLabel, subtitle }: KPICardProps) {
  const rising = typeof trend === 'number' && trend >= 0;
  const Arrow = rising ? ArrowUpRight : ArrowDownRight;

  return (
    <div className="group relative border border-panel-200 bg-surface-raised px-5 py-4 transition-colors duration-150 ease-out hover:border-panel-300">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 flex-shrink-0 text-panel-500" aria-hidden strokeWidth={1.75} />
        <p className="truncate text-2xs font-semibold uppercase tracking-[0.07em] text-panel-500">
          {label}
        </p>
      </div>

      <p
        data-numeric
        className="mt-2.5 font-heading text-3xl font-semibold tracking-[-0.022em] text-ink-900"
      >
        {value}
      </p>

      {(trend !== undefined || trendLabel || subtitle) && (
        <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {trend !== undefined && (
            <span
              data-numeric
              className={clsx(
                'inline-flex items-baseline gap-0.5 text-xs font-semibold',
                rising ? 'text-lamp-good-ink' : 'text-lamp-bad-ink'
              )}
            >
              <Arrow className="h-3 w-3 self-center" aria-hidden strokeWidth={2.25} />
              {Math.abs(trend)}%
            </span>
          )}
          {(trendLabel || subtitle) && (
            <span className="truncate text-xs text-panel-500">{trendLabel ?? subtitle}</span>
          )}
        </div>
      )}
    </div>
  );
}
