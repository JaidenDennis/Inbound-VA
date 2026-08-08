import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../db/index.js';
import { requirePermission, assertClientAccess } from '../middleware/index.js';
import { agentSyncService, writeAuditLog } from '../services/index.js';
import type { JwtPayload } from '../types/index.js';

/**
 * Client-editable knowledge: the facts the agent states.
 *
 * Behaviour (prompt, routing, voice) stays staff-only — see agents.route.ts. The
 * split means a client edit can produce a wrong answer but can never break the
 * call flow.
 *
 * Every write here queues a re-provision. Without that the row changes and the
 * live agent keeps saying the old thing, which is the bug this phase exists for.
 */

const faqSchema = z.object({
  question: z.string().min(1).max(500),
  answer: z.string().min(1).max(4000),
  category: z.string().max(100).nullish(),
  active: z.boolean().optional(),
});

const serviceSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  duration_minutes: z.number().int().min(1).max(1440).optional(),
  price: z.number().nonnegative().nullish(),
  category: z.string().max(100).nullish(),
  active: z.boolean().optional(),
});

const pricingSchema = z.object({
  name: z.string().min(1).max(200),
  price: z.number().nonnegative(),
  service_id: z.string().uuid().nullish(),
  member_price: z.number().nonnegative().nullish(),
  unit: z.string().max(50).nullish(),
  notes: z.string().max(1000).nullish(),
  upsell_note: z.string().max(1000).nullish(),
  active: z.boolean().optional(),
});

const promotionSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  eligibility: z.string().max(1000).nullish(),
  starts_at: z.string().datetime().nullish(),
  ends_at: z.string().datetime().nullish(),
  active: z.boolean().optional(),
});

const RESOURCES = {
  faqs: { table: 'faqs', schema: faqSchema, order: 'created_at' },
  services: { table: 'services', schema: serviceSchema, order: 'name' },
  pricing: { table: 'pricing', schema: pricingSchema, order: 'name' },
  promotions: { table: 'promotions', schema: promotionSchema, order: 'created_at' },
} as const;

type ResourceName = keyof typeof RESOURCES;

