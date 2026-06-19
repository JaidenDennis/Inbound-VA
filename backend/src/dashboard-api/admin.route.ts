import type { FastifyInstance } from 'fastify';
import { supabase } from '../db/index.js';
import { allQueues } from '../queues/index.js';
import { requirePermission, assertClientAccess, isPlatformUser } from '../middleware/index.js';
import { callService } from '../services/index.js';
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
      // Client-scoped users are locked to their own tenant.
      const clientId = user.clientId ?? request.query.clientId;
      if (!clientId) return reply.code(400).send({ error: 'clientId required' });
      if (!assertClientAccess(user, clientId)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const result = await callService.list(clientId, Number(request.query.page ?? 1));
      reply.send(result);
    },
  });

  // Call detail with transcript + summary — tenant-checked
  app.get<{ Params: { id: string } }>('/admin/calls/:id', {
    preHandler: requirePermission('calls:read'),
    handler: async (request, reply) => {
      const { data: call } = await supabase.from('calls').select('*').eq('id', request.params.id).maybeSingle();
      if (!call) return reply.code(404).send({ error: 'Not found' });
      if (!assertClientAccess(request.user as JwtPayload, call.client_id)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      const [transcript, summary, conversation] = await Promise.all([
        callService.getTranscript(call.id),
        callService.getSummary(call.id),
        supabase.from('conversations').select('*').eq('call_id', call.id).maybeSingle().then(r => r.data),
      ]);

      reply.send({ call, transcript, summary, conversation });
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
