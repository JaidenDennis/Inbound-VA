import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../db/index.js';
import { requirePermission, assertClientAccess, resolveClientScope } from '../middleware/index.js';
import { writeAuditLog } from '../services/index.js';
import { logger } from '../utils/index.js';
import type { JwtPayload } from '../types/index.js';

/**
 * The manager work queue (migration 025).
 *
 * The design's governing rule is enforced here structurally rather than by
 * convention: EVERY KIND MUST BE CLOSABLE. `QUEUE_KINDS` below is the single
 * list, and `closeItem` switches exhaustively over it — a new kind added to the
 * view without a close path fails to compile, and `manager-queue.test.ts`
 * iterates the same list to assert a close route exists for each.
 *
 * If a manager cannot act on it, it belongs in the owner view.
 */

export const QUEUE_KINDS = [
  'flagged_call',
  'unreturned_callback',
  'failed_booking',
  'untouched_escalation',
  'calendar_conflict',
  // Operational action items (migration 034). Onboarding-category items are
  // excluded by the view — those belong to the bounded pre-go-live sequence on
  // the Onboarding page, not to the queue a manager works every day.
  'action_item',
] as const;

export type QueueKind = (typeof QUEUE_KINDS)[number];

/** Kinds whose close state lives in their own table vs. the dismissals table. */
const DERIVED_KINDS: ReadonlySet<QueueKind> = new Set(['untouched_escalation', 'calendar_conflict']);

const kindParam = z.enum(QUEUE_KINDS as unknown as [QueueKind, ...QueueKind[]]);

