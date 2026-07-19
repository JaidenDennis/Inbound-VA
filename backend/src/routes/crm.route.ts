import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../db/index.js';
import { crmSyncQueue } from '../queues/index.js';
import { getCrmAdapter, resolveAdapterConfig } from '../crm/index.js';
import { encrypt } from '../utils/index.js';
import { requirePermission, assertClientAccess } from '../middleware/index.js';
import { buildIdempotencyKey } from '../utils/index.js';
import type { JwtPayload } from '../types/index.js';

const connectSchema = z.object({
  clientId: z.string().uuid(),
  crmType: z.string(),
  credentials: z.record(z.unknown()),
  pipelineId: z.string().optional(),
  stageMaping: z.record(z.string()).optional(),
  customFieldMapping: z.record(z.string()).optional(),
});

const syncSchema = z.object({
  clientId: z.string().uuid(),
  entityType: z.enum(['contact', 'lead', 'appointment', 'transcript', 'summary']),
  entityId: z.string(),
  operation: z.enum(['create', 'update', 'delete']),
  payload: z.record(z.unknown()),
});

export async function crmRoutes(app: FastifyInstance): Promise<void> {
  app.post('/crm/connect', {
    preHandler: requirePermission('crm:write'),
    handler: async (request, reply) => {
      const body = connectSchema.parse(request.body);
      if (!assertClientAccess(request.user as JwtPayload, body.clientId)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      // GoHighLevel connects via the marketplace OAuth flow, not raw credentials.
      if (body.crmType === 'gohighlevel') {
        return reply.code(422).send({
          error: 'GoHighLevel uses OAuth — start from GET /crm/gohighlevel/oauth/install',
        });
      }
      const credentialsEncrypted = encrypt(JSON.stringify(body.credentials));

      const { data, error } = await supabase
        .from('crm_connections')
        .upsert({
          client_id: body.clientId,
          crm_type: body.crmType,
          credentials_encrypted: credentialsEncrypted,
          pipeline_id: body.pipelineId ?? null,
          stage_mapping: body.stageMaping ?? {},
          custom_field_mapping: body.customFieldMapping ?? {},
          is_active: true,
        }, { onConflict: 'client_id,crm_type' })
        .select()
        .single();

      if (error) return reply.code(500).send({ error: error.message });

      // Test connection
      const adapter = getCrmAdapter(body.crmType, await resolveAdapterConfig(data));
      const ok = await adapter.testConnection();
      if (!ok) return reply.code(422).send({ error: 'CRM connection test failed' });

      reply.code(201).send({ id: data.id, crm_type: data.crm_type, is_active: true });
    },
  });

  app.post('/crm/sync', {
    preHandler: requirePermission('crm:write'),
    handler: async (request, reply) => {
      const body = syncSchema.parse(request.body);
      if (!assertClientAccess(request.user as JwtPayload, body.clientId)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      const { data: conn } = await supabase
        .from('crm_connections')
        .select('id')
        .eq('client_id', body.clientId)
        .eq('is_active', true)
        .maybeSingle();

      if (!conn) return reply.code(404).send({ error: 'No active CRM connection' });

      const jobId = buildIdempotencyKey('manual-crm-sync', body.entityType, body.entityId);
      await crmSyncQueue.add('manual-sync', {
        clientId: body.clientId,
        crmConnectionId: conn.id,
        entityType: body.entityType,
        entityId: body.entityId,
        operation: body.operation,
        payload: body.payload,
        idempotencyKey: jobId,
      }, { jobId });

      reply.send({ queued: true, jobId });
    },
  });

  app.get<{ Params: { clientId: string } }>('/crm/:clientId/logs', {
    preHandler: requirePermission('crm:read'),
    handler: async (request, reply) => {
      if (!assertClientAccess(request.user as JwtPayload, request.params.clientId)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const { data } = await supabase
        .from('crm_sync_logs')
        .select('*')
        .eq('client_id', request.params.clientId)
        .order('created_at', { ascending: false })
        .limit(100);
      reply.send(data ?? []);
    },
  });
}
