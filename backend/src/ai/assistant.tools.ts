import { supabase } from '../db/index.js';
import { logger } from '../utils/index.js';

/**
 * The assistant's read-only view of the database.
 *
 * Two rules hold for every tool here, and they are the reason the assistant can
 * be pointed at a live production database at all:
 *
 *  1. READ ONLY. Nothing in this file writes, updates, or deletes. The model
 *     cannot be talked into a mutation because no mutation exists to call.
 *  2. THE TENANT IS NOT A PARAMETER. `clientId` is bound from the caller's JWT
 *     when the tool set is built, and no tool accepts it as an argument. A
 *     client user therefore cannot prompt their way into another tenant's data
 *     — the model has no way to express the request.
 *
 * Platform staff get a null scope, which means cross-tenant reads. That is the
 * same access their own console pages already give them.
 */

export interface ToolContext {
  /** null = platform staff (all tenants). A uuid = pinned to that tenant. */
  clientId: string | null;
}

export interface AssistantTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  run: (input: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

/** Caps every result set. A tool that returns 10k rows just burns context. */
const MAX_ROWS = 50;

function clampLimit(raw: unknown, fallback = 20): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(MAX_ROWS, Math.floor(n));
}

/** ISO date N days ago — the assistant thinks in "last week", not timestamps. */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export const ASSISTANT_TOOLS: AssistantTool[] = [
  {
    name: 'list_clients',
    description:
      'List client accounts with their status, industry, and phone numbers. Use this to resolve a business name the user mentioned into a client, or to answer questions about how many clients exist and what state they are in.',
    input_schema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Optional partial name to filter by.' },
        limit: { type: 'integer', description: 'Max rows to return (default 20, max 50).' },
      },
    },
    run: async (input, ctx) => {
      let query = supabase
        .from('clients')
        .select('id, name, industry, status, phone_numbers, created_at')
        .order('name')
        .limit(clampLimit(input.limit));

      if (ctx.clientId) query = query.eq('id', ctx.clientId);
      if (typeof input.search === 'string' && input.search.trim()) {
        query = query.ilike('name', `%${input.search.trim()}%`);
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  },

  {
    name: 'get_call_stats',
    description:
      'Aggregate call statistics over a period: total calls, calls answered, appointments booked, leads captured, missed calls recovered, and average duration. This is the right tool for "how did we do last week" style questions.',
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'integer', description: 'How many days back to cover. Default 30.' },
        client_id: {
          type: 'string',
          description:
            'Only for platform staff asking about one specific client. Omit for the whole estate.',
        },
      },
    },
    run: async (input, ctx) => {
      // A client user's own id always wins over anything the model supplies.
      const scope = ctx.clientId ?? (typeof input.client_id === 'string' ? input.client_id : null);
      const days = Number.isFinite(Number(input.days)) ? Math.min(365, Number(input.days)) : 30;

      const { data, error } = await supabase.rpc('report_kpis', {
        p_client_id: scope,
        p_from: daysAgo(days),
        p_to: new Date().toISOString(),
      });
      if (error) throw new Error(error.message);

      const row = (data as Array<Record<string, number>> | null)?.[0];
      return {
        period_days: days,
        scope: scope ? 'single client' : 'all clients',
        total_calls: Number(row?.total_calls ?? 0),
        calls_answered: Number(row?.calls_answered ?? 0),
        appointments_booked: Number(row?.appointments_booked ?? 0),
        leads_recaptured: Number(row?.leads_recaptured ?? 0),
        missed_calls_recovered: Number(row?.missed_calls_recovered ?? 0),
        avg_call_duration_seconds: Number(row?.avg_call_duration_seconds ?? 0),
      };
    },
  },

  {
    name: 'list_recent_calls',
    description:
      'List individual recent calls with their status, duration, and phone numbers. Use for questions about specific calls rather than totals.',
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'integer', description: 'How many days back. Default 7.' },
        status: {
          type: 'string',
          description: 'Filter to one status, e.g. completed, failed, transferred.',
        },
        limit: { type: 'integer', description: 'Max rows (default 20, max 50).' },
      },
    },
    run: async (input, ctx) => {
      const days = Number.isFinite(Number(input.days)) ? Math.min(365, Number(input.days)) : 7;

      let query = supabase
        .from('calls')
        .select('id, from_number, to_number, status, duration_seconds, started_at, clients(name)')
        .gte('started_at', daysAgo(days))
        .order('started_at', { ascending: false })
        .limit(clampLimit(input.limit));

      if (ctx.clientId) query = query.eq('client_id', ctx.clientId);
      if (typeof input.status === 'string' && input.status.trim()) {
        query = query.eq('status', input.status.trim());
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  },

  {
    name: 'get_call_detail',
    description:
      'Fetch one call with its transcript and summary. Use when the user asks what was said on a specific call.',
    input_schema: {
      type: 'object',
      properties: { call_id: { type: 'string', description: 'The call id.' } },
      required: ['call_id'],
    },
    run: async (input, ctx) => {
      const callId = String(input.call_id ?? '');
      const { data: call } = await supabase.from('calls').select('*').eq('id', callId).maybeSingle();
      if (!call) return { error: 'No call with that id.' };

      // Tenant check on the row itself, not on anything the model passed in.
      const row = call as { client_id: string };
      if (ctx.clientId && row.client_id !== ctx.clientId) {
        return { error: 'That call belongs to a different client.' };
      }

      const [transcript, summary] = await Promise.all([
        supabase.from('call_transcripts').select('transcript').eq('call_id', callId).maybeSingle(),
        supabase.from('call_summaries').select('summary').eq('call_id', callId).maybeSingle(),
      ]);

      return {
        call,
        transcript: (transcript.data as { transcript?: string } | null)?.transcript ?? null,
        summary: (summary.data as { summary?: string } | null)?.summary ?? null,
      };
    },
  },

  {
    name: 'list_appointments',
    description:
      'List upcoming or recent appointments the agent booked, with their status and scheduled time.',
    input_schema: {
      type: 'object',
      properties: {
        upcoming_only: { type: 'boolean', description: 'Default true.' },
        limit: { type: 'integer', description: 'Max rows (default 20, max 50).' },
      },
    },
    run: async (input, ctx) => {
      let query = supabase
        .from('appointments')
        .select('id, client_id, scheduled_at, status, service_name, contact_name, created_at')
        .order('scheduled_at', { ascending: true })
        .limit(clampLimit(input.limit));

      if (ctx.clientId) query = query.eq('client_id', ctx.clientId);
      if (input.upcoming_only !== false) query = query.gte('scheduled_at', new Date().toISOString());

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  },

  {
    name: 'get_agent_health',
    description:
      "Report whether each agent's live configuration matches the dashboard, whether its phone numbers are actually routed in Retell, and any publish errors. Use this for 'is my agent working' questions.",
    input_schema: { type: 'object', properties: {} },
    run: async (_input, ctx) => {
      let query = supabase
        .from('clients')
        .select(
          'id, name, status, retell_agent_id, agent_sync_state, agent_sync_error, agent_synced_at, phone_numbers'
        )
        .order('name');
      if (ctx.clientId) query = query.eq('id', ctx.clientId);

      const { data, error } = await query;
      if (error) throw new Error(error.message);

      const { data: mapped } = await supabase
        .from('retell_phone_numbers')
        .select('client_id, phone_number');
      const confirmed = new Set(
        ((mapped ?? []) as Array<{ client_id: string; phone_number: string }>).map(
          (r) => `${r.client_id}:${r.phone_number}`
        )
      );

      return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((c) => {
        const numbers = (c.phone_numbers as string[] | null) ?? [];
        return {
          name: c.name,
          status: c.status,
          provisioned: !!c.retell_agent_id,
          sync_state: c.agent_sync_state ?? 'never',
          sync_error: c.agent_sync_error ?? null,
          last_published: c.agent_synced_at ?? null,
          numbers_routed: numbers.filter((n) => confirmed.has(`${c.id as string}:${n}`)),
          numbers_not_routed: numbers.filter((n) => !confirmed.has(`${c.id as string}:${n}`)),
        };
      });
    },
  },

  {
    name: 'search_knowledge',
    description:
      "Search what the agent knows — FAQs, services, pricing, and promotions. Use to answer 'does my agent know about X'.",
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'What to look for.' } },
      required: ['query'],
    },
    run: async (input, ctx) => {
      if (!ctx.clientId) {
        return { error: 'Knowledge is per-client. Ask about a specific client.' };
      }
      const term = `%${String(input.query ?? '').trim()}%`;

      const [faqs, services, pricing] = await Promise.all([
        supabase
          .from('faqs')
          .select('question, answer')
          .eq('client_id', ctx.clientId)
          .eq('active', true)
          .or(`question.ilike.${term},answer.ilike.${term}`)
          .limit(10),
        supabase
          .from('services')
          .select('name, description, price, duration_minutes')
          .eq('client_id', ctx.clientId)
          .eq('active', true)
          .ilike('name', term)
          .limit(10),
        supabase
          .from('pricing')
          .select('name, price, unit, notes')
          .eq('client_id', ctx.clientId)
          .eq('active', true)
          .ilike('name', term)
          .limit(10),
      ]);

      return { faqs: faqs.data ?? [], services: services.data ?? [], pricing: pricing.data ?? [] };
    },
  },

  {
    name: 'get_crm_sync_health',
    description:
      'Report how many CRM pushes succeeded vs failed recently, and the most common failure reasons.',
    input_schema: {
      type: 'object',
      properties: { days: { type: 'integer', description: 'How many days back. Default 7.' } },
    },
    run: async (input, ctx) => {
      const days = Number.isFinite(Number(input.days)) ? Math.min(90, Number(input.days)) : 7;

      let query = supabase
        .from('crm_sync_logs')
        .select('status, entity_type, operation, error_message')
        .gte('created_at', daysAgo(days))
        .limit(500);
      if (ctx.clientId) query = query.eq('client_id', ctx.clientId);

      const { data, error } = await query;
      if (error) throw new Error(error.message);

      const rows = (data ?? []) as Array<{ status: string; error_message: string | null }>;
      const failures = rows.filter((r) => r.status !== 'success');
      const reasons = new Map<string, number>();
      for (const f of failures) {
        const key = (f.error_message ?? 'unknown').slice(0, 120);
        reasons.set(key, (reasons.get(key) ?? 0) + 1);
      }

      return {
        period_days: days,
        total: rows.length,
        succeeded: rows.length - failures.length,
        failed: failures.length,
        top_failure_reasons: [...reasons.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([reason, count]) => ({ reason, count })),
      };
    },
  },

  {
    name: 'list_support_tickets',
    description: 'List support tickets with their status, priority, and subject.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by status, e.g. open, resolved.' },
        limit: { type: 'integer', description: 'Max rows (default 20, max 50).' },
      },
    },
    run: async (input, ctx) => {
      let query = supabase
        .from('tickets')
        .select('id, subject, status, priority, created_at, updated_at')
        .order('created_at', { ascending: false })
        .limit(clampLimit(input.limit));

      if (ctx.clientId) query = query.eq('client_id', ctx.clientId);
      if (typeof input.status === 'string' && input.status.trim()) {
        query = query.eq('status', input.status.trim());
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  },
];

/** Tool definitions in the shape the Messages API expects (no `run`). */
export function toolDefinitions(): Array<{
  name: string;
  description: string;
  input_schema: AssistantTool['input_schema'];
}> {
  return ASSISTANT_TOOLS.map(({ name, description, input_schema }) => ({
    name,
    description,
    input_schema,
  }));
}

/**
 * Execute one tool call. A thrown tool is reported back to the model as an
 * error result rather than aborting the turn — the model can then try a
 * different approach or tell the user plainly that the data is unavailable.
 */
export async function runTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<{ result: unknown; isError: boolean }> {
  const tool = ASSISTANT_TOOLS.find((t) => t.name === name);
  if (!tool) return { result: `Unknown tool "${name}".`, isError: true };

  try {
    return { result: await tool.run(input, ctx), isError: false };
  } catch (err) {
    logger.warn({ err, tool: name }, 'Assistant tool failed');
    return { result: `That lookup failed: ${(err as Error).message}`, isError: true };
  }
}