export async function knowledgeRoutes(app: FastifyInstance): Promise<void> {
  /**
   * The tenant a request acts on. Client users are pinned to their own; staff
   * must name one. Returning null makes the caller reply 400/403 rather than
   * silently reading across tenants.
   */
  function scopeFor(user: JwtPayload, requested?: string): string | null {
    const clientId = user.clientId ?? requested ?? null;
    if (!clientId) return null;
    return assertClientAccess(user, clientId) ? clientId : null;
  }

  for (const [name, config] of Object.entries(RESOURCES) as [ResourceName, typeof RESOURCES[ResourceName]][]) {
    app.get<{ Querystring: { clientId?: string; includeInactive?: string } }>(`/knowledge/${name}`, {
      preHandler: requirePermission('knowledge:read'),
      handler: async (request, reply) => {
        const user = request.user as JwtPayload;
        const clientId = scopeFor(user, request.query.clientId);
        if (!clientId) return reply.code(403).send({ error: 'Forbidden' });

        let query = supabase.from(config.table).select('*').eq('client_id', clientId).order(config.order);
        if (request.query.includeInactive !== 'true') query = query.eq('active', true);

        const { data, error } = await query;
        if (error) return reply.code(500).send({ error: error.message });
        reply.send({ data: data ?? [] });
      },
    });

    app.post<{ Querystring: { clientId?: string } }>(`/knowledge/${name}`, {
      preHandler: requirePermission('knowledge:write'),
      handler: async (request, reply) => {
        const user = request.user as JwtPayload;
        const clientId = scopeFor(user, request.query.clientId);
        if (!clientId) return reply.code(403).send({ error: 'Forbidden' });

        const body = config.schema.parse(request.body);
        const { data, error } = await supabase
          .from(config.table)
          .insert({ ...body, client_id: clientId })
          .select()
          .single();
        if (error) return reply.code(400).send({ error: error.message });

        await afterWrite(user, clientId, name, 'created', (data as { id: string }).id, request.ip);
        reply.code(201).send(data);
      },
    });

    app.patch<{ Params: { id: string } }>(`/knowledge/${name}/:id`, {
      preHandler: requirePermission('knowledge:write'),
      handler: async (request, reply) => {
        const user = request.user as JwtPayload;

        // Read the row first: the tenant check has to be against the row's own
        // client_id, not one supplied by the caller.
        const { data: existing } = await supabase
          .from(config.table)
          .select('client_id')
          .eq('id', request.params.id)
          .maybeSingle();
        if (!existing) return reply.code(404).send({ error: 'Not found' });

        const rowClientId = (existing as { client_id: string }).client_id;
        if (!assertClientAccess(user, rowClientId)) return reply.code(403).send({ error: 'Forbidden' });

        const body = config.schema.partial().parse(request.body);
        const { data, error } = await supabase
          .from(config.table)
          .update({ ...body, updated_at: new Date().toISOString() })
          .eq('id', request.params.id)
          .select()
          .single();
        if (error) return reply.code(400).send({ error: error.message });

        await afterWrite(user, rowClientId, name, 'updated', request.params.id, request.ip);
        reply.send(data);
      },
    });

    app.delete<{ Params: { id: string } }>(`/knowledge/${name}/:id`, {
      preHandler: requirePermission('knowledge:write'),
      handler: async (request, reply) => {
        const user = request.user as JwtPayload;
        const { data: existing } = await supabase
          .from(config.table)
          .select('client_id')
          .eq('id', request.params.id)
          .maybeSingle();
        if (!existing) return reply.code(404).send({ error: 'Not found' });

        const rowClientId = (existing as { client_id: string }).client_id;
        if (!assertClientAccess(user, rowClientId)) return reply.code(403).send({ error: 'Forbidden' });

        // Soft delete: the agent stops using it, but history and any prompt
        // version that referenced it stay coherent.
        const { error } = await supabase
          .from(config.table)
          .update({ active: false, updated_at: new Date().toISOString() })
          .eq('id', request.params.id);
        if (error) return reply.code(400).send({ error: error.message });

        await afterWrite(user, rowClientId, name, 'deactivated', request.params.id, request.ip);
        reply.send({ ok: true });
      },
    });
  }

  /**
   * Business policies — cancellation, deposits, insurance, parking, anything the
   * agent must state verbatim rather than improvise.
   *
   * Unlike the four resources above these are not a table: they are a text array
   * on client_settings that `renderPolicies()` reads straight into the prompt.
   * They had no editor at all, so the only way to change what the agent said
   * about a refund policy was a raw settings PATCH.
   */
  app.get<{ Querystring: { clientId?: string } }>('/knowledge/policies', {
    preHandler: requirePermission('knowledge:read'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const clientId = scopeFor(user, request.query.clientId);
      if (!clientId) return reply.code(403).send({ error: 'Forbidden' });

      const { data } = await supabase
        .from('client_settings')
        .select('business_policies')
        .eq('client_id', clientId)
        .maybeSingle();

      reply.send({ data: (data as { business_policies: string[] | null } | null)?.business_policies ?? [] });
    },
  });

  app.put<{ Querystring: { clientId?: string }; Body: unknown }>('/knowledge/policies', {
    preHandler: requirePermission('knowledge:write'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const clientId = scopeFor(user, request.query.clientId);
      if (!clientId) return reply.code(403).send({ error: 'Forbidden' });

      // Whole-list replace rather than per-item CRUD: policies are short, are
      // reordered as often as they are edited, and have no stable id to patch.
      const body = z
        .object({ policies: z.array(z.string().min(1).max(1000)).max(50) })
        .parse(request.body);

      const { error } = await supabase
        .from('client_settings')
        .update({ business_policies: body.policies })
        .eq('client_id', clientId);
      if (error) return reply.code(400).send({ error: error.message });

      await afterWrite(user, clientId, 'policies', 'updated', clientId, request.ip);
      reply.send({ data: body.policies });
    },
  });

  /**
   * Opening hours.
   *
   * Stored inside `booking_rules.business_hours` because the booking service
   * already reads availability from there — a second copy would let the hours
   * the agent speaks drift from the hours it will actually book.
   */
  const hoursSchema = z.object({
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

  app.get<{ Querystring: { clientId?: string } }>('/knowledge/hours', {
    preHandler: requirePermission('knowledge:read'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const clientId = scopeFor(user, request.query.clientId);
      if (!clientId) return reply.code(403).send({ error: 'Forbidden' });

      const { data } = await supabase
        .from('client_settings')
        .select('booking_rules')
        .eq('client_id', clientId)
        .maybeSingle();

      const rules = (data as { booking_rules: Record<string, unknown> | null } | null)?.booking_rules ?? {};
      reply.send({ data: rules.business_hours ?? null });
    },
  });

  app.put<{ Querystring: { clientId?: string }; Body: unknown }>('/knowledge/hours', {
    preHandler: requirePermission('knowledge:write'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const clientId = scopeFor(user, request.query.clientId);
      if (!clientId) return reply.code(403).send({ error: 'Forbidden' });

      const hours = hoursSchema.parse(request.body);

      // Merge, never replace: booking_rules also carries buffers, lead times and
      // qualification rules that this editor knows nothing about.
      const { data: current } = await supabase
        .from('client_settings')
        .select('booking_rules')
        .eq('client_id', clientId)
        .maybeSingle();
      const existingRules = (current as { booking_rules: Record<string, unknown> | null } | null)?.booking_rules ?? {};

      const { error } = await supabase
        .from('client_settings')
        .update({ booking_rules: { ...existingRules, business_hours: hours } })
        .eq('client_id', clientId);
      if (error) return reply.code(400).send({ error: error.message });

      await afterWrite(user, clientId, 'hours', 'updated', clientId, request.ip);
      reply.send({ data: hours });
    },
  });

  async function afterWrite(
    user: JwtPayload,
    clientId: string,
    resource: string,
    action: string,
    entityId: string,
    ip: string
  ): Promise<void> {
    await writeAuditLog({
      userId: user.sub,
      clientId,
      action: `knowledge.${resource}.${action}`,
      entityType: resource,
      entityId,
      ipAddress: ip,
    });
    await agentSyncService.requestSync(clientId, { userId: user.sub });
  }
}
