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
 * still accepted; the icon now sits inline at label scale, and `color` remains
 * accepted and inert — the cell's chroma is the cobalt wash, which means
 * "this is a readout you can open", not a status.
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
    // The site's `.kpi`: a cobalt-rimmed well on a cobalt wash. The figure
    // is the subject; everything else is a label around it.
    <div
      className="group border bg-action-50 px-4 py-3"
      style={{ borderColor: 'var(--action-rim)' }}
    >
      <div className="flex items-center gap-2">
        <Icon className="h-3 w-3 flex-shrink-0 text-text-muted" aria-hidden strokeWidth={1.75} />
        <p className="truncate font-mono text-2xs uppercase tracking-[0.16em] text-text-muted">
          {label}
        </p>
      </div>

      <p data-numeric className="mt-2 font-heading text-3xl font-medium tracking-[-0.022em] text-text">
        {value}
      </p>

      {(trend !== undefined || trendLabel || subtitle) && (
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {trend !== undefined && (
            <span
              data-numeric
              className={clsx(
                'inline-flex items-baseline gap-0.5 font-mono text-2xs font-medium',
                rising ? 'text-lamp-good-ink' : 'text-lamp-bad-ink'
              )}
            >
              <Arrow className="h-3 w-3 self-center" aria-hidden strokeWidth={2.25} />
              {Math.abs(trend)}%
            </span>
          )}
          {(trendLabel || subtitle) && (
            <span className="truncate text-xs text-text-muted">{trendLabel ?? subtitle}</span>
          )}
        </div>
      )}
    </div>
  );
}
