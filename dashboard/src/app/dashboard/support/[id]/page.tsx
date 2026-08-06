'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { api } from '@/lib/api';
import { useSession } from '@/lib/SessionProvider';
import { SlaCountdown } from '@/components/SlaCountdown';
import { StatusPill } from '@/components/StatusPill';
import { statusColor, statusLabel, priorityColor, TICKET_STATUSES, TICKET_PRIORITIES } from '@/lib/tickets';
import { Lock, Bot, Activity } from 'lucide-react';

interface Message {
  id: string;
  author_id: string | null;
  body: string;
  visibility: 'client' | 'internal';
  created_at: string;
}
interface History {
  id: string;
  from_status: string | null;
  to_status: string;
  changed_by: string | null;
  note: string | null;
  created_at: string;
}
interface TicketDetail {
  id: string;
  subject: string;
  description: string;
  status: string;
  priority: string;
  source: string;
  assigned_to: string | null;
  error_fingerprint: string | null;
  first_response_at: string | null;
  sla_response_due_at: string | null;
  sla_resolution_due_at: string | null;
  sla_breached_at: string | null;
  resolved_at: string | null;
  created_at: string;
  messages: Message[];
  history: History[];
}

const inputCls =
  'rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500';

export default function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { auth, can, isPlatform } = useSession();
  const canTriage = can('tickets:triage');
  const myId = auth?.sub;

  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'conversation' | 'history'>('conversation');
  const [reply, setReply] = useState('');
  const [internal, setInternal] = useState(false);
  const [sending, setSending] = useState(false);

  const [newStatus, setNewStatus] = useState('');
  const [newPriority, setNewPriority] = useState('');
  const [note, setNote] = useState('');
  const [updating, setUpdating] = useState(false);

  // Without a users lookup we label by identity: the signed-in user is "You".
  // Clients never see staff names, so everyone else is "Support".
  const who = (userId: string | null) => {
    if (!userId) return 'System';
    return userId === myId ? 'You' : isPlatform ? 'Staff' : 'Support';
  };

  const load = useCallback(() => {
    api
      .get(`/tickets/${id}`)
      .then((r) => {
        setTicket(r.data);
        setNewStatus(r.data.status);
        setNewPriority(r.data.priority);
      })
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(load, [load]);

  const applyTriage = async () => {
    if (!ticket) return;
    const patch: Record<string, unknown> = {};
    if (newStatus !== ticket.status) patch.status = newStatus;
    if (newPriority !== ticket.priority) patch.priority = newPriority;
    if (note) patch.note = note;
    if (Object.keys(patch).length === 0) return;

    setUpdating(true);
    try {
      await api.patch(`/tickets/${id}`, patch);
      setNote('');
      toast.success('Ticket updated');
      load();
    } catch {
      toast.error('Could not update this ticket');
    } finally {
      setUpdating(false);
    }
  };

  const assignToMe = async () => {
    setUpdating(true);
    try {
      await api.patch(`/tickets/${id}`, { assignedTo: myId });
      load();
    } catch {
      toast.error('Could not assign this ticket');
    } finally {
      setUpdating(false);
    }
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reply.trim()) return;
    setSending(true);
    try {
      await api.post(`/tickets/${id}/messages`, {
        body: reply,
        visibility: internal ? 'internal' : 'client',
      });
      setReply('');
      setInternal(false);
      load();
    } catch {
      toast.error('Could not send that message');
    } finally {
      setSending(false);
    }
  };

  if (loading) return <div className="h-64 animate-pulse rounded-xl bg-gray-100" />;
  if (!ticket) return <div className="text-gray-500">Ticket not found</div>;

  return (
    <div className="max-w-3xl">
      <div className="mb-1 flex items-start justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900">{ticket.subject}</h1>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusColor(ticket.status)}`}>
          {statusLabel(ticket.status)}
        </span>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-gray-500">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${priorityColor(ticket.priority)}`}>
          {ticket.priority}
        </span>
        {ticket.source === 'system' && <StatusPill tone="info" label="Opened automatically" icon={Bot} />}
        {ticket.source === 'voice' && <StatusPill tone="info" label="Reported by a caller" />}
        <span>Opened {new Date(ticket.created_at).toLocaleString()}</span>
      </div>

      {ticket.description && (
        <p className="mb-6 whitespace-pre-wrap rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700">
          {ticket.description}
        </p>
      )}

      {isPlatform && (
        <div className="mb-6 flex flex-wrap items-center gap-4 rounded-xl border border-gray-200 bg-white p-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">First response</p>
            <div className="mt-1">
              <SlaCountdown
                dueAt={ticket.sla_response_due_at}
                firstResponseAt={ticket.first_response_at}
                breachedAt={ticket.sla_breached_at}
                resolvedAt={ticket.resolved_at}
              />
            </div>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Resolution due</p>
            <p className="mt-1 text-sm text-gray-700">
              {ticket.sla_resolution_due_at ? new Date(ticket.sla_resolution_due_at).toLocaleString() : '—'}
            </p>
          </div>
          {ticket.error_fingerprint && (
            <div className="ml-auto">
              <Link
                href={`/dashboard/system?q=${encodeURIComponent(ticket.error_fingerprint)}`}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:underline focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <Activity className="h-4 w-4" aria-hidden /> View system activity
              </Link>
            </div>
          )}
        </div>
      )}

      {canTriage && (
        <div className="mb-6 space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="status" className="mb-1 block text-xs font-medium text-gray-500">Status</label>
              <select id="status" value={newStatus} onChange={(e) => setNewStatus(e.target.value)}
                className={`${inputCls} cursor-pointer`}>
                {TICKET_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="priority" className="mb-1 block text-xs font-medium text-gray-500">Priority</label>
              <select id="priority" value={newPriority} onChange={(e) => setNewPriority(e.target.value)}
                className={`${inputCls} cursor-pointer`}>
                {TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="min-w-[12rem] flex-1">
              <label htmlFor="note" className="mb-1 block text-xs font-medium text-gray-500">
                Note (recorded in history)
              </label>
              <input id="note" value={note} onChange={(e) => setNote(e.target.value)} className={`${inputCls} w-full`} />
            </div>
            <button
              onClick={applyTriage}
              disabled={updating || (newStatus === ticket.status && newPriority === ticket.priority && !note)}
              className="cursor-pointer rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50"
            >
              Update
            </button>
          </div>

          <div className="flex items-center gap-3 text-sm">
            <span className="text-gray-500">
              {ticket.assigned_to
                ? ticket.assigned_to === myId ? 'Assigned to you' : 'Assigned to another staff member'
                : 'Unassigned'}
            </span>
            {ticket.assigned_to !== myId && (
              <button onClick={assignToMe} disabled={updating}
                className="cursor-pointer font-medium text-primary-600 hover:underline focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50">
                Assign to me
              </button>
            )}
          </div>
        </div>
      )}

      <div role="tablist" className="mb-4 flex gap-1 border-b border-gray-200">
        {(['conversation', 'history'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={clsx(
              '-mb-px cursor-pointer border-b-2 px-4 py-2 text-sm font-medium transition-colors',
              'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1',
              tab === t ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            )}
          >
            {t === 'conversation' ? 'Conversation' : 'History'}
          </button>
        ))}
      </div>

      {tab === 'conversation' ? (
        <div>
          <div className="mb-4 space-y-3">
            {ticket.messages.length === 0 && (
              <p className="text-sm text-gray-400">No messages yet. Start the conversation below.</p>
            )}
            {ticket.messages.map((m) => {
              const mine = m.author_id === myId;
              const isInternal = m.visibility === 'internal';
              return (
                <div key={m.id} className={clsx('flex', mine && !isInternal && 'justify-end')}>
                  <div
                    className={clsx(
                      'max-w-md rounded-xl px-4 py-2 text-sm',
                      // Internal notes get a distinct, deliberately un-chatlike
                      // treatment plus an explicit label — nobody should be able
                      // to mistake one for something the client can read.
                      isInternal
                        ? 'w-full max-w-none border border-dashed border-amber-300 bg-amber-50 text-amber-900'
                        : mine
                          ? 'bg-primary-600 text-white'
                          : 'bg-gray-100 text-gray-800'
                    )}
                  >
                    <div
                      className={clsx(
                        'mb-1 flex items-center gap-1.5 text-xs',
                        isInternal ? 'font-medium text-amber-700' : mine ? 'text-primary-100' : 'text-gray-400'
                      )}
                    >
                      {isInternal && <Lock className="h-3 w-3" aria-hidden />}
                      {isInternal && <span>Internal note — not visible to the client</span>}
                      {!isInternal && <span>{who(m.author_id)}</span>}
                      <span aria-hidden>·</span>
                      <span>{new Date(m.created_at).toLocaleString()}</span>
                    </div>
                    <div className="whitespace-pre-wrap">{m.body}</div>
                  </div>
                </div>
              );
            })}
          </div>

          <form onSubmit={send} className="space-y-2">
            <label htmlFor="reply" className="sr-only">Message</label>
            <div className="flex gap-2">
              <input
                id="reply"
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                maxLength={5000}
                placeholder={internal ? 'Internal note — staff only…' : 'Write a reply…'}
                className={clsx(
                  'flex-1 rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2',
                  internal
                    ? 'border-amber-300 bg-amber-50 focus:border-amber-400 focus:ring-amber-400'
                    : 'border-gray-300 focus:border-primary-500 focus:ring-primary-500'
                )}
              />
              <button
                type="submit"
                disabled={sending || !reply.trim()}
                className="cursor-pointer rounded-lg bg-primary-600 px-4 py-2 font-semibold text-white transition-colors hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50"
              >
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>

            {canTriage && (
              <div className="flex items-center gap-2">
                <input
                  id="internal"
                  type="checkbox"
                  checked={internal}
                  onChange={(e) => setInternal(e.target.checked)}
                  className="h-4 w-4 cursor-pointer rounded border-gray-300 text-amber-600 focus:ring-2 focus:ring-amber-500"
                />
                <label htmlFor="internal" className="flex cursor-pointer items-center gap-1.5 text-sm text-gray-600">
                  <Lock className="h-3.5 w-3.5" aria-hidden />
                  Internal note — the client will not see this
                </label>
              </div>
            )}
          </form>
        </div>
      ) : (
        <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
          {ticket.history.map((h) => (
            <div key={h.id} className="px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                {h.from_status ? (
                  <>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(h.from_status)}`}>
                      {statusLabel(h.from_status)}
                    </span>
                    <span className="text-gray-400" aria-label="changed to">to</span>
                  </>
                ) : (
                  <span className="text-xs text-gray-400">Opened</span>
                )}
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(h.to_status)}`}>
                  {statusLabel(h.to_status)}
                </span>
                <span className="ml-auto text-xs text-gray-400">
                  {who(h.changed_by)} · {new Date(h.created_at).toLocaleString()}
                </span>
              </div>
              {h.note && <p className="mt-1 text-gray-600">{h.note}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
