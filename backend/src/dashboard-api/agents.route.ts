import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../db/index.js';
import { requirePlatform } from '../middleware/index.js';
import { clientService, agentSyncService, provisioningService, withAudit } from '../services/index.js';
import { listVerticals } from '../providers/retell/templates/index.js';
import type { JwtPayload } from '../types/index.js';

/**
 * Agent behaviour: what the agent *is*, as opposed to what it knows.
 *
 * Platform-only. Prompt wording, routing, voice and phone mapping decide whether
 * calls work at all, so a client cannot reach them — and the rendered prompt is
 * our own IP, which is why even reading it needs a platform role.
 */

const businessHoursSchema = z.object({
  tz: z.string().min(1),
  weekly: z
    .array(
      z.object({
        day: z.number().int().min(0).max(6),
        open: z.string().regex(/^\d{2}:\d{2}$/),
        close: z.string().regex(/^\d{2}:\d{2}$/),
        closed: z.boolean().default(false),
      })
    )
    .max(7),
  exceptions: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        open: z.string().regex(/^\d{2}:\d{2}$/).optional(),
        close: z.string().regex(/^\d{2}:\d{2}$/).optional(),
        closed: z.boolean().default(false),
      })
    )
    .default([]),
});

const updateAgentSchema = z.object({
  business_name: z.string().min(1).max(200).optional(),
  agent_name: z.string().min(1).max(100).optional(),
  agent_personality: z.string().max(100).optional(),
  agent_tone: z.string().max(100).optional(),
  agent_response_style: z.string().max(100).optional(),
  agent_config: z.record(z.string(), z.unknown()).optional(),
  prompt_overrides: z.record(z.string(), z.string()).optional(),
  booking_enabled: z.boolean().optional(),
  booking_rules: z.record(z.string(), z.unknown()).optional(),
  business_hours: businessHoursSchema.optional(),
  escalation_rules: z.array(z.unknown()).optional(),
  notification_emails: z.array(z.string().email()).optional(),
  voice_id: z.string().max(200).optional(),
  template: z.string().max(100).optional(),
  phone_numbers: z.array(z.string()).optional(),
});

