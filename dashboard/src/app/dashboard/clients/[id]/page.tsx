'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { ArrowLeft } from 'lucide-react';
import { stageLabel, ONBOARDING_STATUSES, type Milestone } from '@/lib/onboarding';
import { type ActionItem } from '@/lib/actionItems';

interface ClientSettings {
  agent_prompt: string;
  agent_personality: string;
  agent_tone: string;
  booking_enabled: boolean;
  crm_type: string;
  notification_emails: string[];
}

interface ClientDetail {
  id: string;
  name: string;
  slug: string;
  industry: string;
  timezone: string;
  phone_numbers: string[];
  status: string;
  retell_agent_id: string | null;
  settings: ClientSettings | null;
}

const CRM_TYPES = ['none', 'gohighlevel', 'hubspot', 'salesforce', 'zoho', 'webhook'];

export default function ClientEditPage() {
  const { id } = useParams<{ id: string }>();
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingClient, setSavingClient] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [msg, setMsg] = useState('');
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [items, setItems] = useState<ActionItem[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');

  // client fields
  const [name, setName] = useState('');
  const [phones, setPhones] = useState('');
  const [agentId, setAgentId] = useState('');
  const [status, setStatus] = useState('active');

  // settings fields
  const [prompt, setPrompt] = useState('');
  const [tone, setTone] = useState('');
  const [bookingEnabled, setBookingEnabled] = useState(false);
  const [crmType, setCrmType] = useState('none');
  const [notifyEmails, setNotifyEmails] = useState('');

  useEffect(() => {
    api.get(`/clients/${id}`).then((r) => {
      const c: ClientDetail = r.data;
      setClient(c);
      setName(c.name);
      setPhones(c.phone_numbers.join(', '));
      setAgentId(c.retell_agent_id ?? '');
      setStatus(c.status);
      if (c.settings) {
        setPrompt(c.settings.agent_prompt ?? '');
        setTone(c.settings.agent_tone ?? '');
        setBookingEnabled(!!c.settings.booking_enabled);
        setCrmType(c.settings.crm_type ?? 'none');
        setNotifyEmails((c.settings.notification_emails ?? []).join(', '));
      }
    }).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    api.get(`/onboarding?clientId=${id}`).then((r) => setMilestones(r.data.data ?? [])).catch(() => {});
    api.get(`/action-items?clientId=${id}`).then((r) => setItems(r.data.data ?? [])).catch(() => {});
  }, [id]);

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 2500); };

  const updateStage = async (stageKey: string, status: string) => {
    const { data } = await api.patch(`/onboarding/${stageKey}`, { clientId: id, status });
    setMilestones((ms) => ms.map((m) => (m.stage_key === stageKey ? data : m)));
    flash('Onboarding updated');
  };

  const addItem = async () => {
    if (!newTitle.trim()) return;
    const { data } = await api.post('/action-items', { clientId: id, title: newTitle, description: newDesc || undefined });
    setItems((xs) => [...xs, data]);
    setNewTitle('');
    setNewDesc('');
    flash('Action item added');
  };

  const saveItem = async (item: ActionItem) => {
    const { data } = await api.patch(`/action-items/${item.id}`, { title: item.title, description: item.description });
    setItems((xs) => xs.map((x) => (x.id === item.id ? data : x)));
    flash('Action item saved');
  };

  const toggleItem = async (item: ActionItem) => {
    const status = item.status === 'done' ? 'pending' : 'done';
    const { data } = await api.patch(`/action-items/${item.id}`, { status });
    setItems((xs) => xs.map((x) => (x.id === item.id ? data : x)));
  };

  const editItem = (id: string, patch: Partial<ActionItem>) =>
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const saveClient = async () => {
    setSavingClient(true);
    try {
      await api.patch(`/clients/${id}`, {
        name,
        phone_numbers: phones.split(',').map((p) => p.trim()).filter(Boolean),
        retell_agent_id: agentId || undefined,
        status,
      });
      flash('Client saved');
    } finally { setSavingClient(false); }
  };

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      await api.patch(`/clients/${id}/settings`, {
        agent_prompt: prompt,
        agent_tone: tone,
        booking_enabled: bookingEnabled,
        crm_type: crmType,
        notification_emails: notifyEmails.split(',').map((e) => e.trim()).filter(Boolean),
      });
      flash('Settings saved');
    } finally { setSavingSettings(false); }
  };

  if (loading) return <div className="text-gray-400 animate-pulse">Loading...</div>;
  if (!client) return <div>Client not found</div>;

  const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';

  return (
    <div className="max-w-2xl">
      <Link href="/dashboard/clients" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to clients
      </Link>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{client.name}</h1>
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>
          {status}
        </span>
      </div>

      {msg && <div className="mb-4 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">{msg}</div>}

      {/* Business / client record */}
      <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-4 mb-6">
        <h2 className="font-semibold text-gray-700">Business</h2>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Phone Numbers</label>
          <input className={inputCls} value={phones} onChange={(e) => setPhones(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Retell Agent ID</label>
          <input className={inputCls} value={agentId} onChange={(e) => setAgentId(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
          <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">active</option>
            <option value="inactive">inactive</option>
            <option value="suspended">suspended</option>
          </select>
          {status !== 'active' && <p className="text-xs text-orange-600 mt-1">A non-active client will not be matched to inbound calls.</p>}
        </div>
        <button onClick={saveClient} disabled={savingClient}
          className="bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold px-5 py-2 rounded-lg transition disabled:opacity-50">
          {savingClient ? 'Saving...' : 'Save Business'}
        </button>
      </section>

      {/* Agent + booking + CRM settings */}
      <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <h2 className="font-semibold text-gray-700">Agent &amp; Operations</h2>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Agent Prompt</label>
          <textarea className={inputCls} rows={5} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tone</label>
            <input className={inputCls} value={tone} onChange={(e) => setTone(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">CRM</label>
            <select className={inputCls} value={crmType} onChange={(e) => setCrmType(e.target.value)}>
              {CRM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={bookingEnabled} onChange={(e) => setBookingEnabled(e.target.checked)} />
          Booking enabled
        </label>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notification Emails <span className="text-gray-400 font-normal">(comma separated)</span></label>
          <input className={inputCls} value={notifyEmails} onChange={(e) => setNotifyEmails(e.target.value)} />
        </div>
        <button onClick={saveSettings} disabled={savingSettings}
          className="bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold px-5 py-2 rounded-lg transition disabled:opacity-50">
          {savingSettings ? 'Saving...' : 'Save Settings'}
        </button>
      </section>

      {/* Onboarding pipeline — advance the client's stages */}
      <section className="bg-white rounded-xl border border-gray-200 p-6 mt-6">
        <h2 className="font-semibold text-gray-700 mb-4">Onboarding</h2>
        {milestones.length === 0 ? (
          <p className="text-sm text-gray-400">No milestones.</p>
        ) : (
          <ul className="space-y-2">
            {milestones.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3">
                <span className="text-sm text-gray-700">
                  {m.sort_order}. {stageLabel(m.stage_key)}
                </span>
                <select
                  value={m.status}
                  onChange={(e) => updateStage(m.stage_key, e.target.value)}
                  className="border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  {ONBOARDING_STATUSES.map((s) => (
                    <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Waiting on You — client action items */}
      <section className="bg-white rounded-xl border border-gray-200 p-6 mt-6">
        <h2 className="font-semibold text-gray-700 mb-4">
          Waiting on You <span className="text-gray-400 font-normal text-sm">(client action items)</span>
        </h2>
        <div className="space-y-2 mb-4">
          {items.length === 0 && <p className="text-sm text-gray-400">No action items.</p>}
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-2">
              <button
                onClick={() => toggleItem(item)}
                className={`text-xs px-2 py-1 rounded-lg font-medium shrink-0 ${
                  item.status === 'done' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                }`}
              >
                {item.status === 'done' ? 'Done' : 'Pending'}
              </button>
              <input
                className={`${inputCls} flex-1`}
                value={item.title}
                onChange={(e) => editItem(item.id, { title: e.target.value })}
              />
              <input
                className={`${inputCls} flex-1`}
                placeholder="Description"
                value={item.description ?? ''}
                onChange={(e) => editItem(item.id, { description: e.target.value })}
              />
              <button onClick={() => saveItem(item)} className="text-brand-600 hover:underline text-xs shrink-0">
                Save
              </button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 border-t border-gray-100 pt-4">
          <input
            className={`${inputCls} flex-1`}
            placeholder="New item title"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
          />
          <input
            className={`${inputCls} flex-1`}
            placeholder="Description (optional)"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
          />
          <button
            onClick={addItem}
            disabled={!newTitle.trim()}
            className="bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold px-4 py-2 rounded-lg transition disabled:opacity-50 shrink-0"
          >
            Add
          </button>
        </div>
      </section>
    </div>
  );
}
