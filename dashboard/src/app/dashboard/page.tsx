'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Phone, Users, Calendar, TrendingUp, Activity, Clock } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { KPICard } from '@/components/KPICard';

interface Overview {
  totalCalls: number;
  leadsCapured: number;
  appointmentsBooked: number;
  avgCallDurationSeconds: number;
  conversionRate: string;
}

function LoadingSkeleton() {
  return (
    <div className="space-y-8">
      <div className="h-12 bg-gray-200 rounded-lg w-1/3 animate-pulse" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-32 bg-gray-200 rounded-lg animate-pulse" />
        ))}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get('/analytics/overview')
      .then((r) => setOverview(r.data))
      .catch(() => setOverview(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSkeleton />;
  if (!overview) return null;

  const minutes = Math.floor(overview.avgCallDurationSeconds / 60);
  const seconds = overview.avgCallDurationSeconds % 60;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Real-time overview of your AI operations"
        breadcrumbs={[{ label: 'Home' }, { label: 'Dashboard' }]}
      />

      {/* KPI Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        <KPICard
          label="Total Calls (30d)"
          value={overview.totalCalls.toLocaleString()}
          icon={Phone}
          color="primary"
          trend={12}
          trendLabel="vs last month"
        />
        <KPICard
          label="Leads Captured"
          value={overview.leadsCapured.toLocaleString()}
          icon={Users}
          color="secondary"
          trend={8}
          trendLabel="vs last month"
        />
        <KPICard
          label="Appointments Booked"
          value={overview.appointmentsBooked.toLocaleString()}
          icon={Calendar}
          color="accent"
          trend={15}
          trendLabel="vs last month"
        />
        <KPICard
          label="Conversion Rate"
          value={`${overview.conversionRate}%`}
          icon={TrendingUp}
          color="success"
          trend={3}
          trendLabel="vs last month"
        />
        <KPICard
          label="Avg Call Duration"
          value={`${minutes}m ${seconds}s`}
          icon={Clock}
          color="primary"
          subtitle="30-day average"
        />
        <KPICard
          label="System Status"
          value="Operational"
          icon={Activity}
          color="success"
          subtitle="All systems green"
        />
      </div>

      {/* Activity Section */}
      <div className="bg-white rounded-lg border border-gray-200 p-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Recent Activity</h2>
        <div className="text-center py-12">
          <Activity className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500 text-lg">Activity stream coming soon</p>
          <p className="text-gray-400 text-sm mt-2">Track recent calls, bookings, and system events here</p>
        </div>
      </div>
    </div>
  );
}
