'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { RefreshCw, CheckCircle, XCircle, Link2 } from 'lucide-react';

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

interface ClientRow {
  id: string;
  business_name?: string;
  name?: string;
}

interface GhlStatus {
  connected: boolean;
  pipelineId?: string | null;
  stageId?: string | null;
  calendarId?: string | null;
}

interface GhlPipeline {
  id: string;
  name: string;
  stages: Array<{ id: string; name: string }>;
}

interface GhlCalendar {
  id: string;
  name: string;
}

function GhlConnectPanel({ clientId }: { clientId: string }) {
  const [status, setStatus] = useState<GhlStatus | null>(null);
  const [pipelines, setPipelines] = useState<GhlPipeline[]>([]);
  const [calendars, setCalendars] = useState<GhlCalendar[]>([]);
  const [pipelineId, setPipelineId] = useState('');
  const [stageId, setStageId] = useState('');
  const [calendarId, setCalendarId] = useState('');
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // Outcome flag set by the OAuth callback redirect (?ghl=connected|error).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ghl = params.get('ghl');
    if (ghl === 'connected') setBanner({ kind: 'ok', text: 'GoHighLevel connected successfully.' });
    if (ghl === 'error') setBanner({ kind: 'err', text: `GoHighLevel connection failed (${params.get('reason') ?? 'unknown'}).` });
  }, []);

  const loadStatus = useCallback(async () => {
    const { data } = await api.get(`/crm/${clientId}/gohighlevel/status`);
    setStatus(data);
    setPipelineId(data.pipelineId ?? '');
    setStageId(data.stageId ?? '');
    setCalendarId(data.calendarId ?? '');
    if (data.connected) {
      const [p, c] = await Promise.all([
        api.get(`/crm/${clientId}/gohighlevel/pipelines`),
        api.get(`/crm/${clientId}/gohighlevel/calendars`),
      ]);
      setPipelines(p.data);
      setCalendars(c.data);
    }
  }, [clientId]);

  useEffect(() => {
    loadStatus().catch(() => setStatus({ connected: false }));
  }, [loadStatus]);

  const connect = async () => {
    try {
      const { data } = await api.get('/crm/gohighlevel/oauth/install', { params: { clientId } });
      window.location.href = data.url;
    } catch (err) {
      const message = (err as { response?: { data?: { error?: string } } }).response?.data?.error;
      setBanner({ kind: 'err', text: message ?? 'Could not start the GoHighLevel install flow.' });
    }
  };

  const saveConfig = async () => {
    setSaving(true);
    try {
      await api.post(`/crm/${clientId}/gohighlevel/config`, {
        ...(pipelineId ? { pipelineId } : {}),
        ...(stageId ? { stageId } : {}),
        ...(calendarId ? { calendarId } : {}),
      });
      setBanner({ kind: 'ok', text: 'GoHighLevel settings saved.' });
    } catch {
      setBanner({ kind: 'err', text: 'Failed to save GoHighLevel settings.' });
    } finally {
      setSaving(false);
    }
  };

  const stages = pipelines.find((p) => p.id === pipelineId)?.stages ?? [];

  return (
    <div className="bg-white rounded-xl border p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-700">GoHighLevel</h2>
        {status?.connected ? (
          <span className="flex items-center gap-1 text-sm text-green-600">
            <CheckCircle className="w-4 h-4" /> Connected
          </span>
        ) : (
          <button
            onClick={connect}
            className="flex items-center gap-1.5 bg-blue-600 text-white text-sm px-3 py-1.5 rounded-lg hover:bg-blue-700"
          >
            <Link2 className="w-4 h-4" /> Connect GoHighLevel
          </button>
        )}
      </div>

      {banner && (
        <div className={`text-sm rounded-lg px-3 py-2 mb-3 ${banner.kind === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
          {banner.text}
        </div>
      )}

      {status?.connected && (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            Pipelines and calendars are created inside the GoHighLevel sub-account (they can&apos;t be
            created via API). Create them there, hit refresh, then pick where leads and bookings land.
          </p>
          <div className="grid grid-cols-3 gap-3">
            <label className="text-sm text-gray-600">
              Lead pipeline
              <select
                value={pipelineId}
                onChange={(e) => { setPipelineId(e.target.value); setStageId(''); }}
                className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm"
              >
                <option value="">— none —</option>
                {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="text-sm text-gray-600">
              Entry stage
              <select
                value={stageId}
                onChange={(e) => setStageId(e.target.value)}
                disabled={!pipelineId}
                className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm disabled:bg-gray-50"
              >
                <option value="">— first stage —</option>
                {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="text-sm text-gray-600">
              Booking calendar
              <select
                value={calendarId}
                onChange={(e) => setCalendarId(e.target.value)}
                className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm"
              >
                <option value="">— none —</option>
                {calendars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={saveConfig}
              disabled={saving}
              className="bg-blue-600 text-white text-sm px-4 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save settings'}
            </button>
            <button
              onClick={() => loadStatus().catch(() => undefined)}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Refresh pipelines &amp; calendars
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CrmPage() {
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [plugins, setPlugins] = useState<{ crm: Plugin[]; calendar: Plugin[] } | null>(null);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [clientId, setClientId] = useState('');

  useEffect(() => {
    api.get('/admin/plugins').then((r) => setPlugins(r.data));
    api.get('/clients?limit=100').then((r) => {
      const rows: ClientRow[] = r.data.data ?? [];
      setClients(rows);
      if (rows[0]) setClientId(rows[0].id);
    });
  }, []);

  useEffect(() => {
    if (clientId) {
      api.get(`/crm/${clientId}/logs`).then((r) => setLogs(r.data));
    }
  }, [clientId]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">CRM Management</h1>
        {clients.length > 1 && (
          <select
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="border rounded-lg px-3 py-1.5 text-sm"
          >
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.business_name ?? c.name ?? c.id}</option>
            ))}
          </select>
        )}
      </div>

      {clientId && <GhlConnectPanel clientId={clientId} />}

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
