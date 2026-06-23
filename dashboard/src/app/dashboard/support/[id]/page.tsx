'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { getSession, isPlatformUser, type Session } from '@/lib/session';
import { statusColor, statusLabel, priorityColor, TICKET_STATUSES } from '@/lib/tickets';

interface Message {
  id: string;
  author_id: string | null;
  body: string;
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
  assigned_to: string | null;
  created_at: string;
  messages: Message[];
  history: History[];
}

export default function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'conversation' | 'history'>('conversation');
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  // Triage controls (platform staff only).
  const [newStatus, setNewStatus] = useState('');
  const [note, setNote] = useState('');
  const [updating, setUpdating] = useState(false);

  // Resolve session after mount so the first client render matches the server
  // HTML (no hydration mismatch). `undefined` = not yet known.
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => setSession(getSession()), []);
  const platform = isPlatformUser(session ?? null);
  const myId = session?.sub;
  // Without a users lookup we label by identity: the signed-in user is "You",
  // everyone else is "Support".
  const who = (userId: string | null) => (userId && userId === myId ? 'You' : 'Support');

  const load = () => {
    api
      .get(`/tickets/${id}`)
      .then((r) => {
        setTicket(r.data);
        setNewStatus(r.data.status);
      })
      .finally(() => setLoading(false));
  };
  useEffect(load, [id]);

  const updateStatus = async () => {
    if (!ticket || newStatus === ticket.status) return;
    setUpdating(true);
    try {
      await api.patch(`/tickets/${id}`, { status: newStatus, note: note || undefined });
      setNote('');
      load();
    } finally {
      setUpdating(false);
    }
  };

  const assignToMe = async () => {
    setUpdating(true);
    try {
      await api.patch(`/tickets/${id}`, { assignedTo: myId });
      load();
    } finally {
      setUpdating(false);
    }
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reply.trim()) return;
    setSending(true);
    try {
      await api.post(`/tickets/${id}/messages`, { body: reply });
      setReply('');
      load();
    } finally {
      setSending(false);
    }
  };

  if (loading) return <div className="text-gray-400 animate-pulse">Loading...</div>;
  if (!ticket) return <div>Ticket not found</div>;

  return (
    <div className="max-w-3xl">
      <div className="flex items-start justify-between mb-1">
        <h1 className="text-2xl font-bold">{ticket.subject}</h1>
        <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${statusColor(ticket.status)}`}>
          {statusLabel(ticket.status)}
        </span>
      </div>
      <div className="flex items-center gap-2 text-sm text-gray-400 mb-4">
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${priorityColor(ticket.priority)}`}>
          {ticket.priority}
        </span>
        <span>Opened {new Date(ticket.created_at).toLocaleString()}</span>
      </div>
      {ticket.description && (
        <p className="bg-white border border-gray-200 rounded-xl p-4 text-sm text-gray-700 mb-6 whitespace-pre-wrap">
          {ticket.description}
        </p>
      )}

      {platform && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-sm font-medium text-gray-700">Status</label>
            <select
              value={newStatus}
              onChange={(e) => setNewStatus(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {TICKET_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </select>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional note (recorded in history)"
              className="flex-1 min-w-[12rem] border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <button
              onClick={updateStatus}
              disabled={updating || newStatus === ticket.status}
              className="bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold px-4 py-2 rounded-lg transition disabled:opacity-50"
            >
              Update
            </button>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-gray-500">
              {ticket.assigned_to
                ? ticket.assigned_to === myId
                  ? 'Assigned to you'
                  : 'Assigned to another staff member'
                : 'Unassigned'}
            </span>
            {ticket.assigned_to !== myId && (
              <button
                onClick={assignToMe}
                disabled={updating}
                className="text-brand-600 hover:underline font-medium disabled:opacity-50"
              >
                Assign to me
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex gap-1 border-b border-gray-200 mb-4">
        {(['conversation', 'history'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${
              tab === t ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'conversation' ? 'Conversation' : 'History'}
          </button>
        ))}
      </div>

      {tab === 'conversation' ? (
        <div>
          <div className="space-y-3 mb-4">
            {ticket.messages.length === 0 && (
              <p className="text-gray-400 text-sm">No messages yet. Start the conversation below.</p>
            )}
            {ticket.messages.map((m) => {
              const mine = m.author_id === myId;
              return (
                <div key={m.id} className={`flex ${mine ? 'justify-end' : ''}`}>
                  <div className={`max-w-md px-4 py-2 rounded-xl text-sm ${mine ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-800'}`}>
                    <div className={`text-xs mb-1 ${mine ? 'text-brand-100' : 'text-gray-400'}`}>
                      {who(m.author_id)} · {new Date(m.created_at).toLocaleString()}
                    </div>
                    <div className="whitespace-pre-wrap">{m.body}</div>
                  </div>
                </div>
              );
            })}
          </div>
          <form onSubmit={send} className="flex gap-2">
            <input
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              maxLength={5000}
              placeholder="Write a reply..."
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <button
              type="submit"
              disabled={sending || !reply.trim()}
              className="bg-brand-500 hover:bg-brand-600 text-white font-semibold px-4 py-2 rounded-lg transition disabled:opacity-50"
            >
              {sending ? 'Sending...' : 'Send'}
            </button>
          </form>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-50">
          {ticket.history.map((h) => (
            <div key={h.id} className="px-4 py-3 text-sm">
              <div className="flex items-center gap-2 flex-wrap">
                {h.from_status ? (
                  <>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(h.from_status)}`}>
                      {statusLabel(h.from_status)}
                    </span>
                    <span className="text-gray-400">→</span>
                  </>
                ) : (
                  <span className="text-gray-400 text-xs">Opened</span>
                )}
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(h.to_status)}`}>
                  {statusLabel(h.to_status)}
                </span>
                <span className="text-gray-400 text-xs ml-auto">
                  {who(h.changed_by)} · {new Date(h.created_at).toLocaleString()}
                </span>
              </div>
              {h.note && <p className="text-gray-600 mt-1">{h.note}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
