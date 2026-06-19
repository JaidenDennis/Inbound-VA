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
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-xl border p-4 text-center">
          <p className="text-3xl font-bold text-blue-600">{data.totalCalls}</p>
          <p className="text-sm text-gray-500 mt-1">Total Calls</p>
        </div>
        <div className="bg-white rounded-xl border p-4 text-center">
          <p className="text-3xl font-bold text-green-600">{data.leadsCapured}</p>
          <p className="text-sm text-gray-500 mt-1">Leads Captured</p>
        </div>
        <div className="bg-white rounded-xl border p-4 text-center">
          <p className="text-3xl font-bold text-purple-600">{data.conversionRate}%</p>
          <p className="text-sm text-gray-500 mt-1">Conversion Rate</p>
        </div>
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
