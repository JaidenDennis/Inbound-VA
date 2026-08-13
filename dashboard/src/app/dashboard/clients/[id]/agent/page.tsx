'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { api, errorMessage } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Tabs, useActiveTab, type TabSpec } from '@/components/Tabs';
import { SyncBadge, StatusPill } from '@/components/StatusPill';
import { useSession } from '@/lib/SessionProvider';
import { RefreshCw, AlertTriangle, Save } from 'lucide-react';

const TABS: TabSpec[] = [
  { key: 'identity', label: 'Identity' },
  { key: 'behavior', label: 'Behavior' },
  { key: 'voice', label: 'Voice & Phone' },
  { key: 'prompt', label: 'Prompt Preview' },
  { key: 'versions', label: 'Versions' },
];

interface AgentClient {
  id: string;
  name: string;
  industry: string;
  timezone: string;
  phone_numbers: string[] | null;
  retell_agent_id: string | null;
  retell_voice_id: string | null;
  retell_agent_version: number | null;
  agent_sync_state: string;
  agent_sync_error: string | null;
  agent_synced_at: string | null;
}

interface AgentSettings {
  business_name: string | null;
  agent_name: string | null;
  agent_personality: string;
  agent_tone: string;
  agent_response_style: string;
  prompt_overrides: Record<string, string>;
  booking_enabled: boolean;
  notification_emails: string[];
}

interface PreviewData {
  vertical: string;
  prompt: string;
  beginMessage: string;
  tools: string[];
  problems: string[];
}

interface VersionRow {
  id: string;
  version: number;
  vertical: string | null;
  retell_agent_version: number | null;
  created_at: string;
}

const inputCls =
  'w-full border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500';