const listQuery = z.object({
  kind: kindParam.optional(),
  clientId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

const closeBody = z
  .object({
    note: z.string().max(1000).optional(),
    // unreturned_callback distinguishes "we called them" from "they no longer
    // need us"; everything else has a single close meaning.
    resolution: z.enum(['completed', 'cancelled']).optional(),
  })
  .default({});

export async function queueRoutes(app: FastifyInstance): Promise<void> {
  /**
   * The queue, worst-first.
   *
   * Ordered by severity then age so it self-prioritises: the oldest broken
   * promise rises to the top without anyone sorting it.
   */
  app.get('/queue', {
    preHandler: requirePermission('flags:read'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const parsed = listQuery.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: 'Invalid query' });

      const clientId = resolveClientScope(user, parsed.data.clientId);
      if (clientId && !assertClientAccess(user, clientId)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      let q = supabase
        .from('manager_queue')
        .select('kind, id, client_id, occurred_at, title, detail, age_seconds, assignee_id, severity, ref');

      // Platform staff with no clientId get the cross-tenant view, matching the
      // system console. Client users are always pinned to their own tenant.
      if (clientId) q = q.eq('client_id', clientId);
      if (parsed.data.kind) q = q.eq('kind', parsed.data.kind);

      const { data, error } = await q
        .order('severity', { ascending: true }) // 'bad' sorts before 'fair'
        .order('age_seconds', { ascending: false })
        .limit(parsed.data.limit);

      if (error) {
        logger.error({ err: error }, 'manager queue read failed');
        return reply.code(500).send({ error: 'Failed to load queue' });
      }

      const items = (data ?? []) as Array<Record<string, unknown>>;
      reply.send({
        items,
        counts: QUEUE_KINDS.reduce<Record<string, number>>((acc, k) => {
          acc[k] = items.filter((i) => i.kind === k).length;
          return acc;
        }, {}),
      });
    },
  });

  /** Today against the same weekday last week. Context, not a second report. */
  app.get('/queue/pulse', {
    preHandler: requirePermission('analytics:read'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const clientId = resolveClientScope(user, (request.query as { clientId?: string }).clientId);
      if (!clientId) return reply.code(400).send({ error: 'clientId is required' });
      if (!assertClientAccess(user, clientId)) return reply.code(403).send({ error: 'Forbidden' });

      const { data, error } = await supabase.rpc('report_pulse', { p_client_id: clientId });
      if (error) return reply.code(500).send({ error: 'Failed to load pulse' });

      reply.send({
        data: (data ?? []).map((r: { metric: string; today: number; same_day_last_week: number }) => ({
          metric: r.metric,
          today: Number(r.today),
          sameDayLastWeek: Number(r.same_day_last_week),
          // Null rather than a percentage when last week was zero: "up from
          // nothing" has no meaningful percentage, and Infinity renders badly.
          changePercent:
            Number(r.same_day_last_week) > 0
              ? Math.round(
                  ((Number(r.today) - Number(r.same_day_last_week)) / Number(r.same_day_last_week)) * 100
                )
              : null,
        })),
      });
    },
  });

  /**
   * Close one item.
   *
   * Idempotent per kind: a double-submit from an impatient click must not write
   * twice or fail the second time. Each branch below either sets a state that is
   * already set, or upserts.
   */
  async function closeItem(
    kind: QueueKind,
    id: string,
    clientId: string,
    actorId: string,
    body: z.infer<typeof closeBody>
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    switch (kind) {
      case 'flagged_call': {
        const { error } = await supabase
          .from('call_records')
          .update({ reviewed_at: new Date().toISOString(), reviewed_by: actorId })
          .eq('id', id)
          .eq('client_id', clientId);
        return error ? { ok: false, error: error.message } : { ok: true };
      }
      case 'unreturned_callback': {
        const { error } = await supabase
          .from('callback_requests')
          .update({ status: body.resolution ?? 'completed' })
          .eq('id', id)
          .eq('client_id', clientId);
        return error ? { ok: false, error: error.message } : { ok: true };
      }
      case 'failed_booking': {
        // failed_jobs has no client_id; the tenant lives in job_data. Filtering
        // on it here is what stops one tenant resolving another's failed job.
        const { error } = await supabase
          .from('failed_jobs')
          .update({ status: 'resolved' })
          .eq('id', id)
          .eq('job_data->>clientId', clientId);
        return error ? { ok: false, error: error.message } : { ok: true };
      }
      case 'action_item': {
        // An action item owns its own state, so closing is marking it done —
        // no dismissals row, and the same transition the Onboarding page and
        // the client-facing list already use.
        const { error } = await supabase
          .from('client_action_items')
          .update({ status: 'done' })
          .eq('id', id)
          .eq('client_id', clientId);
        return error ? { ok: false, error: error.message } : { ok: true };
      }
      case 'untouched_escalation':
      case 'calendar_conflict': {
        // Derived items have no row of their own to mark, so the judgement is
        // recorded separately. Upsert keeps a repeated dismissal idempotent.
        const { error } = await supabase.from('queue_dismissals').upsert(
          {
            client_id: clientId,
            kind,
            ref_id: id,
            note: body.note ?? null,
            dismissed_by: actorId,
            dismissed_at: new Date().toISOString(),
          },
          { onConflict: 'client_id,kind,ref_id' }
        );
        return error ? { ok: false, error: error.message } : { ok: true };
      }
    }
  }

  app.post<{ Params: { kind: string; id: string }; Body: unknown }>('/queue/:kind/:id/close', {
    preHandler: requirePermission('flags:write'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const kind = kindParam.safeParse(request.params.kind);
      if (!kind.success) return reply.code(400).send({ error: 'Unknown queue kind' });

      const body = closeBody.safeParse(request.body ?? {});
      if (!body.success) return reply.code(400).send({ error: 'Invalid body' });

      // Resolve the item's tenant from the queue itself rather than trusting the
      // caller, so a client user cannot close another tenant's item by id.
      const { data: item } = await supabase
        .from('manager_queue')
        .select('client_id, title')
        .eq('kind', kind.data)
        .eq('id', request.params.id)
        .maybeSingle();

      const row = item as { client_id: string; title: string } | null;
      // Already closed, or never existed. Idempotent: a second click is a no-op,
      // not a 404 the operator has to interpret.
      if (!row) return reply.send({ closed: true, alreadyClosed: true });

      if (!assertClientAccess(user, row.client_id)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      const result = await closeItem(kind.data, request.params.id, row.client_id, user.sub, body.data);
      if (!result.ok) {
        logger.error({ kind: kind.data, id: request.params.id, err: result.error }, 'queue close failed');
        return reply.code(500).send({ error: 'Failed to close item' });
      }

      await writeAuditLog({
        userId: user.sub,
        clientId: row.client_id,
        action: DERIVED_KINDS.has(kind.data) ? 'queue.dismiss' : 'queue.close',
        entityType: `manager_queue:${kind.data}`,
        entityId: /^[0-9a-f-]{36}$/i.test(request.params.id) ? request.params.id : undefined,
        newValue: { kind: kind.data, title: row.title, ...body.data },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      reply.send({ closed: true, alreadyClosed: false });
    },
  });
}
