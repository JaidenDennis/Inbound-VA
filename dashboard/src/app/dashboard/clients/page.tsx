'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Plus } from 'lucide-react';

interface Client {
  id: string;
  name: string;
  industry: string;
  status: string;
  phone_numbers: string[];
  created_at: string;
}

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/clients').then((r) => {
      setClients(r.data.data);
      setTotal(r.data.count);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-gray-400 animate-pulse">Loading clients...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Clients <span className="text-gray-400 text-lg font-normal">({total})</span></h1>
        <Link href="/dashboard/clients/new" className="flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold px-4 py-2 rounded-lg transition">
          <Plus className="w-4 h-4" /> New Client
        </Link>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Industry</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Phone Numbers</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {clients.map((c) => (
              <tr key={c.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Link href={`/dashboard/clients/${c.id}`} className="font-medium text-brand-600 hover:underline">{c.name}</Link>
                </td>
                <td className="px-4 py-3 capitalize text-gray-600">{c.industry}</td>
                <td className="px-4 py-3 text-gray-500">{c.phone_numbers.join(', ') || '—'}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${c.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {c.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-400">{new Date(c.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
