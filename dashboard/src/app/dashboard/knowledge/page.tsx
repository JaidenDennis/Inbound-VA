'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Tabs, useActiveTab, type TabSpec } from '@/components/Tabs';
import { InlineEditTable, type FieldSpec } from '@/components/InlineEditTable';
import { SyncBadge } from '@/components/StatusPill';
import { useSession } from '@/lib/SessionProvider';
import { Info } from 'lucide-react';

const TABS: TabSpec[] = [
  { key: 'faqs', label: 'FAQs' },
  { key: 'services', label: 'Services' },
  { key: 'pricing', label: 'Pricing' },
  { key: 'promotions', label: 'Promotions' },
];

const FIELDS: Record<string, FieldSpec[]> = {
  faqs: [
    { key: 'question', label: 'Question', required: true, width: '35%' },
    { key: 'answer', label: 'Answer', type: 'textarea', required: true },
    { key: 'category', label: 'Category', width: '15%' },
  ],
  services: [
    { key: 'name', label: 'Service', required: true, width: '25%' },
    { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'duration_minutes', label: 'Minutes', type: 'number', width: '10%' },
    { key: 'price', label: 'Price', type: 'number', width: '12%' },
  ],
  pricing: [
    { key: 'name', label: 'Item', required: true, width: '25%' },
    { key: 'price', label: 'Price', type: 'number', required: true, width: '12%' },
    { key: 'member_price', label: 'Member price', type: 'number', width: '12%' },
    { key: 'unit', label: 'Unit', width: '12%' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
  promotions: [
    { key: 'title', label: 'Promotion', required: true, width: '25%' },
    { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'eligibility', label: 'Eligibility', width: '20%' },
  ],
};

/** Blank strings must not be sent as empty values for numeric or nullable columns. */
function cleanPayload(values: Record<string, string>, fields: FieldSpec[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = values[field.key];
    if (raw === undefined || raw === '') continue;
    out[field.key] = field.type === 'number' ? Number(raw) : raw;
  }
  return out;
}

interface Row { id: string; [key: string]: unknown }

function KnowledgePageInner() {
  const tab = useActiveTab(TABS);
  const { can } = useSession();
  const canWrite = can('knowledge:write');

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [syncState, setSyncState] = useState<string | null>(null);

  const fields = FIELDS[tab] ?? FIELDS.faqs;

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api
      .get(`/knowledge/${tab}`)
      .then((r) => setRows(r.data.data ?? []))
      .catch((e) => setError(e?.response?.data?.error ?? 'Could not load this section'))
      .finally(() => setLoading(false));
  }, [tab]);

  useEffect(load, [load]);

  // After a write the agent is stale until the queued provision runs, so the
  // header says so rather than implying the change is already live on calls.
  const markPending = () => setSyncState('pending');

  return (
    <div>
      <PageHeader
        title="Knowledge"
        description="What your AI agent tells callers. Changes go live on calls within about a minute."
        action={syncState ? <SyncBadge state={syncState} /> : undefined}
      />

      {!canWrite && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
          <p>You have read-only access. Ask an account owner to make changes.</p>
        </div>
      )}

      <Tabs tabs={TABS} />

      {error && (
        <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <InlineEditTable
        rows={rows}
        fields={fields}
        loading={loading}
        readOnly={!canWrite}
        emptyMessage={`No ${tab} yet. Add the first one so your agent can answer about it.`}
        onCreate={async (values) => {
          await api.post(`/knowledge/${tab}`, cleanPayload(values, fields));
          markPending();
          load();
        }}
        onUpdate={async (id, values) => {
          await api.patch(`/knowledge/${tab}/${id}`, cleanPayload(values, fields));
          markPending();
          load();
        }}
        onDelete={async (id) => {
          await api.delete(`/knowledge/${tab}/${id}`);
          markPending();
          load();
        }}
      />
    </div>
  );
}

export default function KnowledgePage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-gray-100" />}>
      <KnowledgePageInner />
    </Suspense>
  );
}
