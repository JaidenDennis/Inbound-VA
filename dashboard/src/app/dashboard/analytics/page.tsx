'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface Overview {
  totalCalls: number;
  leadsCapured: number;
  appointmentsBooked: number;
  avgCallDurationSeconds: number;
  conversionRate: string;
  period: { from: string; to: string };
}

export default function AnalyticsPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/analytics/overview').then((r) => setData(r.data)).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-gray-400 animate-pulse">Loading analytics...</div>;
  if (!data) return null;

  const chartData = [
    { name: 'Calls', value: data.totalCalls, fill: '#3b5bdb' },
    { name: 'Leads', value: data.leadsCapured, fill: '#40c057' },
    { name: 'Bookings', value: data.appointmentsBooked, fill: '#7950f2' },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Analytics</h1>
      <p className="text-sm text-gray-400 mb-6">
        {new Date(data.period.from).toLocaleDateString()} – {new Date(data.period.to).toLocaleDateString()}
      </p>
      {/* These three figures were blue / green / purple, which read as a
          traffic light over metrics that carry no health meaning at all — and
          purple is not in the token system, so it rendered as stock Tailwind.
          Figures are ink; chroma stays with real status. */}
      <div className="mb-8 grid grid-cols-1 overflow-hidden rounded-xl border border-panel-200 bg-white sm:grid-cols-3">
        {[
          { label: 'Total calls', value: data.totalCalls },
          { label: 'Leads captured', value: data.leadsCapured },
          { label: 'Conversion rate', value: `${data.conversionRate}%` },
        ].map((m, i) => (
          <div
            key={m.label}
            className={`px-5 py-4 ${i > 0 ? 'border-t border-panel-200 sm:border-l sm:border-t-0' : ''}`}
          >
            <p className="text-2xs font-semibold uppercase tracking-[0.07em] text-panel-500">
              {m.label}
            </p>
            <p data-numeric className="mt-2 font-heading text-3xl font-semibold tracking-[-0.022em] text-ink-900">
              {m.value}
            </p>
          </div>
        ))}
      </div>
      <div className="bg-white rounded-xl border p-6">
        <h2 className="font-semibold text-gray-700 mb-4">Performance Overview</h2>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f3f4" />
            <XAxis dataKey="name" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            <Bar dataKey="value" fill="#3b5bdb" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
