'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Tabs, useActiveTab, type TabSpec } from '@/components/Tabs';
import { InlineEditTable, type FieldSpec } from '@/components/InlineEditTable';
import { SyncBadge } from '@/components/StatusPill';
import { ClientPicker, ChooseClientPrompt, useClientScope } from '@/components/ClientPicker';
import { useSession } from '@/lib/SessionProvider';
import { Info } from 'lucide-react';
import { CopilotFaqs } from '@/components/CopilotFaqs';
import { PoliciesEditor } from './components/PoliciesEditor';
import { HoursEditor } from './components/HoursEditor';
import { CategoryEditor } from './components/CategoryEditor';

/**
 * Everything the agent knows.
 *
 * This page was previously reachable only by client users and always read the
 * caller's own tenant, so platform staff had no way to edit any client's
 * knowledge at all. It now scopes through ClientPicker: a client sees their own
 * data with no picker, staff choose whose knowledge they are editing.
 */

const TABS: TabSpec[] = [
  { key: 'faqs', label: 'FAQs' },
  { key: 'services', label: 'Services' },
  { key: 'pricing', label: 'Pricing' },
  { key: 'promotions', label: 'Promotions' },
  { key: 'policies', label: 'Policies' },
  { key: 'hours', label: 'Hours' },
];

/** Tabs backed by the relational knowledge tables and the generic CRUD table. */
const TABLE_FIELDS: Record<string, FieldSpec[]> = {
  faqs: [
    { key: 'question', label: 'Question', required: true, width: '35%' },
    { key: 'answer', label: 'Answer', type: 'textarea', required: true },
    {
      key: 'category',
      label: 'Category',
      type: 'select',
      width: '15%',
      // Populated per-client at render time from GET /knowledge/categories —
      // this placeholder only covers "uncategorised" before that load lands.
      options: [{ value: '', label: '— none —' }],
    },
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

/**
 * Blank strings must not be sent as empty values for numeric or free-text
 * nullable columns — an untouched field should not overwrite existing data
 * with ''. `select` is the exception: '' is its deliberate "no choice" value
 * (e.g. FAQ category's "— none —"), and the PATCH route only clears a field
 * when the key is present in the body at all, so an omitted key here would
 * silently leave the old value in place instead of clearing it.
 */
function cleanPayload(values: Record<string, string>, fields: FieldSpec[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = values[field.key];
    if (raw === undefined) continue;
    if (raw === '' && field.type !== 'select') continue;
    out[field.key] = field.type === 'number' ? Number(raw) : raw;
  }
  return out;
}

interface Row { id: string; [key: string]: unknown }

function KnowledgeTable({
  tab,
  clientId,
  canWrite,
  onChanged,
}: {
  tab: string;
  clientId: string;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const fields = TABLE_FIELDS[tab];

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api
      .get(`/knowledge/${tab}`, { params: { clientId } })
      .then((r) => setRows(r.data.data ?? []))
      .catch((e) => setError(e?.response?.data?.error ?? 'Could not load this section'))
      .finally(() => setLoading(false));
  }, [tab, clientId]);

  // The category dropdown's options come from the client's own list, not a
  // static config — active categories only, same set the FAQ route validates
  // writes against.
  const loadCategories = useCallback(() => {
    if (tab !== 'faqs') return;
    api
      .get('/knowledge/categories', { params: { clientId } })
      .then((r) => setCategories(r.data.data ?? []))
      .catch(() => setCategories([]));
  }, [tab, clientId]);

  useEffect(load, [load]);
  useEffect(loadCategories, [loadCategories]);

  const resolvedFields: FieldSpec[] =
    tab === 'faqs'
      ? fields.map((f) =>
          f.key === 'category'
            ? {
                ...f,
                options: [
                  { value: '', label: '— none —' },
                  ...categories.map((c) => ({ value: c.name, label: c.name })),
                ],
              }
            : f
        )
      : fields;

  return (
    <>
      {error && (
        <div role="alert" className="mb-4 rounded-lg border border-lamp-bad-rim bg-lamp-bad-wash px-4 py-3 text-sm text-lamp-bad-ink">
          {error}
        </div>
      )}

      {/* Platform-only; the component itself gates on isPlatform, since every
          write here 403s for a client user. */}
      {tab === 'faqs' && (
        <CategoryEditor
          clientId={clientId}
          onChanged={() => {
            loadCategories();
            onChanged();
          }}
        />
      )}

      {/* Suggestions only make sense where the model has something to ground a
          draft in — the FAQ set is the one section with that context. */}
      {tab === 'faqs' && canWrite && (
        <CopilotFaqs
          clientId={clientId}
          onAdd={async (draft) => {
            await api.post('/knowledge/faqs', draft, { params: { clientId } });
            onChanged();
            load();
          }}
        />
      )}

      <InlineEditTable
        rows={rows}
        fields={resolvedFields}
        loading={loading}
        readOnly={!canWrite}
        emptyMessage={`No ${tab} yet. Add the first one so your agent can answer about it.`}
        onCreate={async (values) => {
          await api.post(`/knowledge/${tab}`, cleanPayload(values, resolvedFields), { params: { clientId } });
          onChanged();
          load();
        }}
        onUpdate={async (id, values) => {
          await api.patch(`/knowledge/${tab}/${id}`, cleanPayload(values, resolvedFields));
          onChanged();
          load();
        }}
        onDelete={async (id) => {
          await api.delete(`/knowledge/${tab}/${id}`);
          onChanged();
          load();
        }}
      />
    </>
  );
}

function KnowledgePageInner() {
  const tab = useActiveTab(TABS);
  const { can } = useSession();
  const canWrite = can('knowledge:write');
  const { clientId, needsChoice, ready } = useClientScope();

  const [syncState, setSyncState] = useState<string | null>(null);
  const [timezone, setTimezone] = useState('UTC');

  // The hours editor needs a timezone to seed a first-time schedule with.
  useEffect(() => {
    if (!clientId) return;
    api
      .get(`/clients/${clientId}`)
      .then((r) => setTimezone(r.data?.timezone ?? 'UTC'))
      .catch(() => setTimezone('UTC'));
  }, [clientId]);

  // After a write the agent is stale until the queued provision runs, so the
  // header says so rather than implying the change is already live on calls.
  const markPending = () => setSyncState('pending');

  return (
    <div>
      <PageHeader
        title="Knowledge"
        description="What the agent tells callers. Changes go live on calls within about a minute."
        action={syncState ? <SyncBadge state={syncState} /> : undefined}
      />

      <ClientPicker label="Editing knowledge for" />

      {!canWrite && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-panel-200 bg-panel-50 px-4 py-3 text-sm text-panel-700">
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
          <p>You have read-only access. Ask an account owner to make changes.</p>
        </div>
      )}

      {!ready ? (
        <div className="h-64 animate-pulse rounded-xl bg-panel-100" />
      ) : needsChoice || !clientId ? (
        <ChooseClientPrompt what="Knowledge" />
      ) : (
        <>
          <Tabs tabs={TABS} />

          {TABLE_FIELDS[tab] ? (
            <KnowledgeTable tab={tab} clientId={clientId} canWrite={canWrite} onChanged={markPending} />
          ) : tab === 'policies' ? (
            <PoliciesEditor clientId={clientId} readOnly={!canWrite} />
          ) : (
            <HoursEditor clientId={clientId} readOnly={!canWrite} timezone={timezone} />
          )}
        </>
      )}
    </div>
  );
}

export default function KnowledgePage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-panel-100" />}>
      <KnowledgePageInner />
    </Suspense>
  );
}
