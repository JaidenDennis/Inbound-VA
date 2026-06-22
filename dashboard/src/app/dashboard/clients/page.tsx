'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Search, Edit2, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/Badge';

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
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    api
      .get('/clients')
      .then((r) => {
        setClients(r.data.data);
        setTotal(r.data.count);
      })
      .finally(() => setLoading(false));
  }, []);

  const filteredClients = clients.filter(
    (client) =>
      client.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      client.industry.toLowerCase().includes(searchQuery.toLowerCase()) ||
      client.phone_numbers.some((p) => p.includes(searchQuery))
  );

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
        title="Clients"
        description="Manage all client accounts and configurations"
        breadcrumbs={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Clients' }]}
        action={
          <Link
            href="/dashboard/clients/new"
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors duration-200 flex items-center gap-2 cursor-pointer inline-flex"
          >
            <Plus className="w-4 h-4" />
            Add Client
          </Link>
        }
      />

      {/* Search */}
      <div className="mb-6 relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder="Search by name, industry, or phone..."
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
                <th className="text-left px-6 py-4 font-semibold text-gray-700 uppercase tracking-wide text-xs">Name</th>
                <th className="text-left px-6 py-4 font-semibold text-gray-700 uppercase tracking-wide text-xs">Industry</th>
                <th className="text-left px-6 py-4 font-semibold text-gray-700 uppercase tracking-wide text-xs">Phone Numbers</th>
                <th className="text-left px-6 py-4 font-semibold text-gray-700 uppercase tracking-wide text-xs">Status</th>
                <th className="text-left px-6 py-4 font-semibold text-gray-700 uppercase tracking-wide text-xs">Created</th>
                <th className="text-left px-6 py-4 font-semibold text-gray-700 uppercase tracking-wide text-xs">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredClients.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50 transition-colors duration-150">
                  <td className="px-6 py-4">
                    <Link href={`/dashboard/clients/${c.id}`} className="font-medium text-primary-600 hover:text-primary-700 cursor-pointer transition-colors">
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-6 py-4 text-gray-700 capitalize">{c.industry}</td>
                  <td className="px-6 py-4 text-gray-600 font-mono text-xs">{c.phone_numbers.join(', ') || '—'}</td>
                  <td className="px-6 py-4">
                    <Badge
                      label={c.status}
                      variant={c.status === 'active' ? 'success' : 'gray'}
                      size="md"
                    />
                  </td>
                  <td className="px-6 py-4 text-gray-600">{new Date(c.created_at).toLocaleDateString()}</td>
                  <td className="px-6 py-4">
                    <div className="flex gap-2">
                      <button className="p-1 text-gray-600 hover:text-primary-600 transition-colors cursor-pointer" title="Edit client">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button className="p-1 text-gray-600 hover:text-red-600 transition-colors cursor-pointer" title="Delete client">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {filteredClients.length === 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <p className="text-gray-500 text-lg">No clients found</p>
          <p className="text-gray-400 text-sm mt-1">Try adjusting your search or create a new client</p>
        </div>
      )}
    </div>
  );
}
