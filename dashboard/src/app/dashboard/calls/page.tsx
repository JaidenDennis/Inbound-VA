'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

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

  useEffect(() => {
    api.get('/admin/calls').then((r) => {
      setCalls(r.data.data ?? []);
      setTotal(r.data.count ?? 0);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-gray-400 animate-pulse">Loading calls...</div>;

  const statusColor: Record<string, string> = {
    completed: 'bg-green-100 text-green-700',
    in_progress: 'bg-blue-100 text-blue-700',
    failed: 'bg-red-100 text-red-700',
    transferred: 'bg-yellow-100 text-yellow-700',
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Calls <span className="text-gray-400 text-lg font-normal">({total})</span></h1>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">From</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">To</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Duration</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Started</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {calls.map((c) => (
              <tr key={c.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-gray-700">{c.from_number}</td>
                <td className="px-4 py-3 font-mono text-gray-700">{c.to_number}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor[c.status] ?? 'bg-gray-100 text-gray-500'}`}>
                    {c.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-600">
                  {c.duration_seconds != null ? `${Math.floor(c.duration_seconds / 60)}m ${c.duration_seconds % 60}s` : '—'}
                </td>
                <td className="px-4 py-3 text-gray-400">{new Date(c.started_at).toLocaleString()}</td>
                <td className="px-4 py-3">
                  <Link href={`/dashboard/calls/${c.id}`} className="text-brand-600 hover:underline text-xs">View</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
