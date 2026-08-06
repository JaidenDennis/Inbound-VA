'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { SyncBadge, StatusPill } from '@/components/StatusPill';
import { useSession } from '@/lib/SessionProvider';
import { RefreshCw, AlertTriangle } from 'lucide-react';

interface AgentRow {
  id: string;
  name: string;
  industry: string;
  retell_agent_id: string | null;
  retell_agent_version: number | null;
  agent_sync_state: string;
  agent_sync_error: string | null;
  agent_synced_at: string | null;
  phone_numbers: string[] | null;
  is_active: boolean;
}

export default function AgentsPage() {
  const { can } = useSession();
  const canWrite = can('agents:write');

  const [rows, setRows] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api
      .get('/agents')
      .then((r) => setRows(r.data.data ?? []))
      .catch((e) => setError(e?.response?.data?.error ?? 'Could not load agents'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const syncNow = async (clientId: string) => {
    setSyncing(clientId);
    try {
      await api.post(`/clients/${clientId}/agent/sync`);
      toast.success('Sync queued');
      load();
    } catch (e) {
      const data = (e as { response?: { data?: { error?: string; problems?: string[] } } })?.response?.data;
      // Validation problems are the useful part — show them, not a generic failure.
      toast.error(data?.problems?.join('; ') ?? data?.error ?? 'Sync failed');
    } finally {
      setSyncing(null);
    }
  };

  const failing = rows.filter((r) => r.agent_sync_state === 'failed');

  return (
    <div>
      <PageHeader
        title="Agents"
        description="Every client's voice agent, its configuration, and whether the live agent matches it."
      />

      {failing.length > 0 && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
          <p>
            {failing.length} agent{failing.length > 1 ? 's are' : ' is'} out of sync with the dashboard.
            Callers still hear the last configuration that published successfully.
          </p>
        </div>
      )}

      {error && (
        <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse border-b border-gray-100 bg-gray-50 last:border-0" />
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full">
              <caption className="sr-only">Client agents and sync state</caption>
              <thead className="sticky top-0 bg-gray-50">
                <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase tracking-wide text-gray-700">
                  <th scope="col" className="px-6 py-3">Client</th>
                  <th scope="col" className="px-6 py-3">Numbers</th>
                  <th scope="col" className="px-6 py-3">Agent</th>
                  <th scope="col" className="px-6 py-3">Sync</th>
                  <th scope="col" className="px-6 py-3">Last published</th>
                  <th scope="col" className="px-6 py-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((row) => (
                  <tr key={row.id} className="text-sm transition-colors hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <Link
                        href={`/dashboard/clients/${row.id}/agent`}
                        className="font-medium text-primary-700 hover:underline focus:outline-none focus:ring-2 focus:ring-primary-500"
                      >
                        {row.name}
                      </Link>
                      <p className="text-xs text-gray-500">{row.industry}</p>
                    </td>
                    <td className="px-6 py-4 font-mono text-xs text-gray-600">
                      {(row.phone_numbers ?? []).join(', ') || '—'}
                    </td>
                    <td className="px-6 py-4">
                      {row.retell_agent_id
                        ? <span className="font-mono text-xs text-gray-600">v{row.retell_agent_version ?? '?'}</span>
                        : <StatusPill tone="neutral" label="Not provisioned" />}
                    </td>
                    <td className="px-6 py-4">
                      <SyncBadge state={row.agent_sync_state} />
                      {row.agent_sync_error && (
                        <p className="mt-1 max-w-xs truncate text-xs text-red-600" title={row.agent_sync_error}>
                          {row.agent_sync_error}
                        </p>
                      )}
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {row.agent_synced_at ? new Date(row.agent_synced_at).toLocaleString() : '—'}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-right">
                      {canWrite && (
                        <button
                          type="button"
                          onClick={() => syncNow(row.id)}
                          disabled={syncing === row.id}
                          aria-label={`Publish ${row.name}'s agent now`}
                          className="inline-flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-xs font-medium text-primary-600 transition-colors hover:bg-primary-50 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
                        >
                          <RefreshCw className={`h-3.5 w-3.5 ${syncing === row.id ? 'animate-spin' : ''}`} aria-hidden />
                          {syncing === row.id ? 'Queueing…' : 'Publish now'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-10 text-center text-gray-400">No clients yet</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
