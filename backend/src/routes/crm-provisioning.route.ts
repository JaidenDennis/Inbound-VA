import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../db/index.js';
import { crmSyncQueue } from '../queues/index.js';
import { activeGhlConnection } from '../crm/ghl-connection.js';
import { defaultBlueprints } from '../crm/blueprints/index.js';
import {
  initialProvisionSteps,
  persistProvisionRun,
} from '../crm/ghl-provisioning.service.js';
import { clientService, writeAuditLog } from '../services/index.js';
import { requirePermission, assertClientAccess } from '../middleware/index.js';
import { buildIdempotencyKey } from '../utils/index.js';
import { ghlBlueprintSchema } from '../types/index.js';
import type { GhlBlueprint, JwtPayload } from '../types/index.js';

// GHL blueprint provisioning: enqueue a run (worker applies it) and read a
// run's per-step status. The blueprint applied is, in precedence order:
// inline object in the request → named shipped default → the client's
// client_settings.ghl_blueprint → the 'client-inbound' shipped default.

const provisionBodySchema = z.object({
  clientId: z.string().uuid(),
  blueprint: z.union([z.string().min(1), ghlBlueprintSchema]).optional(),
});

async function resolveBlueprint(
  clientId: string,
  requested: string | GhlBlueprint | undefined
): Promise<{ blueprint: GhlBlueprint } | { error: string; details?: unknown }> {
  if (requested !== undefined && typeof requested !== 'string') {
    return { blueprint: requested }; // inline — already schema-validated by the body parse
  }
  if (typeof requested === 'string') {
    const named = defaultBlueprints[requested];
    if (!named) {
      return {
        error: `Unknown blueprint "${requested}" — available: ${Object.keys(defaultBlueprints).join(', ')}`,
      };
    }
    return { blueprint: named };
  }
  const settings = await clientService.getSettings(clientId);
  if (settings?.ghl_blueprint) {
    // Stored JSON may predate schema changes — never enqueue an invalid one.
    const parsed = ghlBlueprintSchema.safeParse(settings.ghl_blueprint);
    if (!parsed.success) {
      return {
        error: 'client_settings.ghl_blueprint is invalid — fix or clear it',
        details: parsed.error.flatten(),
      };
    }
    return { blueprint: parsed.data };
  }
  return { blueprint: defaultBlueprints['client-inbound'] };
}

export async function crmProvisioningRoutes(app: FastifyInstance): Promise<void> {
  app.post('/crm/ghl/provision', {
    preHandler: requirePermission('crm:write'),
    handler: async (request, reply) => {
      const body = provisionBodySchema.parse(request.body);
      const user = request.user as JwtPayload;
      if (!assertClientAccess(user, body.clientId)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      const resolved = await resolveBlueprint(body.clientId, body.blueprint);
      if ('error' in resolved) {
        return reply.code(400).send({ error: resolved.error, details: resolved.details });
      }
      const { blueprint } = resolved;

      const conn = await activeGhlConnection(body.clientId);
      if (!conn) {
        return reply.code(404).send({ error: 'No active GoHighLevel connection' });
      }
      if (conn.needs_reauth) {
        return reply.code(409).send({
          error: 'Connection needs re-authorization — re-run the GHL install first',
        });
      }

      // One run at a time per connection: the check-then-create steps inside a
      // run are not safe against a concurrent run on the same location.
      const { data: pending } = await supabase
        .from('crm_sync_logs')
        .select('entity_id')
        .eq('crm_connection_id', conn.id)
        .eq('entity_type', 'provision_run')
        .eq('operation', 'provision')
        .eq('status', 'pending')
        .limit(1)
        .maybeSingle();
      if (pending) {
        return reply.code(409).send({
          error: 'A provision run is already in progress for this connection',
          runId: pending.entity_id,
        });
      }

      const runId = uuidv4();
      // Insert the run row before enqueueing so GET works immediately.
      await persistProvisionRun(
        {
          runId,
          clientId: body.clientId,
          crmConnectionId: conn.id,
          blueprintName: blueprint.name,
          status: 'pending',
          steps: initialProvisionSteps(),
        },
        { attempts: 0 }
      );

      await crmSyncQueue.add(
        'provision',
        {
          kind: 'provision',
          clientId: body.clientId,
          crmConnectionId: conn.id,
          runId,
          blueprintName: blueprint.name,
          blueprint,
          idempotencyKey: buildIdempotencyKey('ghl-provision', conn.id, runId),
        },
        // runId inside the jobId: BullMQ dedupes by jobId even against
        // completed jobs, so a connection-only key would swallow re-runs.
        { jobId: buildIdempotencyKey('ghl-provision', conn.id, runId) }
      );

      await writeAuditLog({
        userId: user.sub,
        clientId: body.clientId,
        action: 'crm.provision.requested',
        entityType: 'provision_run',
        entityId: runId,
        newValue: { blueprintName: blueprint.name },
      });

      reply.code(202).send({ runId });
    },
  });

  app.get<{ Params: { runId: string } }>('/crm/ghl/provision/:runId', {
    preHandler: requirePermission('crm:read'),
    handler: async (request, reply) => {
      const { runId } = z.object({ runId: z.string().uuid() }).parse(request.params);

      const { data: row } = await supabase
        .from('crm_sync_logs')
        .select('*')
        .eq('entity_type', 'provision_run')
        .eq('entity_id', runId)
        .eq('operation', 'provision')
        .maybeSingle();
      if (!row) return reply.code(404).send({ error: 'Run not found' });
      if (!assertClientAccess(request.user as JwtPayload, row.client_id)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      const payload = (row.payload ?? {}) as { blueprintName?: string; steps?: unknown[] };
      reply.send({
        runId,
        clientId: row.client_id,
        status: row.status,
        blueprintName: payload.blueprintName ?? null,
        steps: payload.steps ?? [],
        attempts: row.attempts,
        errorMessage: row.error_message,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
    },
  });
}
