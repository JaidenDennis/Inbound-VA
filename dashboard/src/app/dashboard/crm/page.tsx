'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { RefreshCw, CheckCircle, XCircle } from 'lucide-react';

interface SyncLog {
  id: string;
  entity_type: string;
  entity_id: string;
  operation: string;
  status: string;
  external_id: string | null;
  error_message: string | null;
  attempts: number;
  created_at: string;
}

interface Plugin {
  name: string;
  version: string;
  description: string;
}

export default function CrmPage() {
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [plugins, setPlugins] = useState<{ crm: Plugin[]; calendar: Plugin[] } | null>(null);
  const [clientId, setClientId] = useState('');

  useEffect(() => {
    api.get('/admin/plugins').then((r) => setPlugins(r.data));
    api.get('/clients?limit=1').then((r) => {
      const first = r.data.data?.[0];
      if (first) setClientId(first.id);
    });
  }, []);

  useEffect(() => {
    if (clientId) {
      api.get(`/crm/${clientId}/logs`).then((r) => setLogs(r.data));
    }
  }, [clientId]);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">CRM Management</h1>

      {plugins && (
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-white rounded-xl border p-4">
            <h2 className="font-semibold text-gray-700 mb-3">CRM Adapters</h2>
            <div className="space-y-2">
              {plugins.crm.map((p) => (
                <div key={p.name} className="flex items-center gap-2 text-sm">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  <span className="font-medium capitalize">{p.name}</span>
                  <span className="text-gray-400 text-xs">v{p.version}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-white rounded-xl border p-4">
            <h2 className="font-semibold text-gray-700 mb-3">Calendar Adapters</h2>
            <div className="space-y-2">
              {plugins.calendar.map((p) => (
                <div key={p.name} className="flex items-center gap-2 text-sm">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  <span className="font-medium capitalize">{p.name}</span>
                  <span className="text-gray-400 text-xs">v{p.version}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h2 className="font-semibold text-gray-700">Sync Logs</h2>
          <button onClick={() => clientId && api.get(`/crm/${clientId}/logs`).then((r) => setLogs(r.data))}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Entity</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Operation</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Attempts</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">When</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {logs.map((log) => (
              <tr key={log.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-gray-700">{log.entity_type}</td>
                <td className="px-4 py-3 text-gray-600 capitalize">{log.operation}</td>
                <td className="px-4 py-3">
                  {log.status === 'success'
                    ? <span className="flex items-center gap-1 text-green-600"><CheckCircle className="w-3.5 h-3.5" /> Success</span>
                    : <span className="flex items-center gap-1 text-red-500"><XCircle className="w-3.5 h-3.5" /> {log.status}</span>
                  }
                </td>
                <td className="px-4 py-3 text-gray-500">{log.attempts}</td>
                <td className="px-4 py-3 text-gray-400 text-xs">{new Date(log.created_at).toLocaleString()}</td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No sync logs</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
