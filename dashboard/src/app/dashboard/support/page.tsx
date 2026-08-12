'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { FilterBar, type FilterSpec } from '@/components/FilterBar';
import { SlaCountdown } from '@/components/SlaCountdown';
import { StatusPill } from '@/components/StatusPill';
import { TicketComposer } from '@/components/TicketComposer';
import { useSession } from '@/lib/SessionProvider';
import { statusColor, statusLabel, priorityColor, TICKET_PRIORITIES } from '@/lib/tickets';
import { Bot } from 'lucide-react';

interface Ticket {
  id: string;
  subject: string;
  status: string;
  priority: string;
  source: string;
  created_at: string;
  client_id: string;
  assigned_to: string | null;
  first_response_at: string | null;
  sla_response_due_at: string | null;
  sla_breached_at: string | null;
  resolved_at: string | null;
}

const staffFilters: FilterSpec[] = [
  {
    key: 'status',
    label: 'Status',
    type: 'select',
    options: [
      { value: 'investigating', label: 'Investigating' },
      { value: 'waiting_on_client', label: 'Waiting on client' },
      { value: 'waiting_on_third_party', label: 'Waiting on third party' },
      { value: 'resolved', label: 'Resolved' },
      { value: 'closed', label: 'Closed' },
    ],
  },
  {
    key: 'priority',
    label: 'Priority',
    type: 'select',
    options: TICKET_PRIORITIES.map((p) => ({ value: p, label: p })),
  },
  {
    key: 'assignedTo',
    label: 'Assignee',
    type: 'select',
    options: [{ value: 'unassigned', label: 'Unassigned' }],
  },
  {
    key: 'slaState',
    label: 'SLA',
    type: 'select',
    options: [
      { value: 'breached', label: 'Breached' },
      { value: 'at_risk', label: 'Due within the hour' },
    ],
  },
  {
    key: 'source',
    label: 'Source',
    type: 'select',
    options: [
      { value: 'dashboard', label: 'Dashboard' },
      { value: 'voice', label: 'Caller' },
      { value: 'system', label: 'System' },
    ],
  },
];

