'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { FilterBar, type FilterSpec } from '@/components/FilterBar';
import { Drawer } from '@/components/Drawer';

interface AuditRow {
  id: string;
  user_id: string | null;
  client_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

const filters: FilterSpec[] = [
  { key: 'q', label: 'Action', type: 'search', placeholder: 'user.created, retell.agent…' },
  { key: 'from', label: 'From', type: 'date' },
  { key: 'to', label: 'To', type: 'date' },
];

function AuditPageInner() {
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<AuditRow | null>(null);

  const query = searchParams.toString();

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api
      .get(`/system/audit?${query}`)
      .then((r) => {
        setRows(r.data.data ?? []);
        setCount(r.data.count ?? 0);
      })
      .catch((e) => setError(e?.response?.data?.error ?? 'Failed to load the audit log'))
      .finally(() => setLoading(false));
  }, [query]);

  useEffect(load, [load]);

  return (
    <div>
      <PageHeader
        title="Audit Log"
        description="Who changed what, and when. Append-only."
      />

      <FilterBar filters={filters} />

      {error && (
        <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse border-b border-gray-100 bg-gray-50 last:border-0" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
          <p className="text-lg text-gray-500">No audit entries</p>
          <p className="mt-1 text-sm text-gray-400">Nothing matched these filters.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full">
              <caption className="sr-only">{count} audit entries</caption>
              <thead className="sticky top-0 bg-gray-50">
                <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase tracking-wide text-gray-700">
                  <th scope="col" className="px-6 py-3">When</th>
                  <th scope="col" className="px-6 py-3">Action</th>
                  <th scope="col" className="px-6 py-3">Entity</th>
                  <th scope="col" className="px-6 py-3">Actor</th>
                  <th scope="col" className="px-6 py-3">IP</th>
                  <th scope="col" className="px-6 py-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((row) => (
                  <tr key={row.id} className="text-sm transition-colors hover:bg-gray-50">
                    <td className="whitespace-nowrap px-6 py-4 text-gray-600">
                      {new Date(row.created_at).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 font-mono text-xs text-gray-900">{row.action}</td>
                    <td className="px-6 py-4 text-gray-600">
                      {row.entity_type ?? '—'}
                      {row.entity_id && (
                        <span className="ml-1 font-mono text-xs text-gray-400">{row.entity_id.slice(0, 8)}</span>
                      )}
                    </td>
                    <td className="px-6 py-4 font-mono text-xs text-gray-600">
                      {row.user_id ? row.user_id.slice(0, 8) : 'system'}
                    </td>
                    <td className="px-6 py-4 text-gray-500">{row.ip_address ?? '—'}</td>
                    <td className="px-6 py-4 text-right">
                      {(row.old_value || row.new_value) && (
                        <button
                          type="button"
                          onClick={() => setSelected(row)}
                          className="cursor-pointer rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
                        >
                          Changes
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Drawer open={!!selected} onClose={() => setSelected(null)} title={selected?.action ?? ''}>
        {selected && (
          <div className="space-y-5 text-sm">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Before</p>
              <pre className="mt-1 max-h-60 overflow-auto rounded-lg bg-gray-50 p-3 text-xs text-gray-700">
                {JSON.stringify(selected.old_value ?? {}, null, 2)}
              </pre>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">After</p>
              <pre className="mt-1 max-h-60 overflow-auto rounded-lg bg-gray-50 p-3 text-xs text-gray-700">
                {JSON.stringify(selected.new_value ?? {}, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}

export default function AuditPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-gray-100" />}>
      <AuditPageInner />
    </Suspense>
  );
}
