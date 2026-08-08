'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { Sparkles, Send, User } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { ClientPicker, useClientScope } from '@/components/ClientPicker';
import { useSession } from '@/lib/SessionProvider';

/**
 * Ask-your-data chat.
 *
 * The thread lives in component state and is sent whole on each turn — the API
 * is stateless and nothing here is persisted, so closing the page discards it.
 * That is deliberate: a stored thread would be a second copy of tenant data
 * with its own access-control surface, for a feature whose value is immediate.
 */

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  /** Tool names the assistant consulted — shown so answers are traceable. */
  consulted?: string[];
}

/** Starter questions differ by audience: staff think in estates, clients don't. */
const STAFF_PROMPTS = [
  'Which agents are out of sync or have publish errors?',
  'How many calls came in across all clients last week?',
  'Are any phone numbers configured but not actually routed?',
  'Show me CRM sync failures from the last 7 days',
];

const CLIENT_PROMPTS = [
  'How did my calls go last week?',
  'How many appointments did my agent book this month?',
  'Are there any calls I should follow up on?',
  'Is my agent working properly right now?',
];

/** Tool names are internal; the UI shows what was actually looked at. */
const TOOL_LABELS: Record<string, string> = {
  list_clients: 'client list',
  get_call_stats: 'call statistics',
  list_recent_calls: 'recent calls',
  get_call_detail: 'call transcript',
  list_appointments: 'appointments',
  get_agent_health: 'agent health',
  search_knowledge: 'knowledge base',
  get_crm_sync_health: 'CRM sync history',
  list_support_tickets: 'support tickets',
};

function AssistantInner() {
  const { isPlatform } = useSession();
  const { clientId } = useClientScope();

  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .get('/ai/status')
      .then((r) => setEnabled(!!r.data.enabled))
      .catch(() => setEnabled(false));
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, sending]);

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || sending) return;

    const next: Turn[] = [...turns, { role: 'user', content: question }];
    setTurns(next);
    setInput('');
    setSending(true);
    setError('');

    try {
      const { data } = await api.post('/ai/assistant', {
        ...(clientId ? { clientId } : {}),
        messages: next.map(({ role, content }) => ({ role, content })),
      });
      setTurns([...next, { role: 'assistant', content: data.reply, consulted: data.consulted }]);
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? 'The assistant could not answer that. Try again shortly.');
      setTurns(next);
    } finally {
      setSending(false);
    }
  };

  const prompts = isPlatform ? STAFF_PROMPTS : CLIENT_PROMPTS;

  if (enabled === false) {
    return (
      <div>
        <PageHeader title="Assistant" description="Ask questions about your calls, bookings, and agent." />
        <div className="rounded-xl border border-panel-200 bg-white px-6 py-14 text-center">
          <Sparkles className="mx-auto mb-3 h-8 w-8 text-panel-300" aria-hidden />
          <p className="text-sm font-medium text-ink-800">The assistant isn&apos;t switched on</p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-panel-500">
            An <code className="font-mono">ANTHROPIC_API_KEY</code> needs to be set on the API service
            before this page can answer anything.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] max-w-3xl flex-col">
      <PageHeader
        title="Assistant"
        description="Ask about your calls, bookings, and agent — in plain language."
      />

      {isPlatform && <ClientPicker label="Focus on one client (optional)" />}

      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-panel-200 bg-white p-5">
        {turns.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <Sparkles className="mb-3 h-8 w-8 text-panel-300" aria-hidden />
            <p className="text-sm font-medium text-ink-800">What would you like to know?</p>
            <p className="mt-1 max-w-md text-xs leading-relaxed text-panel-500">
              I can only see this account&apos;s data, and I&apos;ll tell you when I don&apos;t
              have an answer rather than guessing.
            </p>
            <ul className="mt-5 w-full max-w-md space-y-2">
              {prompts.map((p) => (
                <li key={p}>
                  <button
                    type="button"
                    onClick={() => send(p)}
                    className="w-full cursor-pointer rounded-lg border border-panel-200 bg-panel-25 px-3.5 py-2.5 text-left text-sm text-ink-800 transition-colors hover:border-panel-300 hover:bg-panel-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600"
                  >
                    {p}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <ul className="space-y-5">
            {turns.map((turn, i) => (
              <li key={i} className="flex gap-3">
                <span
                  className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full ${
                    turn.role === 'user' ? 'bg-panel-100 text-panel-600' : 'bg-ink-800 text-white'
                  }`}
                  aria-hidden
                >
                  {turn.role === 'user' ? <User className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="mb-1 text-2xs font-semibold uppercase tracking-[0.07em] text-panel-500">
                    {turn.role === 'user' ? 'You' : 'Assistant'}
                  </p>
                  <div className="whitespace-pre-wrap text-sm leading-relaxed text-ink-800">
                    {turn.content}
                  </div>
                  {turn.consulted && turn.consulted.length > 0 && (
                    <p className="mt-2 text-2xs text-panel-500">
                      Checked:{' '}
                      {[...new Set(turn.consulted)].map((t) => TOOL_LABELS[t] ?? t).join(', ')}
                    </p>
                  )}
                </div>
              </li>
            ))}

            {sending && (
              <li className="flex gap-3">
                <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-ink-800 text-white" aria-hidden>
                  <Sparkles className="h-3.5 w-3.5" />
                </span>
                <div className="flex items-center gap-1.5 pt-1.5" role="status">
                  <span className="sr-only">Thinking</span>
                  {[0, 1, 2].map((d) => (
                    <span
                      key={d}
                      className="h-1.5 w-1.5 animate-pulse rounded-full bg-panel-400"
                      style={{ animationDelay: `${d * 150}ms` }}
                      aria-hidden
                    />
                  ))}
                </div>
              </li>
            )}
          </ul>
        )}
        <div ref={endRef} />
      </div>

      {error && (
        <div role="alert" className="mt-3 rounded-lg border border-lamp-bad-rim bg-lamp-bad-wash px-4 py-2.5 text-sm text-lamp-bad-ink">
          {error}
        </div>
      )}

      <form
        onSubmit={(e) => { e.preventDefault(); send(input); }}
        className="mt-3 flex gap-2"
      >
        <label htmlFor="assistant-input" className="sr-only">Ask a question</label>
        <input
          id="assistant-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={sending || enabled === null}
          placeholder="Ask about calls, bookings, or your agent…"
          className="flex-1 rounded-md border border-panel-300 bg-white px-3.5 py-2.5 text-sm text-ink-900 placeholder:text-panel-400 transition-colors hover:border-panel-400 focus:border-signal-600 focus:outline-none focus:ring-2 focus:ring-signal-600/25 disabled:bg-panel-50"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="flex cursor-pointer items-center gap-2 rounded-md bg-ink-800 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Send className="h-4 w-4" aria-hidden />
          <span className="sr-only sm:not-sr-only">Ask</span>
        </button>
      </form>
    </div>
  );
}

export default function AssistantPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-panel-100" />}>
      <AssistantInner />
    </Suspense>
  );
}