function Field({ label, id, children, hint }: { label: string; id: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-gray-700">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

function AgentEditorInner() {
  const params = useParams<{ id: string }>();
  const clientId = params.id;
  const tab = useActiveTab(TABS);
  const { can } = useSession();
  const canWrite = can('agents:write');

  const [client, setClient] = useState<AgentClient | null>(null);
  const [settings, setSettings] = useState<AgentSettings | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState<Record<string, string | boolean | string[]>>({});

  const load = useCallback(() => {
    setLoading(true);
    api
      .get(`/clients/${clientId}/agent`)
      .then((r) => {
        setClient(r.data.client);
        setSettings(r.data.settings);
        setForm({
          business_name: r.data.settings?.business_name ?? '',
          agent_name: r.data.settings?.agent_name ?? '',
          agent_personality: r.data.settings?.agent_personality ?? '',
          agent_tone: r.data.settings?.agent_tone ?? '',
          agent_response_style: r.data.settings?.agent_response_style ?? '',
          voice_id: r.data.client?.retell_voice_id ?? '',
          phone_numbers: (r.data.client?.phone_numbers ?? []).join(', '),
          booking_enabled: !!r.data.settings?.booking_enabled,
          notification_emails: (r.data.settings?.notification_emails ?? []).join(', '),
        });
      })
      .catch((e) => setError(e?.response?.data?.error ?? 'Could not load this agent'))
      .finally(() => setLoading(false));
  }, [clientId]);

  useEffect(load, [load]);

  useEffect(() => {
    if (tab === 'prompt') {
      api.get(`/clients/${clientId}/agent/preview`)
        .then((r) => setPreview(r.data))
        .catch(() => setPreview(null));
    }
    if (tab === 'versions') {
      api.get(`/clients/${clientId}/agent/versions`)
        .then((r) => setVersions(r.data.data ?? []))
        .catch(() => setVersions([]));
    }
  }, [tab, clientId]);

  const save = async () => {
    setSaving(true);
    try {
      await api.patch(`/clients/${clientId}/agent`, {
        business_name: String(form.business_name || '') || undefined,
        agent_name: String(form.agent_name || '') || undefined,
        agent_personality: String(form.agent_personality || '') || undefined,
        agent_tone: String(form.agent_tone || '') || undefined,
        agent_response_style: String(form.agent_response_style || '') || undefined,
        voice_id: String(form.voice_id || '') || undefined,
        booking_enabled: !!form.booking_enabled,
        phone_numbers: String(form.phone_numbers || '')
          .split(',').map((s) => s.trim()).filter(Boolean),
        notification_emails: String(form.notification_emails || '')
          .split(',').map((s) => s.trim()).filter(Boolean),
      });
      toast.success('Saved — publishing to the live agent shortly');
      load();
    } catch (e) {
      toast.error(errorMessage(e, 'Could not save'));
    } finally {
      setSaving(false);
    }
  };

  const syncNow = async () => {
    try {
      await api.post(`/clients/${clientId}/agent/sync`);
      toast.success('Publishing now');
      load();
    } catch (e) {
      const data = (e as { response?: { data?: { error?: string; problems?: string[] } } })?.response?.data;
      toast.error(data?.problems?.join('; ') ?? data?.error ?? 'Could not publish');
    }
  };

  const restore = async (version: number) => {
    try {
      await api.post(`/clients/${clientId}/agent/versions/${version}/restore`);
      toast.success(`Restored version ${version}`);
      load();
    } catch {
      toast.error('Could not restore that version');
    }
  };

  if (loading) return <div className="h-64 animate-pulse bg-gray-100" />;
  if (error) return <div role="alert" className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>;

  const set = (key: string, value: string | boolean) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <div>
      <PageHeader
        title={client?.name ?? 'Agent'}
        description="Behaviour, voice and phone mapping. Knowledge is edited by the client."
        breadcrumbs={[
          { label: 'Agents', href: '/dashboard/agents' },
          { label: client?.name ?? '' },
        ]}
        action={
          <div className="flex items-center gap-3">
            <SyncBadge state={client?.agent_sync_state} />
            {canWrite && (
              <button
                type="button"
                onClick={syncNow}
                className="flex cursor-pointer items-center gap-2 border border-gray-200 bg-surface-raised px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <RefreshCw className="h-4 w-4" aria-hidden /> Publish now
              </button>
            )}
          </div>
        }
      />

      {client?.agent_sync_error && (
        <div role="alert" className="mb-4 flex items-start gap-2 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
          <div>
            <p className="font-medium">Last publish failed</p>
            <p>{client.agent_sync_error}</p>
          </div>
        </div>
      )}

      <Tabs tabs={TABS} />

      {(tab === 'identity' || tab === 'behavior' || tab === 'voice') && (
        <div className="space-y-5 border border-gray-200 bg-surface-raised p-6">
          {tab === 'identity' && (
            <>
              <Field label="Business name" id="business_name" hint="Spoken by the agent when it answers.">
                <input id="business_name" className={inputCls} disabled={!canWrite}
                  value={String(form.business_name ?? '')} onChange={(e) => set('business_name', e.target.value)} />
              </Field>
              <Field label="Agent name" id="agent_name" hint="The name the agent gives callers.">
                <input id="agent_name" className={inputCls} disabled={!canWrite}
                  value={String(form.agent_name ?? '')} onChange={(e) => set('agent_name', e.target.value)} />
              </Field>
              <Field label="Notification emails" id="notification_emails" hint="Comma separated. Where handoffs and bookings are sent.">
                <input id="notification_emails" className={inputCls} disabled={!canWrite}
                  value={String(form.notification_emails ?? '')} onChange={(e) => set('notification_emails', e.target.value)} />
              </Field>
            </>
          )}

          {tab === 'behavior' && (
            <>
              <Field label="Personality" id="agent_personality">
                <input id="agent_personality" className={inputCls} disabled={!canWrite}
                  value={String(form.agent_personality ?? '')} onChange={(e) => set('agent_personality', e.target.value)} />
              </Field>
              <Field label="Tone" id="agent_tone">
                <input id="agent_tone" className={inputCls} disabled={!canWrite}
                  value={String(form.agent_tone ?? '')} onChange={(e) => set('agent_tone', e.target.value)} />
              </Field>
              <Field label="Response style" id="agent_response_style">
                <input id="agent_response_style" className={inputCls} disabled={!canWrite}
                  value={String(form.agent_response_style ?? '')} onChange={(e) => set('agent_response_style', e.target.value)} />
              </Field>
              <div className="flex items-center gap-2">
                <input id="booking_enabled" type="checkbox" disabled={!canWrite}
                  className="h-4 w-4 cursor-pointer border-gray-300 text-primary-600 focus:ring-2 focus:ring-primary-500"
                  checked={!!form.booking_enabled} onChange={(e) => set('booking_enabled', e.target.checked)} />
                <label htmlFor="booking_enabled" className="cursor-pointer text-sm font-medium text-gray-700">
                  Booking enabled
                </label>
              </div>
            </>
          )}

          {tab === 'voice' && (
            <>
              <Field label="Retell voice id" id="voice_id" hint="Leave blank to use the platform default.">
                <input id="voice_id" className={inputCls} disabled={!canWrite}
                  value={String(form.voice_id ?? '')} onChange={(e) => set('voice_id', e.target.value)} />
              </Field>
              <Field label="Phone numbers" id="phone_numbers" hint="Comma separated, E.164 (+15551234567). Mapped to this agent on publish.">
                <input id="phone_numbers" className={inputCls} disabled={!canWrite}
                  value={String(form.phone_numbers ?? '')} onChange={(e) => set('phone_numbers', e.target.value)} />
              </Field>
            </>
          )}

          {canWrite && (
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="flex cursor-pointer items-center gap-2 bg-primary-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50"
            >
              <Save className="h-4 w-4" aria-hidden /> {saving ? 'Saving…' : 'Save changes'}
            </button>
          )}
        </div>
      )}

      {tab === 'prompt' && (
        <div className="space-y-4">
          {preview?.problems && preview.problems.length > 0 && (
            <div role="alert" className="border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="mb-1 font-medium">This configuration would be rejected:</p>
              <ul className="list-inside list-disc">
                {preview.problems.map((p) => <li key={p}>{p}</li>)}
              </ul>
            </div>
          )}
          <div className="border border-gray-200 bg-surface-raised p-6">
            <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
              <StatusPill tone="info" label={`template: ${preview?.vertical ?? '—'}`} />
              <StatusPill tone="neutral" label={`${preview?.tools.length ?? 0} tools`} />
              <StatusPill tone="neutral" label={`${preview?.prompt.length ?? 0} chars`} />
            </div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Opening line</p>
            <p className="mb-5 bg-gray-50 p-3 text-sm text-gray-800">{preview?.beginMessage ?? '—'}</p>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
              Rendered prompt — exactly what Retell receives
            </p>
            <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap bg-surface-dark p-4 text-xs leading-relaxed text-gray-100">
              {preview?.prompt ?? 'Could not render this prompt.'}
            </pre>
          </div>
        </div>
      )}

      {tab === 'versions' && (
        <div className="overflow-hidden border border-gray-200 bg-surface-raised">
          <table className="w-full">
            <caption className="sr-only">Published agent configuration versions</caption>
            <thead className="bg-gray-50">
              <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase tracking-wide text-gray-700">
                <th scope="col" className="px-6 py-3">Version</th>
                <th scope="col" className="px-6 py-3">Template</th>
                <th scope="col" className="px-6 py-3">Retell version</th>
                <th scope="col" className="px-6 py-3">Published</th>
                <th scope="col" className="px-6 py-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {versions.map((v) => (
                <tr key={v.id} className="text-sm transition-colors hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-900">v{v.version}</td>
                  <td className="px-6 py-4 text-gray-600">{v.vertical ?? '—'}</td>
                  <td className="px-6 py-4 text-gray-600">{v.retell_agent_version ?? '—'}</td>
                  <td className="px-6 py-4 text-gray-600">{new Date(v.created_at).toLocaleString()}</td>
                  <td className="px-6 py-4 text-right">
                    {canWrite && (
                      <button
                        type="button"
                        onClick={() => restore(v.version)}
                        className="cursor-pointer px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
                      >
                        Restore
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {versions.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-gray-400">
                    No published versions yet. One is recorded each time the agent publishes successfully.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {settings === null && (
        <p className="mt-4 text-sm text-gray-500">This client has no settings row yet.</p>
      )}
    </div>
  );
}

export default function AgentEditorPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse bg-gray-100" />}>
      <AgentEditorInner />
    </Suspense>
  );
}
