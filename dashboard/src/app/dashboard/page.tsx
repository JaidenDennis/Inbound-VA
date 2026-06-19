'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Phone, Users, Calendar, TrendingUp } from 'lucide-react';

interface Overview {
  totalCalls: number;
  leadsCapured: number;
  appointmentsBooked: number;
  avgCallDurationSeconds: number;
  conversionRate: string;
}

function StatCard({ label, value, icon: Icon, color }: { label: string; value: string | number; icon: React.ElementType; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 flex items-center gap-4">
      <div className={`p-3 rounded-lg ${color}`}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div>
        <p className="text-sm text-gray-500">{label}</p>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/analytics/overview').then((r) => setOverview(r.data)).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="animate-pulse text-gray-400">Loading...</div>;
  if (!overview) return null;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Overview</h1>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total Calls (30d)" value={overview.totalCalls} icon={Phone} color="bg-blue-500" />
        <StatCard label="Leads Captured" value={overview.leadsCapured} icon={Users} color="bg-green-500" />
        <StatCard label="Appointments Booked" value={overview.appointmentsBooked} icon={Calendar} color="bg-purple-500" />
        <StatCard label="Conversion Rate" value={`${overview.conversionRate}%`} icon={TrendingUp} color="bg-orange-500" />
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="font-semibold text-gray-700 mb-2">Avg Call Duration</h2>
        <p className="text-3xl font-bold">{Math.round(overview.avgCallDurationSeconds / 60)}m {overview.avgCallDurationSeconds % 60}s</p>
      </div>
    </div>
  );
}
