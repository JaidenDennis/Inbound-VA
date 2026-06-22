'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Phone, Search, Download } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/Badge';

interface Call {
  id: string;
  from_number: string;
  to_number: string;
  status: string;
  duration_seconds: number | null;
  started_at: string;
  client_id: string;
}

export default function CallsPage() {
  const [calls, setCalls] = useState<Call[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    api
      .get('/admin/calls')
      .then((r) => {
        setCalls(r.data.data ?? []);
        setTotal(r.data.count ?? 0);
      })
      .finally(() => setLoading(false));
  }, []);

  const filteredCalls = calls.filter(
    (call) =>
      call.from_number.includes(searchQuery) ||
      call.to_number.includes(searchQuery) ||
      call.status.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const statusVariantMap: Record<string, 'success' | 'primary' | 'warning' | 'error' | 'gray'> = {
    completed: 'success',
    in_progress: 'primary',
    failed: 'error',
    transferred: 'warning',
  };

  if (loading) {
    return (
      <div className="space-y-8">
        <div className="h-12 bg-gray-200 rounded-lg w-1/3 animate-pulse" />
        <div className="h-64 bg-gray-200 rounded-lg animate-pulse" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Calls"
        description="View and manage all inbound voice calls"
        breadcrumbs={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Calls' }]}
        action={
          <button className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors duration-200 flex items-center gap-2 cursor-pointer">
            <Download className="w-4 h-4" />
            Export
          </button>
        }
      />

      {/* Search */}
      <div className="mb-6 relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder="Search by phone number or status..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-600 focus:border-transparent"
        />
      </div>

      {/* Data Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm hover:shadow-md transition-shadow duration-200">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-6 py-4 font-semibold text-gray-700 uppercase tracking-wide text-xs">From</th>
                <th className="text-left px-6 py-4 font-semibold text-gray-700 uppercase tracking-wide text-xs">To</th>
                <th className="text-left px-6 py-4 font-semibold text-gray-700 uppercase tracking-wide text-xs">Status</th>
                <th className="text-left px-6 py-4 font-semibold text-gray-700 uppercase tracking-wide text-xs">Duration</th>
                <th className="text-left px-6 py-4 font-semibold text-gray-700 uppercase tracking-wide text-xs">Started</th>
                <th className="text-left px-6 py-4 font-semibold text-gray-700 uppercase tracking-wide text-xs">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredCalls.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50 transition-colors duration-150">
                  <td className="px-6 py-4 font-mono text-gray-900">{c.from_number}</td>
                  <td className="px-6 py-4 font-mono text-gray-900">{c.to_number}</td>
                  <td className="px-6 py-4">
                    <Badge label={c.status} variant={statusVariantMap[c.status] ?? 'gray'} size="md" />
                  </td>
                  <td className="px-6 py-4 text-gray-700">
                    {c.duration_seconds != null ? `${Math.floor(c.duration_seconds / 60)}m ${c.duration_seconds % 60}s` : '—'}
                  </td>
                  <td className="px-6 py-4 text-gray-600">{new Date(c.started_at).toLocaleString()}</td>
                  <td className="px-6 py-4">
                    <Link href={`/dashboard/calls/${c.id}`} className="text-primary-600 hover:text-primary-700 font-medium transition-colors cursor-pointer">
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {filteredCalls.length === 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <Phone className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500 text-lg">No calls found</p>
          <p className="text-gray-400 text-sm mt-1">Try adjusting your search filters or check back soon</p>
        </div>
      )}
    </div>
  );
}
