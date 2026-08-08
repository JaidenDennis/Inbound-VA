import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { clientService } from '../services/index.js';
import { requirePermission, assertClientAccess, isPlatformUser } from '../middleware/index.js';
import { writeAuditLog } from '../services/index.js';
import type { JwtPayload, Client } from '../types/index.js';
import { ghlBlueprintSchema } from '../types/index.js';

const createClientSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
  industry: z.string().default('other'),
  timezone: z.string().default('America/New_York'),
  phone_numbers: z.array(z.string()).default([]),
  retell_agent_id: z.string().optional(),
});

// status is allowed on update so clients can be disabled / suspended
const updateClientSchema = createClientSchema.partial().extend({
  status: z.enum(['active', 'inactive', 'suspended']).optional(),
});

// Per-client configuration editable from the dashboard
const updateSettingsSchema = z.object({
  agent_prompt: z.string().optional(),
  agent_personality: z.string().optional(),
  agent_tone: z.string().optional(),
  agent_response_style: z.string().optional(),
  faqs: z.array(z.record(z.unknown())).optional(),
  services: z.array(z.record(z.unknown())).optional(),
  pricing: z.array(z.record(z.unknown())).optional(),
  business_policies: z.array(z.string()).optional(),
  booking_enabled: z.boolean().optional(),
  booking_rules: z.record(z.unknown()).optional(),
  notification_emails: z.array(z.string()).optional(),
  escalation_rules: z.array(z.record(z.unknown())).optional(),
  crm_type: z.string().optional(),
  crm_config: z.record(z.unknown()).optional(),
  custom_field_mapping: z.record(z.string()).optional(),
  ghl_blueprint: ghlBlueprintSchema.nullable().optional(),
});

export async function clientRoutes(app: FastifyInstance): Promise<void> {
  app.get('/clients', {
    preHandler: requirePermission('clients:read'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      // Client-scoped users only ever see their own client record.
      if (!isPlatformUser(user)) {
        const client = user.clientId ? await clientService.findById(user.clientId) : null;
        return reply.send({ data: client ? [client] : [], count: client ? 1 : 0 });
      }
      const query = request.query as Record<string, string>;
      const page = Number(query.page ?? 1);
      const limit = Number(query.limit ?? 20);
      const result = await clientService.list(page, limit, {
        includeArchived: query.includeArchived === 'true',
      });
      reply.send(result);
    },
  });

  app.get<{ Params: { id: string } }>('/clients/:id', {
    preHandler: requirePermission('clients:read'),
    handler: async (request, reply) => {
      if (!assertClientAccess(request.user as JwtPayload, request.params.id)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const client = await clientService.findById(request.params.id);
      if (!client) return reply.code(404).send({ error: 'Not found' });
      const settings = await clientService.getSettings(client.id);
      reply.send({ ...client, settings });
    },
  });

  app.post('/clients', {
    preHandler: requirePermission('clients:write'),
    handler: async (request, reply) => {
      // Only platform users may create new tenants.
      if (!isPlatformUser(request.user as JwtPayload)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const body = createClientSchema.parse(request.body);
      const client = await clientService.create(body as Partial<Client>);
      await writeAuditLog({
        userId: (request.user as { sub?: string })?.sub,
        clientId: client.id,
        action: 'client.created',
        entityType: 'client',
        entityId: client.id,
        newValue: client,
        ipAddress: request.ip,
      });
      reply.code(201).send(client);
    },
  });

  app.patch<{ Params: { id: string } }>('/clients/:id', {
    preHandler: requirePermission('clients:write'),
    handler: async (request, reply) => {
      if (!assertClientAccess(request.user as JwtPayload, request.params.id)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const body = updateClientSchema.parse(request.body);
      const existing = await clientService.findById(request.params.id);
      if (!existing) return reply.code(404).send({ error: 'Not found' });
      const updated = await clientService.update(request.params.id, body as Partial<Client>);
      await writeAuditLog({
        userId: (request.user as { sub?: string })?.sub,
        clientId: request.params.id,
        action: 'client.updated',
        entityType: 'client',
        entityId: request.params.id,
        oldValue: existing,
        newValue: updated,
        ipAddress: request.ip,
      });
      reply.send(updated);
    },
  });

  /**
   * Archive a client.
   *
   * Deliberately not a row delete. A client owns calls, transcripts, contacts,
   * appointments and audit rows; destroying it would either cascade away the
   * operating history the audit log exists to preserve, or fail on a foreign
   * key halfway through and leave the tenant half-removed.
   *
   * Archiving sets status to 'inactive', which already excludes the client from
   * routing and the default dashboard list, and is reversible with a PATCH.
   */
  app.delete<{ Params: { id: string } }>('/clients/:id', {
    preHandler: requirePermission('clients:write'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      // Only platform staff may archive a tenant — a client admin archiving
      // their own account would lock themselves out with no way back.
      if (!isPlatformUser(user)) return reply.code(403).send({ error: 'Forbidden' });

      const existing = await clientService.findById(request.params.id);
      if (!existing) return reply.code(404).send({ error: 'Not found' });
      if (existing.status === 'inactive') {
        return reply.send({ ...existing, alreadyArchived: true });
      }

      const updated = await clientService.update(request.params.id, {
        status: 'inactive',
      } as Partial<Client>);

      await writeAuditLog({
        userId: user.sub,
        clientId: request.params.id,
        action: 'client.archived',
        entityType: 'client',
        entityId: request.params.id,
        oldValue: { status: existing.status },
        newValue: { status: 'inactive' },
        ipAddress: request.ip,
      });

      reply.send(updated);
    },
  });

  // Edit per-client settings (agent prompt, FAQs, services, booking rules,
  // notification emails, CRM type, custom field mapping, etc.)
  app.patch<{ Params: { id: string } }>('/clients/:id/settings', {
    preHandler: requirePermission('settings:write'),
    handler: async (request, reply) => {
      if (!assertClientAccess(request.user as JwtPayload, request.params.id)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const body = updateSettingsSchema.parse(request.body);
      const existing = await clientService.getSettings(request.params.id);
      if (!existing) return reply.code(404).send({ error: 'Settings not found' });
      const updated = await clientService.updateSettings(request.params.id, body as never);
      await writeAuditLog({
        userId: (request.user as { sub?: string })?.sub,
        clientId: request.params.id,
        action: 'client.settings.updated',
        entityType: 'client_settings',
        entityId: request.params.id,
        oldValue: existing,
        newValue: updated,
        ipAddress: request.ip,
      });
      reply.send(updated);
    },
  });
}
