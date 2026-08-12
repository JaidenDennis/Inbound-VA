'use client';

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

export interface VolumePoint {
  bucket: string;
  answered: number;
  voicemail: number;
  total: number;
}

/**
 * Calls over time, answered vs voicemail.
 *
 * Stacked area: the two series sum to every call in the period, so the job is
 * part-to-whole over time — the stack height is the total, which is a number the
 * reader wants anyway.
 *
 * Two series only, so identity is comfortable on colour — but the legend is
 * present regardless (identity is never colour-alone) and the tooltip names both
 * series with their swatch.
 */
export function VolumeChart({ data, bucket }: { data: VolumePoint[]; bucket: 'day' | 'week' }) {
  const formatBucket = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-gray-400">
        No calls in this period.
      </div>
    );
  }

  return (
    <div>
      {/* Legend above the plot: always present for two or more series. The
          swatch carries identity — and mirrors the plot's fill texture, not
          just its colour — while the text stays in an ink token, never the
          series colour, which would be illegible for the lighter hues. */}
      <div className="mb-3 flex flex-wrap items-center gap-4 font-mono text-2xs uppercase tracking-[0.16em] text-text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5" style={{ background: 'var(--series-1)' }} aria-hidden />
          Answered
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5"
            style={{
              backgroundColor: 'transparent',
              backgroundImage:
                'repeating-linear-gradient(45deg, var(--series-2) 0 1.5px, transparent 1.5px 4px)',
            }}
            aria-hidden
          />
          Voicemail
        </span>
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
          {/* Series 1: solid cobalt wash. Series 2: hatched ink — texture, not
              hue, carries the difference, which is what makes this pair
              CVD-safe. */}
          <defs>
            <linearGradient id="fill-answered" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.20} />
              <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0.05} />
            </linearGradient>
            <pattern id="fill-voicemail" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="var(--series-2)" fillOpacity={0.06} />
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--series-2)" strokeWidth="1.5" strokeOpacity={0.35} />
            </pattern>
          </defs>

          {/* Hairline, solid, horizontal only — recessive by design. */}
          <CartesianGrid stroke="var(--gridline)" strokeWidth={1} vertical={false} />

          <XAxis
            dataKey="bucket"
            tickFormatter={formatBucket}
            tick={{ fill: 'var(--text-muted)', fontSize: 11, fontFamily: 'var(--font-mono)' }}
            tickLine={false}
            axisLine={{ stroke: 'var(--baseline)' }}
            minTickGap={24}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fill: 'var(--text-muted)', fontSize: 11, fontFamily: 'var(--font-mono)' }}
            tickLine={false}
            axisLine={false}
            width={44}
          />

          <Tooltip
            cursor={{ stroke: 'var(--baseline)', strokeWidth: 1 }}
            contentStyle={{
              background: 'var(--surface-1)',
              border: '1px solid var(--baseline)',
              borderRadius: 0,
              fontSize: 12,
              color: 'rgb(var(--text-rgb))',
            }}
            labelFormatter={(v) =>
              new Date(v as string).toLocaleDateString(undefined, {
                weekday: bucket === 'day' ? 'short' : undefined,
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })
            }
            formatter={(value: number, name: string) => [value, name === 'answered' ? 'Answered' : 'Voicemail']}
          />

          {/* 2px lines, round joins; stacked so height reads as total calls. */}
          <Area
            type="monotone"
            dataKey="answered"
            stackId="calls"
            stroke="var(--series-1)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            fill="url(#fill-answered)"
          />
          <Area
            type="monotone"
            dataKey="voicemail"
            stackId="calls"
            stroke="var(--series-2)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            fill="url(#fill-voicemail)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