function SupportPageInner() {
  const searchParams = useSearchParams();
  const { isPlatform, loading: sessionLoading } = useSession();

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('normal');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const query = searchParams.toString();

  const load = useCallback(() => {
    setLoading(true);
    api
      .get(`/tickets?${query}`)
      .then((r) => {
        setTickets(r.data.data ?? []);
        setCount(r.data.count ?? 0);
      })
      .finally(() => setLoading(false));
  }, [query]);

  useEffect(load, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await api.post('/tickets', { subject, description, priority });
      setSubject('');
      setDescription('');
      setPriority('normal');
      setShowForm(false);
      toast.success('Ticket submitted');
      load();
    } catch {
      setError('Could not submit your ticket. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls =
    'w-full border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500';

  const breached = tickets.filter((t) => t.sla_breached_at && !t.first_response_at).length;

  return (
    <div className={isPlatform ? '' : 'max-w-4xl'}>
      <PageHeader
        title={isPlatform ? 'Support Queue' : 'Support'}
        description={
          isPlatform
            ? 'Sorted by how close each ticket is to breaching its response target.'
            : 'Raise an issue and follow its progress.'
        }
        action={
          !isPlatform && !sessionLoading ? (
            <button
              onClick={() => setShowForm((s) => !s)}
              className="cursor-pointer bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
            >
              {showForm ? 'Cancel' : 'Submit a ticket'}
            </button>
          ) : undefined
        }
      />

      {isPlatform && breached > 0 && (
        <div role="alert" className="mb-4 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {breached} ticket{breached > 1 ? 's have' : ' has'} passed the first-response target without a reply.
        </div>
      )}

      {showForm && !isPlatform && (
        <TicketComposer
          onDraft={(draft) => {
            setSubject(draft.subject);
            setDescription(draft.description);
            setPriority(draft.priority);
          }}
        />
      )}

      {showForm && !isPlatform && (
        <form onSubmit={submit} className="mb-6 space-y-4 border border-gray-200 bg-surface-raised p-6">
          <div>
            <label htmlFor="subject" className="mb-1 block text-sm font-medium text-gray-700">Subject</label>
            <input id="subject" required maxLength={200} value={subject}
              onChange={(e) => setSubject(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label htmlFor="description" className="mb-1 block text-sm font-medium text-gray-700">Description</label>
            <textarea id="description" rows={4} maxLength={5000} value={description}
              onChange={(e) => setDescription(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label htmlFor="priority" className="mb-1 block text-sm font-medium text-gray-700">Priority</label>
            <select id="priority" value={priority} onChange={(e) => setPriority(e.target.value)}
              className={`${inputCls} max-w-xs cursor-pointer`}>
              {TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={submitting || !subject.trim()}
            className="cursor-pointer bg-primary-600 px-4 py-2 font-semibold text-white transition-colors hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50">
            {submitting ? 'Submitting…' : 'Submit ticket'}
          </button>
        </form>
      )}

      {isPlatform && <FilterBar filters={staffFilters} />}

      {loading ? (
        <div className="overflow-hidden border border-gray-200 bg-surface-raised">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse border-b border-gray-100 bg-gray-50 last:border-0" />
          ))}
        </div>
      ) : tickets.length === 0 ? (
        <div className="border border-gray-200 bg-surface-raised p-10 text-center">
          <p className="text-gray-500">No tickets</p>
          <p className="mt-1 text-sm text-gray-400">
            {isPlatform ? 'Nothing matched these filters.' : 'You have not raised any tickets yet.'}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden border border-gray-200 bg-surface-raised">
          <div className="overflow-x-auto">
            <table className="w-full">
              <caption className="sr-only">{count} support tickets</caption>
              <thead className="sticky top-0 bg-gray-50">
                <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase tracking-wide text-gray-700">
                  <th scope="col" className="px-4 py-3">Subject</th>
                  <th scope="col" className="px-4 py-3">Priority</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  {isPlatform && <th scope="col" className="px-4 py-3">Response</th>}
                  {isPlatform && <th scope="col" className="px-4 py-3">Assignee</th>}
                  <th scope="col" className="px-4 py-3">Opened</th>
                  <th scope="col" className="px-4 py-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {tickets.map((t) => (
                  <tr key={t.id} className="text-sm transition-colors hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {t.source === 'system' && (
                          <span title="Opened automatically from repeated system errors">
                            <Bot className="h-4 w-4 flex-shrink-0 text-gray-400" aria-label="Opened automatically" />
                          </span>
                        )}
                        <span className="font-medium text-gray-800">{t.subject}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${priorityColor(t.priority)}`}>
                        {t.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(t.status)}`}>
                        {statusLabel(t.status)}
                      </span>
                    </td>
                    {isPlatform && (
                      <td className="px-4 py-3">
                        <SlaCountdown
                          dueAt={t.sla_response_due_at}
                          firstResponseAt={t.first_response_at}
                          breachedAt={t.sla_breached_at}
                          resolvedAt={t.resolved_at}
                        />
                      </td>
                    )}
                    {isPlatform && (
                      <td className="px-4 py-3">
                        {t.assigned_to
                          ? <span className="font-mono text-xs text-gray-600">{t.assigned_to.slice(0, 8)}</span>
                          : <StatusPill tone="warning" label="Unassigned" />}
                      </td>
                    )}
                    <td className="px-4 py-3 text-gray-500">{new Date(t.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/support/${t.id}`}
                        className="text-xs font-medium text-primary-600 hover:underline focus:outline-none focus:ring-2 focus:ring-primary-500">
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SupportPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse bg-gray-100" />}>
      <SupportPageInner />
    </Suspense>
  );
}
