import type { FastifyInstance } from 'fastify';
import { supabase } from '../db/index.js';
import { allQueues } from '../queues/index.js';
import { requirePermission, assertClientAccess, isPlatformUser, resolveClientScope } from '../middleware/index.js';
import { callService, auditTranscriptView } from '../services/index.js';
import type { JwtPayload } from '../types/index.js';

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  // Retry a failed job — platform-level only (jobs span all tenants)
  app.post<{ Body: { jobId: string; queueName: string } }>('/admin/retry-job', {
    preHandler: requirePermission('settings:write'),
    handler: async (request, reply) => {
      if (!isPlatformUser(request.user as JwtPayload)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const { jobId, queueName } = request.body;
      const queue = allQueues.find((q) => q.name === queueName);
      if (!queue) return reply.code(404).send({ error: 'Queue not found' });

      const job = await queue.getJob(jobId);
      if (!job) return reply.code(404).send({ error: 'Job not found' });

      await job.retry();
      await supabase.from('failed_jobs').update({ status: 'resolved' }).eq('job_id', jobId);

      reply.send({ retried: true, jobId });
    },
  });

  // Failed jobs list — platform-level only
  app.get('/admin/failed-jobs', {
    preHandler: requirePermission('settings:read'),
    handler: async (request, reply) => {
      if (!isPlatformUser(request.user as JwtPayload)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const { data } = await supabase
        .from('failed_jobs')
        .select('*')
        .in('status', ['failed', 'manual_review'])
        .order('created_at', { ascending: false })
        .limit(100);
      reply.send(data ?? []);
    },
  });

  // Calls list (searchable) — scoped to tenant
  app.get<{ Querystring: { clientId?: string; q?: string; page?: string } }>('/admin/calls', {
    preHandler: requirePermission('calls:read'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      // Client-scoped users are locked to their own tenant. Platform staff get
      // every tenant unless they name one — this page is their whole-estate
      // view, and demanding a clientId here is what made it render empty.
      const clientId = resolveClientScope(user, request.query.clientId);
      if (clientId && !assertClientAccess(user, clientId)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      if (!clientId && !isPlatformUser(user)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const result = await callService.list(clientId, Number(request.query.page ?? 1), 20, request.query.q);
      reply.send(result);
    },
  });

  /**
   * Call detail — tenant-checked, and split on `transcripts:read`.
   *
   * The transcript and summary are withheld from a caller who only holds
   * `calls:read`. This route used to return both on `calls:read` alone, which
   * quietly handed every transcript to `client_viewer` — the one client role
   * deliberately denied `transcripts:read` (migration 016), and the boundary
   * `/reports/calls/:id/transcript` enforces two files away. Same data, two
   * routes, two different answers; this one was wrong.
   *
   * The call metadata stays available to `calls:read`, so the read-only
   * compliance role can still see that a call happened, its duration and its
   * outcome — just not what was said, which is exactly the split the role exists
   * to express.
   */
  app.get<{ Params: { id: string } }>('/admin/calls/:id', {
    preHandler: requirePermission('calls:read'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const { data: call } = await supabase.from('calls').select('*').eq('id', request.params.id).maybeSingle();
      if (!call) return reply.code(404).send({ error: 'Not found' });
      if (!assertClientAccess(user, call.client_id)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      const mayReadTranscript = request.jwtPermissions?.has('transcripts:read') ?? false;

      const [transcript, summary, conversation] = await Promise.all([
        mayReadTranscript ? callService.getTranscript(call.id) : Promise.resolve(null),
        mayReadTranscript ? callService.getSummary(call.id) : Promise.resolve(null),
        supabase.from('conversations').select('*').eq('call_id', call.id).maybeSingle().then(r => r.data),
      ]);

      // One row per transcript actually opened — the access record §2.5 asks
      // for. Not written when the transcript was withheld, because nothing was
      // disclosed.
      if (mayReadTranscript && transcript) {
        await auditTranscriptView(
          { userId: user.sub, clientId: call.client_id, ipAddress: request.ip, userAgent: request.headers['user-agent'] },
          (transcript as { id?: string }).id ?? call.id,
          call.id
        );
      }

      reply.send({
        call,
        transcript,
        summary,
        conversation,
        // Stated rather than silently absent: a UI showing an empty transcript
        // pane cannot otherwise tell "no transcript exists" from "you may not
        // read it", and would render the wrong empty state for both.
        ...(mayReadTranscript ? {} : { transcriptWithheld: 'Requires the transcripts:read permission.' }),
      });
    },
  });

  // Plugin registry info — platform metadata, any authenticated settings reader
  app.get('/admin/plugins', {
    preHandler: requirePermission('settings:read'),
    handler: async (_request, reply) => {
      const { crmRegistry } = await import('../crm/crm-registry.js');
      const { calendarRegistry } = await import('../calendar/calendar-registry.js');
      reply.send({
        crm: crmRegistry.manifests(),
        calendar: calendarRegistry.manifests(),
      });
    },
  });

  // Audit logs — scoped to tenant
  app.get<{ Querystring: { clientId?: string; page?: string } }>('/admin/audit-logs', {
    preHandler: requirePermission('settings:read'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const clientId = user.clientId ?? request.query.clientId;
      if (user.clientId && !assertClientAccess(user, clientId)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const from = (Number(request.query.page ?? 1) - 1) * 50;
      let query = supabase.from('audit_logs').select('*', { count: 'exact' }).order('created_at', { ascending: false }).range(from, from + 49);
      if (clientId) query = query.eq('client_id', clientId);
      const { data, count } = await query;
      reply.send({ data: data ?? [], count: count ?? 0 });
    },
  });
}
