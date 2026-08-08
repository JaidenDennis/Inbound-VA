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
  /** Numbers Retell confirmed an inbound mapping for. These actually ring. */
  confirmed_numbers: string[] | null;
  /** Configured in the console but never accepted by Retell. These do not. */
  unconfirmed_numbers: string[] | null;
  status: string;
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
          className="mb-4 flex items-start gap-2 rounded-lg border border-lamp-bad-rim bg-lamp-bad-wash px-4 py-3 text-sm text-lamp-bad-ink"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
          <p>
            {failing.length} agent{failing.length > 1 ? 's are' : ' is'} out of sync with the dashboard.
            Callers still hear the last configuration that published successfully.
          </p>
        </div>
      )}

      {error && (
        <div role="alert" className="mb-4 rounded-lg border border-lamp-bad-rim bg-lamp-bad-wash px-4 py-3 text-sm text-lamp-bad-ink">
          {error}
        </div>
      )}

      {loading ? (
        <div className="overflow-hidden rounded-xl border border-panel-200 bg-white">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse border-b border-panel-100 bg-panel-50 last:border-0" />
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-panel-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full">
              <caption className="sr-only">Client agents and sync state</caption>
              <thead className="sticky top-0 z-10 bg-panel-50">
                <tr className="border-b border-panel-200 text-left text-2xs font-semibold uppercase tracking-[0.07em] text-panel-500">
                  <th scope="col" className="px-5 py-3">Client</th>
                  <th scope="col" className="px-5 py-3">Numbers</th>
                  <th scope="col" className="px-5 py-3">Agent</th>
                  <th scope="col" className="px-5 py-3">Sync</th>
                  <th scope="col" className="px-5 py-3">Last published</th>
                  <th scope="col" className="px-5 py-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-panel-100">
                {rows.map((row) => (
                  <tr key={row.id} className="text-sm transition-colors duration-150 hover:bg-panel-25">
                    <td className="px-5 py-3.5">
                      <Link
                        href={`/dashboard/clients/${row.id}/agent`}
                        className="font-medium text-signal-700 underline decoration-signal-200 underline-offset-2 transition-colors hover:decoration-signal-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600"
                      >
                        {row.name}
                      </Link>
                      <p className="text-xs text-panel-500">{row.industry}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      {(row.phone_numbers ?? []).length === 0 ? (
                        <span className="text-xs text-panel-400">No number</span>
                      ) : (
                        <ul className="space-y-1">
                          {(row.confirmed_numbers ?? []).map((n) => (
                            <li key={n} className="font-mono text-xs text-panel-700">{n}</li>
                          ))}
                          {(row.unconfirmed_numbers ?? []).map((n) => (
                            <li key={n} className="flex items-center gap-1.5">
                              <span className="font-mono text-xs text-panel-400 line-through">{n}</span>
                              <span
                                title="Configured here but Retell has no inbound mapping for it — this number does not reach the agent."
                                className="rounded-full border border-lamp-fair-rim bg-lamp-fair-wash px-1.5 py-0.5 text-[10px] font-medium text-lamp-fair-ink"
                              >
                                not routed
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      {row.retell_agent_id
                        ? <span className="font-mono text-2xs text-panel-600">v{row.retell_agent_version ?? '?'}</span>
                        : <StatusPill tone="neutral" label="Not provisioned" />}
                    </td>
                    <td className="px-5 py-3.5">
                      <SyncBadge state={row.agent_sync_state} />
                      {row.agent_sync_error && (
                        <p className="mt-1 max-w-xs truncate text-xs text-lamp-bad-ink" title={row.agent_sync_error}>
                          {row.agent_sync_error}
                        </p>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-panel-600">
                      {row.agent_synced_at ? new Date(row.agent_synced_at).toLocaleString() : '—'}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3.5 text-right">
                      {canWrite && (
                        <button
                          type="button"
                          onClick={() => syncNow(row.id)}
                          disabled={syncing === row.id}
                          aria-label={`Publish ${row.name}'s agent now`}
                          className="inline-flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-xs font-medium text-signal-700 transition-colors hover:bg-signal-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600 disabled:opacity-50"
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
                    <td colSpan={6} className="px-6 py-10 text-center text-panel-500">No clients yet</td>
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
