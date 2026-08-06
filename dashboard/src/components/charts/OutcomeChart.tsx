'use client';

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList,
} from 'recharts';

export interface OutcomePoint {
  outcome: string;
  count: number;
}

export const OUTCOME_LABELS: Record<string, string> = {
  appointment_booked: 'Appointment booked',
  lead_captured: 'Lead captured',
  transferred: 'Transferred to a person',
  voicemail: 'Voicemail',
  question_answered: 'Question answered',
  abandoned: 'Abandoned',
};

/**
 * Where calls ended up.
 *
 * Horizontal bars in ONE hue, not six.
 *
 * The categories are nominal — there is no natural order to "booked" vs
 * "transferred" — and the reader's job is comparing magnitude, which the bar
 * length already encodes. Giving each bar its own colour would double-encode
 * length as hue, spend the only free channel on information already on screen,
 * and force six hues where two would do. One series, one colour.
 *
 * Horizontal because the category names are long; as columns they would be
 * rotated or truncated. A single series also needs no legend box — the title
 * says what is plotted.
 */
export function OutcomeChart({ data }: { data: OutcomePoint[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-gray-400">
        No calls in this period.
      </div>
    );
  }

  const rows = data.map((d) => ({ ...d, label: OUTCOME_LABELS[d.outcome] ?? d.outcome }));
  // Bars are capped at 24px; the chart grows with the category count instead of
  // fattening the bars to fill the space.
  const height = Math.max(200, rows.length * 44 + 24);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 44, bottom: 0, left: 8 }}>
        <CartesianGrid stroke="var(--gridline)" strokeWidth={1} horizontal={false} />

        <XAxis
          type="number"
          allowDecimals={false}
          tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
          tickLine={false}
          axisLine={{ stroke: 'var(--baseline)' }}
        />
        <YAxis
          type="category"
          dataKey="label"
          tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          width={150}
        />

        <Tooltip
          cursor={{ fill: 'var(--gridline)', fillOpacity: 0.4 }}
          contentStyle={{
            background: 'var(--surface-1)',
            border: '1px solid var(--gridline)',
            borderRadius: 8,
            fontSize: 12,
          }}
          formatter={(value: number) => [value, 'Calls']}
        />

        {/* 4px rounded data-end, square at the baseline; ≤24px thick. */}
        <Bar dataKey="count" fill="var(--series-1)" barSize={20} radius={[0, 4, 4, 0]}>
          {/* Value at the tip — six bars is few enough that every value fits
              outside the bar without collision, and it saves a second lookup. */}
          <LabelList
            dataKey="count"
            position="right"
            offset={8}
            style={{ fill: 'var(--text-secondary)', fontSize: 12 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