export async function agentRoutes(app: FastifyInstance): Promise<void> {
  /** One row per client with its sync state — the staff "Agents" list. */
  app.get('/agents', {
    preHandler: requirePlatform('agents:read'),
    handler: async (_request, reply) => {
      const { data, error } = await supabase
        .from('clients')
        // `status`, not `is_active` — that column is on `users`. Supabase select
        // strings are not type-checked, so this only surfaces at runtime.
        .select(
          'id, name, industry, retell_agent_id, retell_voice_id, retell_agent_version, ' +
            'retell_last_provisioned_at, agent_sync_state, agent_sync_error, agent_synced_at, phone_numbers, status'
        )
        .order('name');
      if (error) return reply.code(500).send({ error: error.message });

      // `clients.phone_numbers` is only what someone typed into the console.
      // `retell_phone_numbers` is written after Retell confirms the mapping, so
      // the difference between the two is exactly the case that misled us
      // before: a number shown as assigned that no provider ever routed.
      // Mapping failures are logged and swallowed during provisioning, so
      // without this the console cannot tell the two apart.
      const { data: mapped } = await supabase
        .from('retell_phone_numbers')
        .select('client_id, phone_number');

      const confirmedByClient = new Map<string, Set<string>>();
      for (const row of (mapped ?? []) as Array<{ client_id: string; phone_number: string }>) {
        const set = confirmedByClient.get(row.client_id) ?? new Set<string>();
        set.add(row.phone_number);
        confirmedByClient.set(row.client_id, set);
      }

      const clients = (data ?? []) as unknown as Array<Record<string, unknown>>;
      const rows = clients.map((client) => {
        const confirmed = confirmedByClient.get(client.id as string) ?? new Set<string>();
        const numbers = (client.phone_numbers as string[] | null) ?? [];
        return {
          ...client,
          phone_numbers: numbers,
          /** Numbers Retell has actually accepted an inbound mapping for. */
          confirmed_numbers: numbers.filter((n) => confirmed.has(n)),
          /** Configured here but never confirmed by Retell — these do not ring. */
          unconfirmed_numbers: numbers.filter((n) => !confirmed.has(n)),
        };
      });

      reply.send({ data: rows, verticals: listVerticals() });
    },
  });

  app.get<{ Params: { id: string } }>('/clients/:id/agent', {
    preHandler: requirePlatform('agents:read'),
    handler: async (request, reply) => {
      const client = await clientService.findById(request.params.id);
      if (!client) return reply.code(404).send({ error: 'Client not found' });
      const settings = await clientService.getSettings(request.params.id);

      reply.send({
        client: {
          id: client.id,
          name: client.name,
          industry: client.industry,
          timezone: client.timezone,
          phone_numbers: client.phone_numbers,
          retell_agent_id: client.retell_agent_id,
          retell_voice_id: client.retell_voice_id,
          retell_agent_version: client.retell_agent_version,
          agent_sync_state: (client as unknown as { agent_sync_state?: string }).agent_sync_state ?? 'never',
          agent_sync_error: (client as unknown as { agent_sync_error?: string }).agent_sync_error ?? null,
          agent_synced_at: (client as unknown as { agent_synced_at?: string }).agent_synced_at ?? null,
        },
        settings,
        verticals: listVerticals(),
      });
    },
  });

  app.patch<{ Params: { id: string } }>('/clients/:id/agent', {
    preHandler: requirePlatform('agents:write'),
    handler: async (request, reply) => {
      const actor = request.user as JwtPayload;
      const body = updateAgentSchema.parse(request.body);

      const client = await clientService.findById(request.params.id);
      if (!client) return reply.code(404).send({ error: 'Client not found' });

      // Split the payload: some fields live on `clients`, the rest on
      // `client_settings`. business_hours is folded into booking_rules rather
      // than getting its own column — the booking service already reads there.
      const { voice_id, phone_numbers, business_hours, booking_rules, ...settingsPatch } = body;

      await withAudit({
        actor: { userId: actor.sub, clientId: request.params.id, ipAddress: request.ip, userAgent: request.headers['user-agent'] },
        action: 'agent.config.updated',
        entityType: 'client',
        entityId: request.params.id,
        before: () => clientService.getSettings(request.params.id),
        mutate: async () => {
          const before = await clientService.getSettings(request.params.id);

          if (Object.keys(settingsPatch).length > 0 || business_hours || booking_rules) {
            const mergedBookingRules = {
              ...((before?.booking_rules as unknown as Record<string, unknown>) ?? {}),
              ...(booking_rules ?? {}),
              ...(business_hours ? { business_hours } : {}),
            };
            await clientService.updateSettings(request.params.id, {
              ...settingsPatch,
              ...(business_hours || booking_rules ? { booking_rules: mergedBookingRules } : {}),
            } as Parameters<typeof clientService.updateSettings>[1]);
          }

          if (voice_id !== undefined || phone_numbers !== undefined) {
            await clientService.update(request.params.id, {
              ...(voice_id !== undefined ? { retell_voice_id: voice_id } : {}),
              ...(phone_numbers !== undefined ? { phone_numbers } : {}),
            });
          }

          // The resulting settings, not the patch that produced them. A patch
          // records intent; the audit trail has to record state, or "what did
          // this look like before Tuesday" stays unanswerable.
          return clientService.getSettings(request.params.id);
        },
      });

      await agentSyncService.requestSync(request.params.id, { userId: actor.sub });
      reply.send({ ok: true, syncState: 'pending' });
    },
  });

  /**
   * The exact text Retell will receive, plus any validation problems.
   *
   * This is the first thing to look at when an agent says something unexpected —
   * far faster than reasoning about templates and overlays separately.
   */
  app.get<{ Params: { id: string }; Querystring: { template?: string } }>('/clients/:id/agent/preview', {
    preHandler: requirePlatform('agents:read'),
    handler: async (request, reply) => {
      try {
        const rendered = await provisioningService.renderClient(request.params.id, {
          template: request.query.template,
        });
        const problems = await provisioningService.validateClient(request.params.id, {
          template: request.query.template,
        });
        reply.send({
          vertical: rendered.vertical,
          prompt: rendered.responseEngine.general_prompt,
          beginMessage: rendered.responseEngine.begin_message,
          tools: rendered.responseEngine.general_tools.map((t) => t.name),
          agent: rendered.agent,
          problems,
        });
      } catch (err) {
        reply.code(400).send({ error: (err as Error).message });
      }
    },
  });

  app.get<{ Params: { id: string } }>('/clients/:id/agent/versions', {
    preHandler: requirePlatform('agents:read'),
    handler: async (request, reply) => {
      reply.send({ data: await agentSyncService.listVersions(request.params.id) });
    },
  });

  app.get<{ Params: { id: string; version: string } }>('/clients/:id/agent/versions/:version', {
    preHandler: requirePlatform('agents:read'),
    handler: async (request, reply) => {
      const version = await agentSyncService.getVersion(request.params.id, Number(request.params.version));
      if (!version) return reply.code(404).send({ error: 'Version not found' });
      reply.send(version);
    },
  });

  /**
   * Restore a previous configuration.
   *
   * Writes the old settings back and queues a sync rather than calling Retell
   * directly, so a restore goes through exactly the same validation as any
   * other change.
   */
  app.post<{ Params: { id: string; version: string } }>('/clients/:id/agent/versions/:version/restore', {
    preHandler: requirePlatform('agents:write'),
    handler: async (request, reply) => {
      const actor = request.user as JwtPayload;
      const snapshot = await agentSyncService.getVersion(request.params.id, Number(request.params.version));
      if (!snapshot) return reply.code(404).send({ error: 'Version not found' });

      const row = snapshot as { settings_snapshot: Record<string, unknown>; version: number };
      // Only restore configuration the version actually owns. Ids, timestamps
      // and the tenant key are excluded so a restore cannot rewrite identity.
      const { id: _id, client_id: _clientId, created_at: _createdAt, updated_at: _updatedAt, ...restorable } =
        row.settings_snapshot;

      // The audit carries the full before and after, not just the version
      // number. A restore is the most destructive configuration action in the
      // product — it overwrites every field at once — and "restored to v7" does
      // not tell anyone what v7 replaced.
      await withAudit({
        actor: { userId: actor.sub, clientId: request.params.id, ipAddress: request.ip, userAgent: request.headers['user-agent'] },
        action: 'agent.config.restored',
        entityType: 'client',
        entityId: request.params.id,
        before: () => clientService.getSettings(request.params.id),
        mutate: async () => {
          await clientService.updateSettings(
            request.params.id,
            restorable as Parameters<typeof clientService.updateSettings>[1]
          );
          return clientService.getSettings(request.params.id);
        },
      });

      await agentSyncService.requestSync(request.params.id, { userId: actor.sub, immediate: true });
      reply.send({ ok: true, restoredVersion: row.version });
    },
  });

  /** Force a sync now, skipping the coalescing window. */
  app.post<{ Params: { id: string } }>('/clients/:id/agent/sync', {
    preHandler: requirePlatform('agents:write'),
    handler: async (request, reply) => {
      const actor = request.user as JwtPayload;
      const problems = await provisioningService.validateClient(request.params.id);
      if (problems.length > 0) {
        return reply.code(400).send({ error: 'Agent configuration is invalid', problems });
      }
      await agentSyncService.requestSync(request.params.id, { userId: actor.sub, immediate: true });
      reply.send({ ok: true, syncState: 'pending' });
    },
  });
}
