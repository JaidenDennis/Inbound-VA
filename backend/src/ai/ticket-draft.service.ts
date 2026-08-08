import { getClaude, AI_MODEL, AI_EFFORT } from './claude.client.js';
import { supabase } from '../db/index.js';

/**
 * Turns "my agent is being weird" into a ticket support can act on.
 *
 * Clients describe symptoms, not causes, and a ticket that says "it's broken"
 * costs a round trip before anyone can start. This drafts a structured ticket
 * from their description plus their account's current state — so the agent's
 * sync status and recent failures are attached before a human reads it.
 *
 * It returns a draft. The client edits and submits; nothing is filed on their
 * behalf, so an AI misreading never creates a ticket nobody meant to open.
 */

const TICKET_SCHEMA = {
  type: 'object',
  properties: {
    subject: { type: 'string' },
    body: { type: 'string' },
    priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
    category: {
      type: 'string',
      enum: ['agent_behavior', 'phone_routing', 'booking', 'crm', 'billing', 'other'],
    },
    likely_cause: { type: 'string' },
    self_serve_fix: { type: 'string' },
  },
  required: ['subject', 'body', 'priority', 'category', 'likely_cause', 'self_serve_fix'],
  additionalProperties: false,
} as const;

export interface TicketDraft {
  subject: string;
  body: string;
  priority: string;
  category: string;
  likely_cause: string;
  /** Empty when there is nothing the client can fix without support. */
  self_serve_fix: string;
}

/** Facts about the account that usually explain the complaint. */
async function accountSnapshot(clientId: string): Promise<string> {
  const [clientRow, syncFailures, recentCalls] = await Promise.all([
    supabase
      .from('clients')
      .select('name, status, retell_agent_id, agent_sync_state, agent_sync_error, phone_numbers')
      .eq('id', clientId)
      .maybeSingle(),
    supabase
      .from('crm_sync_logs')
      .select('status, error_message')
      .eq('client_id', clientId)
      .neq('status', 'success')
      .order('created_at', { ascending: false })
      .limit(5),
    supabase
      .from('calls')
      .select('status, started_at')
      .eq('client_id', clientId)
      .order('started_at', { ascending: false })
      .limit(10),
  ]);

  const c = clientRow.data as Record<string, unknown> | null;
  const failures = ((syncFailures.data ?? []) as Array<{ error_message: string | null }>)
    .map((f) => `- ${f.error_message ?? 'unknown error'}`)
    .join('\n');
  const calls = ((recentCalls.data ?? []) as Array<{ status: string }>)
    .map((r) => r.status)
    .join(', ');

  return `Account: ${String(c?.name ?? 'unknown')} (status: ${String(c?.status ?? 'unknown')})
Agent provisioned: ${c?.retell_agent_id ? 'yes' : 'no'}
Agent publish state: ${String(c?.agent_sync_state ?? 'never')}
Last publish error: ${String(c?.agent_sync_error ?? 'none')}
Phone numbers configured: ${((c?.phone_numbers as string[] | null) ?? []).join(', ') || 'none'}
Recent call statuses: ${calls || 'no calls recorded'}
Recent CRM sync failures:
${failures || '(none)'}`;
}

export async function draftTicket(clientId: string, description: string): Promise<TicketDraft | null> {
  const claude = getClaude();
  const snapshot = await accountSnapshot(clientId);

  const response = await claude.messages.create({
    model: AI_MODEL,
    max_tokens: 2048,
    output_config: { effort: AI_EFFORT, format: { type: 'json_schema', schema: TICKET_SCHEMA } },
    system: `You turn a customer's description of a problem into a support ticket for the Gravvia Engage team, using the account snapshot to add the technical context the customer cannot provide.

Rules:
- The subject is one specific line. "Agent not answering calls on main number", not "Urgent problem".
- The body restates the problem in the customer's terms, then lists the relevant facts from the account snapshot. Do not include facts that have nothing to do with the complaint.
- Set priority by impact on the business: urgent = calls are not being answered at all; high = a core function is broken; normal = something is wrong but working around it is possible; low = a question or cosmetic issue.
- "likely_cause" is your best read from the snapshot, stated as a possibility, not a conclusion. If the snapshot shows nothing relevant, say the snapshot shows nothing unusual.
- "self_serve_fix" is a step the customer can take right now to fix it themselves. If there is genuinely nothing, return an empty string rather than filler.
- Never invent an error, a number, or a date that is not in the snapshot.`,
    messages: [
      {
        role: 'user',
        content: `Customer's description:
${description}

Account snapshot:
${snapshot}`,
      },
    ],
  });

  const block = response.content.find((b): b is { type: 'text'; text: string; citations: null } => b.type === 'text');
  if (!block) return null;

  try {
    return JSON.parse(block.text) as TicketDraft;
  } catch {
    return null;
  }
}
