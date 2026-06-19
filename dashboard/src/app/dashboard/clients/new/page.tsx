'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { ArrowLeft } from 'lucide-react';

const INDUSTRIES = ['dental', 'medical', 'legal', 'real_estate', 'fitness', 'beauty', 'auto', 'other'];
const TIMEZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Phoenix', 'America/Anchorage', 'Pacific/Honolulu', 'UTC',
];

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export default function NewClientPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [industry, setIndustry] = useState('other');
  const [timezone, setTimezone] = useState('America/New_York');
  const [phones, setPhones] = useState('');
  const [agentId, setAgentId] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const { data } = await api.post('/clients', {
        name,
        slug: slug || slugify(name),
        industry,
        timezone,
        phone_numbers: phones.split(',').map((p) => p.trim()).filter(Boolean),
        retell_agent_id: agentId || undefined,
      });
      router.push(`/dashboard/clients/${data.id}`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? 'Failed to create client');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';

  return (
    <div className="max-w-2xl">
      <Link href="/dashboard/clients" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to clients
      </Link>
      <h1 className="text-2xl font-bold mb-6">New Client</h1>

      <form onSubmit={submit} className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Business Name</label>
          <input className={inputCls} required value={name}
            onChange={(e) => { setName(e.target.value); if (!slug) setSlug(slugify(e.target.value)); }} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Slug</label>
          <input className={inputCls} required value={slug} onChange={(e) => setSlug(slugify(e.target.value))} placeholder="auto-generated from name" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Industry</label>
            <select className={inputCls} value={industry} onChange={(e) => setIndustry(e.target.value)}>
              {INDUSTRIES.map((i) => <option key={i} value={i}>{i.replace('_', ' ')}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Timezone</label>
            <select className={inputCls} value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {TIMEZONES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Phone Numbers <span className="text-gray-400 font-normal">(comma separated, E.164)</span></label>
          <input className={inputCls} value={phones} onChange={(e) => setPhones(e.target.value)} placeholder="+12125550100, +12125550101" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Retell Agent ID <span className="text-gray-400 font-normal">(optional)</span></label>
          <input className={inputCls} value={agentId} onChange={(e) => setAgentId(e.target.value)} />
        </div>

        {error && <p className="text-red-500 text-sm">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={saving}
            className="bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold px-5 py-2 rounded-lg transition disabled:opacity-50">
            {saving ? 'Creating...' : 'Create Client'}
          </button>
          <Link href="/dashboard/clients" className="text-sm text-gray-500 px-4 py-2">Cancel</Link>
        </div>
      </form>
    </div>
  );
}
