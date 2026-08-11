import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../db/index.js';
import { requirePlatform } from '../middleware/index.js';
import { systemErrorService, writeAuditLog } from '../services/index.js';
import { allQueues } from '../queues/index.js';
import type { JwtPayload } from '../types/index.js';

const listQuerySchema = z.object({
  kind: z.string().optional(),
  source: z.enum(['api', 'worker', 'webhook', 'startup']).optional(),
  severity: z.enum(['warn', 'error', 'fatal']).optional(),
  clientId: z.string().uuid().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  reviewed: z.enum(['true', 'false']).optional(),
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const reviewGroupSchema = z.object({
  fingerprint: z.string().min(1),
});

/**
 * Every queue, keyed by name, derived from the single registry in queues/.
 *
 * Previously this was a hand-written subset, which silently omitted
 * `agent-provisioning` and `maintenance` — so the console under-reported queue
 * depth and, worse, refused to retry a failed agent publish with "Unknown
 * queue". Deriving it means a queue added in queues.ts cannot be forgotten here.
 */
const QUEUES_BY_NAME: Record<string, (typeof allQueues)[number]> = Object.fromEntries(
  allQueues.map((q) => [q.name, q])
);

/**
 * The system console. Platform-only, in both senses: `system:read` is granted to
 * no client role, and `requirePlatform` additionally refuses any tenant-scoped
 * user. Two gates because this is the one surface that reads across every
 * tenant's data at once.
 */
export async function systemRoutes(app: FastifyInstance): Promise<void> {
  app.get('/system/activity', {
    preHandler: requirePlatform('system:read'),
    handler: async (request, reply) => {
      const q = listQuerySchema.parse(request.query);
      const offset = (q.page - 1) * q.limit;

      let query = supabase
        .from('system_activity')
        .select('*', { count: 'exact' })
        .order('occurred_at', { ascending: false })
        .range(offset, offset + q.limit - 1);

      if (q.kind) query = query.eq('kind', q.kind);
      if (q.source) query = query.eq('source', q.source);
      if (q.severity) query = query.eq('severity', q.severity);
      if (q.clientId) query = query.eq('client_id', q.clientId);
      if (q.from) query = query.gte('occurred_at', q.from);
      if (q.to) query = query.lte('occurred_at', q.to);
      if (q.reviewed === 'true') query = query.not('reviewed_at', 'is', null);
      if (q.reviewed === 'false') query = query.is('reviewed_at', null);
      if (q.q) query = query.or(`title.ilike.%${q.q}%,detail.ilike.%${q.q}%`);

      const { data, count, error } = await query;
      if (error) return reply.code(500).send({ error: error.message });
      reply.send({ data: data ?? [], count: count ?? 0, page: q.page, limit: q.limit });
    },
  });

  /**
   * Occurrence counts per fingerprint. One outage is one row here, which is the
   * view staff actually want first — the flat list is for drilling in.
   */
  app.get('/system/activity/grouped', {
    preHandler: requirePlatform('system:read'),
    handler: async (request, reply) => {
      const q = listQuerySchema.parse(request.query);
      const since = q.from ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      let query = supabase
        .from('system_errors')
        .select('fingerprint, error_name, message, route, source, severity, client_id, occurred_at, ticket_id, sentry_event_id')
        .gte('occurred_at', since)
        .order('occurred_at', { ascending: false })
        .limit(2000);
      if (q.clientId) query = query.eq('client_id', q.clientId);
      if (q.source) query = query.eq('source', q.source);
      if (q.severity) query = query.eq('severity', q.severity);

      const { data, error } = await query;
      if (error) return reply.code(500).send({ error: error.message });

      type Row = {
        fingerprint: string; error_name: string; message: string; route: string | null;
        source: string; severity: string; client_id: string | null; occurred_at: string;
        ticket_id: string | null; sentry_event_id: string | null;
      };
      const groups = new Map<string, {
        fingerprint: string; errorName: string; message: string; route: string | null;
        source: string; severity: string; clientIds: Set<string>; count: number;
        firstSeen: string; lastSeen: string; ticketId: string | null; latestSentryEventId: string | null;
      }>();

      for (const row of (data ?? []) as Row[]) {
        const existing = groups.get(row.fingerprint);
        if (existing) {
          existing.count += 1;
          if (row.occurred_at < existing.firstSeen) existing.firstSeen = row.occurred_at;
          if (row.occurred_at > existing.lastSeen) {
            existing.lastSeen = row.occurred_at;
            existing.latestSentryEventId = row.sentry_event_id;
          }
          if (row.client_id) existing.clientIds.add(row.client_id);
          existing.ticketId ??= row.ticket_id;
        } else {
          groups.set(row.fingerprint, {
            fingerprint: row.fingerprint,
            errorName: row.error_name,
            message: row.message,
            route: row.route,
            source: row.source,
            severity: row.severity,
            clientIds: new Set(row.client_id ? [row.client_id] : []),
            count: 1,
            firstSeen: row.occurred_at,
            lastSeen: row.occurred_at,
            ticketId: row.ticket_id,
            latestSentryEventId: row.sentry_event_id,
          });
        }
      }

      const result = [...groups.values()]
        .map((g) => ({ ...g, clientIds: [...g.clientIds] }))
        .sort((a, b) => b.count - a.count);

      reply.send({ data: result, since });
    },
  });

  app.get<{ Params: { id: string } }>('/system/errors/:id', {
    preHandler: requirePlatform('system:read'),
    handler: async (request, reply) => {
      const { data } = await supabase
        .from('system_errors')
        .select('*')
        .eq('id', request.params.id)
        .maybeSingle();
      if (!data) return reply.code(404).send({ error: 'Not found' });
      reply.send(data);
    },
  });

  app.post<{ Params: { id: string } }>('/system/errors/:id/review', {
    preHandler: requirePlatform('system:write'),
    handler: async (request, reply) => {
      const actor = request.user as JwtPayload;
      await systemErrorService.markReviewed(request.params.id, actor.sub);
      await writeAuditLog({
        userId: actor.sub,
        action: 'system.error.reviewed',
        entityType: 'system_error',
        entityId: request.params.id,
        ipAddress: request.ip,
      });
      reply.send({ ok: true });
    },
  });

  /**
   * Clear a whole fingerprint group in one decision.
   *
   * One audit entry is written for the group, recording how many rows changed,
   * rather than one entry per row — the operator made a single judgement and the
   * trail should read that way.
   */
  app.post<{ Body: { fingerprint: string } }>('/system/errors/review-group', {
    preHandler: requirePlatform('system:write'),
    handler: async (request, reply) => {
      const parsed = reviewGroupSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'A fingerprint is required' });
      }

      const actor = request.user as JwtPayload;
      const reviewed = await systemErrorService.markFingerprintReviewed(
        parsed.data.fingerprint,
        actor.sub
      );

      if (reviewed === 0) {
        return reply.code(409).send({ error: 'Every error in this group was already reviewed' });
      }

      await writeAuditLog({
        userId: actor.sub,
        action: 'system.error.group_reviewed',
        entityType: 'system_error_group',
        entityId: parsed.data.fingerprint,
        newValue: { reviewed_count: reviewed },
        ipAddress: request.ip,
      });

      reply.send({ ok: true, reviewed });
    },
  });

  /**
   * Re-enqueue a failed job from its recorded payload.
   *
   * The original BullMQ job is long gone by the time it reaches failed_jobs, so
   * this creates a new one with the same data rather than resuming the old one.
   */
  app.post<{ Params: { id: string } }>('/system/retry/:id', {
    preHandler: requirePlatform('system:write'),
    handler: async (request, reply) => {
      const actor = request.user as JwtPayload;
      const { data: failed } = await supabase
        .from('failed_jobs')
        .select('*')
        .eq('id', request.params.id)
        .maybeSingle();
      if (!failed) return reply.code(404).send({ error: 'Not found' });

      const row = failed as { id: string; queue_name: string; job_data: Record<string, unknown>; status: string };
      if (row.status === 'resolved') {
        return reply.code(409).send({ error: 'This job was already resolved' });
      }

      const queue = QUEUES_BY_NAME[row.queue_name];
      if (!queue) {
        return reply.code(400).send({ error: `Unknown queue: ${row.queue_name}` });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- payload shape is per-queue and already validated by the worker
      const job = await queue.add('retry', row.job_data as any);
      await supabase
        .from('failed_jobs')
        .update({ status: 'resolved', updated_at: new Date().toISOString() })
        .eq('id', row.id);

      await writeAuditLog({
        userId: actor.sub,
        action: 'system.job.retried',
        entityType: 'failed_job',
        entityId: row.id,
        newValue: { queue: row.queue_name, newJobId: job.id },
        ipAddress: request.ip,
      });

      reply.send({ ok: true, jobId: job.id });
    },
  });

  /** Queue depths — the fastest signal that something is backing up. */
  app.get('/system/queues', {
    preHandler: requirePlatform('system:read'),
    handler: async (_request, reply) => {
      const counts = await Promise.all(
        Object.entries(QUEUES_BY_NAME).map(async ([name, queue]) => ({
          name,
          ...(await queue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed')),
        }))
      );
      reply.send({ data: counts });
    },
  });

  /** Audit trail. Same gate as the console: cross-tenant by nature. */
  app.get('/system/audit', {
    preHandler: requirePlatform('system:read'),
    handler: async (request, reply) => {
      const q = listQuerySchema.parse(request.query);
      const offset = (q.page - 1) * q.limit;

      let query = supabase
        .from('audit_logs')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + q.limit - 1);
      if (q.clientId) query = query.eq('client_id', q.clientId);
      if (q.from) query = query.gte('created_at', q.from);
      if (q.to) query = query.lte('created_at', q.to);
      if (q.q) query = query.ilike('action', `%${q.q}%`);

      const { data, count, error } = await query;
      if (error) return reply.code(500).send({ error: error.message });
      reply.send({ data: data ?? [], count: count ?? 0, page: q.page, limit: q.limit });
    },
  });
}
