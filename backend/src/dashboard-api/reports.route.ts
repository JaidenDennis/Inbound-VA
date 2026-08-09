import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../db/index.js';
import { requirePermission, assertClientAccess, isPlatformUser } from '../middleware/index.js';
import { callRecordService, auditTranscriptView } from '../services/index.js';
import type { JwtPayload } from '../types/index.js';

/**
 * Client-facing reporting.
 *
 * Two rules hold across every route here:
 *  - the tenant comes from the JWT for client users; staff must name one,
 *  - `recording_url` is never selected on a client path. The call log reads the
 *    `client_call_log` view, which does not contain the column at all, so a
 *    future `SELECT *` cannot leak call audio to a client.
 */

const rangeSchema = z.object({
  clientId: z.string().uuid().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  bucket: z.enum(['day', 'week']).optional(),
});

const logSchema = rangeSchema.extend({
  outcome: z.string().optional(),
  q: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const THIRTY_ONE_DAYS_MS = 31 * 24 * 60 * 60 * 1000;

function defaultRange(from?: string, to?: string) {
  const toIso = to ?? new Date().toISOString();
  const fromIso = from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  return { from: fromIso, to: toIso };
}

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Tenant for this request.
   *
   * Three outcomes, kept distinct: a named tenant the caller may see, the
   * platform-wide view (`clientId: null`, staff only), or a refusal. The old
   * version returned null for both "estate view" and "forbidden", which is why
   * staff pages got a 400 instead of data.
   */
  function scopeFor(
    user: JwtPayload,
    requested?: string
  ): { ok: true; clientId: string | null } | { ok: false } {
    const clientId = user.clientId ?? requested ?? null;
    if (!clientId) {
      return isPlatformUser(user) ? { ok: true, clientId: null } : { ok: false };
    }
    return assertClientAccess(user, clientId) ? { ok: true, clientId } : { ok: false };
  }

  app.get('/reports/kpis', {
    preHandler: requirePermission('analytics:read'),
    handler: async (request, reply) => {
      const q = rangeSchema.parse(request.query);
      const scope = scopeFor(request.user as JwtPayload, q.clientId);
      if (!scope.ok) return reply.code(403).send({ error: 'Forbidden' });

      const { from, to } = defaultRange(q.from, q.to);
      const stats = await callRecordService.getStats(scope.clientId, from, to);
      reply.send({ period: { from, to }, ...stats });
    },
  });

  app.get('/reports/volume', {
    preHandler: requirePermission('analytics:read'),
    handler: async (request, reply) => {
      const q = rangeSchema.parse(request.query);
      const scope = scopeFor(request.user as JwtPayload, q.clientId);
      if (!scope.ok) return reply.code(403).send({ error: 'Forbidden' });

      const { from, to } = defaultRange(q.from, q.to);
      // Daily buckets stop being readable past about a month of bars, so a
      // longer range rolls up to weeks unless the caller insists otherwise.
      const span = new Date(to).getTime() - new Date(from).getTime();
      const bucket = q.bucket ?? (span > THIRTY_ONE_DAYS_MS ? 'week' : 'day');

      const data = await callRecordService.getVolume(scope.clientId, from, to, bucket);
      reply.send({ period: { from, to }, bucket, data });
    },
  });

  app.get('/reports/outcomes', {
    preHandler: requirePermission('analytics:read'),
    handler: async (request, reply) => {
      const q = rangeSchema.parse(request.query);
      const scope = scopeFor(request.user as JwtPayload, q.clientId);
      if (!scope.ok) return reply.code(403).send({ error: 'Forbidden' });

      const { from, to } = defaultRange(q.from, q.to);
      const data = await callRecordService.getOutcomes(scope.clientId, from, to);
      reply.send({ period: { from, to }, data });
    },
  });

  /**
   * Call log. Paginated by cursor on started_at rather than offset — offset
   * pagination drifts as new calls land while someone is browsing.
   */
  app.get('/reports/calls', {
    preHandler: requirePermission('calls:read'),
    handler: async (request, reply) => {
      const q = logSchema.parse(request.query);
      const scope = scopeFor(request.user as JwtPayload, q.clientId);
      if (!scope.ok) return reply.code(403).send({ error: 'Forbidden' });

      const { from, to } = defaultRange(q.from, q.to);

      let query = supabase
        .from('client_call_log')
        .select('*')
        .gte('started_at', from)
        .lte('started_at', to)
        .order('started_at', { ascending: false })
        .limit(q.limit + 1); // one extra row tells us whether more exist

      // Applied after the range so the estate view (clientId null) simply omits
      // the tenant predicate rather than filtering on a null.
      if (scope.clientId) query = query.eq('client_id', scope.clientId);
      if (q.cursor) query = query.lt('started_at', q.cursor);
      if (q.outcome) query = query.eq('outcome', q.outcome);
      if (q.q) query = query.ilike('from_number', `%${q.q}%`);

      const { data, error } = await query;
      if (error) return reply.code(500).send({ error: error.message });

      const rows = data ?? [];
      const hasMore = rows.length > q.limit;
      const page = hasMore ? rows.slice(0, q.limit) : rows;
      const nextCursor = hasMore ? (page.at(-1) as { started_at: string }).started_at : null;

      reply.send({ data: page, nextCursor, period: { from, to } });
    },
  });

  app.get<{ Params: { id: string } }>('/reports/calls/:id', {
    preHandler: requirePermission('calls:read'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const { data } = await supabase
        .from('client_call_log')
        .select('*')
        .eq('id', request.params.id)
        .maybeSingle();
      if (!data) return reply.code(404).send({ error: 'Not found' });

      const row = data as { client_id: string; call_id: string | null };
      if (!assertClientAccess(user, row.client_id)) return reply.code(403).send({ error: 'Forbidden' });

      // Summary is client-safe; the recording is not, and lives on the staff
      // call detail page behind recordings:read.
      const { data: summary } = row.call_id
        ? await supabase
            .from('call_summaries')
            .select('summary')
            .eq('call_id', row.call_id)
            .maybeSingle()
        : { data: null };

      reply.send({ ...data, summary: (summary as { summary: string } | null)?.summary ?? null });
    },
  });

  /**
   * Transcript. Separate permission from the call log: transcripts contain
   * caller PII — names, numbers, sometimes health or financial detail — so
   * client_viewer can see that a call happened but not read what was said.
   */
  app.get<{ Params: { id: string } }>('/reports/calls/:id/transcript', {
    preHandler: requirePermission('transcripts:read'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const { data: logRow } = await supabase
        .from('client_call_log')
        .select('client_id, call_id')
        .eq('id', request.params.id)
        .maybeSingle();
      if (!logRow) return reply.code(404).send({ error: 'Not found' });

      const row = logRow as { client_id: string; call_id: string | null };
      if (!assertClientAccess(user, row.client_id)) return reply.code(403).send({ error: 'Forbidden' });
      if (!row.call_id) return reply.code(404).send({ error: 'No transcript for this call' });

      const { data } = await supabase
        .from('call_transcripts')
        .select('id, transcript, word_count, created_at')
        .eq('call_id', row.call_id)
        .maybeSingle();
      if (!data) return reply.code(404).send({ error: 'No transcript for this call' });

      // The access record §2.5 asks for: one row per transcript opened, written
      // before the content leaves the building. Individual reads only — the call
      // log itself is not audited, or the trail would be all noise.
      await auditTranscriptView(
        { userId: user.sub, clientId: row.client_id, ipAddress: request.ip, userAgent: request.headers['user-agent'] },
        (data as { id: string }).id,
        row.call_id
      );

      reply.send(data);
    },
  });

  /**
   * Call recording. Platform staff only, for troubleshooting — `recordings:read`
   * is granted to no client role, and this is the only route that reads the
   * column at all.
   */
  app.get<{ Params: { id: string } }>('/reports/calls/:id/recording', {
    preHandler: requirePermission('recordings:read'),
    handler: async (request, reply) => {
      const { data: logRow } = await supabase
        .from('client_call_log')
        .select('call_id')
        .eq('id', request.params.id)
        .maybeSingle();
      const callId = (logRow as { call_id: string | null } | null)?.call_id;
      if (!callId) return reply.code(404).send({ error: 'Not found' });

      const { data } = await supabase
        .from('calls')
        .select('recording_url')
        .eq('id', callId)
        .maybeSingle();
      const url = (data as { recording_url: string | null } | null)?.recording_url;
      if (!url) return reply.code(404).send({ error: 'No recording for this call' });

      reply.send({ recordingUrl: url });
    },
  });
}
