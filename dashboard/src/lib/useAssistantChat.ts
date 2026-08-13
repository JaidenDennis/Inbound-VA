'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';

/**
 * The assistant conversation, as state.
 *
 * Extracted so the side panel and the full page are the same conversation
 * logic rather than two copies that drift the first time either is touched.
 *
 * The thread is deliberately not persisted. A stored transcript would be a
 * second copy of tenant data with its own access-control surface, for a
 * feature whose value is immediate.
 */

export interface Turn {
  role: 'user' | 'assistant';
  content: string;
  /** Tool names the assistant consulted — shown so answers are traceable. */
  consulted?: string[];
}

/** Tool names are internal; the UI shows what was actually looked at. */
export const TOOL_LABELS: Record<string, string> = {
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

/** Starter questions differ by audience: staff think in estates, clients don't. */
export const STAFF_PROMPTS = [
  'Which agents are out of sync or have publish errors?',
  'How many calls came in across all clients last week?',
  'Are any phone numbers configured but not actually routed?',
  'Show me CRM sync failures from the last 7 days',
];

export const CLIENT_PROMPTS = [
  'How did my calls go last week?',
  'How many appointments did my agent book this month?',
  'Are there any calls I should follow up on?',
  'Is my agent working properly right now?',
];

export interface AssistantChat {
  turns: Turn[];
  sending: boolean;
  /** null while the capability check is in flight. */
  enabled: boolean | null;
  error: string;
  send: (text: string) => Promise<void>;
  reset: () => void;
}

export function useAssistantChat(clientId: string | null): AssistantChat {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [sending, setSending] = useState(false);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api
      .get('/ai/status')
      .then((r) => {
        if (!cancelled) setEnabled(!!r.data.enabled);
      })
      .catch(() => {
        if (!cancelled) setEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const send = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || sending) return;

      const next: Turn[] = [...turns, { role: 'user', content: question }];
      setTurns(next);
      setSending(true);
      setError('');

      try {
        const { data } = await api.post('/ai/assistant', {
          ...(clientId ? { clientId } : {}),
          messages: next.map(({ role, content }) => ({ role, content })),
        });
        setTurns([...next, { role: 'assistant', content: data.reply, consulted: data.consulted }]);
      } catch (e) {
        setError(errorMessage(e, 'The assistant could not answer that. Try again shortly.'));
        // The question stays on screen. Dropping it would make a failure look
        // like the user never asked, and they would have to retype it.
        setTurns(next);
      } finally {
        setSending(false);
      }
    },
    [clientId, sending, turns]
  );

  const reset = useCallback(() => {
    setTurns([]);
    setError('');
  }, []);

  return { turns, sending, enabled, error, send, reset };
}
