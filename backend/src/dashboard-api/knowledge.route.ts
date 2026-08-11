import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../db/index.js';
import { requirePermission, requirePlatform, assertClientAccess } from '../middleware/index.js';
import { agentSyncService, writeAuditLog, withAudit, renderPolicies } from '../services/index.js';
import { logger } from '../utils/index.js';
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

  /**
   * A FAQ category must be one the client actually has, or null.
   *
   * The dropdown already limits what the UI can send; this is the API-side half,
   * because a route that only validates in the browser does not validate.
   */
  async function assertCategoryAllowed(clientId: string, category: unknown): Promise<string | null> {
    if (category === undefined || category === null || category === '') return null;
    const { data } = await supabase
      .from('knowledge_categories')
      .select('id')
      .eq('client_id', clientId)
      .eq('name', category as string)
      .eq('active', true)
      .maybeSingle();
    return data ? null : `Unknown category: ${String(category)}`;
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

        if (name === 'faqs') {
          const categoryError = await assertCategoryAllowed(clientId, (body as { category?: unknown }).category);
          if (categoryError) return reply.code(400).send({ error: categoryError });
        }

        let created: Record<string, unknown>;
        try {
          created = await withAudit<Record<string, unknown> | null>({
            actor: { userId: user.sub, clientId, ipAddress: request.ip, userAgent: request.headers['user-agent'] },
            action: `knowledge.${name}.created`,
            entityType: name,
            before: async () => null,
            mutate: async () => {
              const { data, error } = await supabase
                .from(config.table)
                .insert({ ...body, client_id: clientId })
                .select()
                .single();
              if (error) throw new Error(error.message);
              return data as Record<string, unknown>;
            },
          }) as Record<string, unknown>;
        } catch (err) {
          return reply.code(400).send({ error: (err as Error).message });
        }

        await afterWrite(clientId, user.sub);
        reply.code(201).send(created);
      },
    });

    app.patch<{ Params: { id: string } }>(`/knowledge/${name}/:id`, {
      preHandler: requirePermission('knowledge:write'),
      handler: async (request, reply) => {
        const user = request.user as JwtPayload;

        // Read the row first: the tenant check has to be against the row's own
        // client_id, not one supplied by the caller. The whole row rather than
        // just client_id, because it is also the `before` the audit records —
        // "someone changed a price" is not an answer without the old price.
        const { data: existing } = await supabase
          .from(config.table)
          .select('*')
          .eq('id', request.params.id)
          .maybeSingle();
        if (!existing) return reply.code(404).send({ error: 'Not found' });

        const rowClientId = (existing as { client_id: string }).client_id;
        if (!assertClientAccess(user, rowClientId)) return reply.code(403).send({ error: 'Forbidden' });

        const body = config.schema.partial().parse(request.body);

        if (name === 'faqs' && 'category' in (body as Record<string, unknown>)) {
          const categoryError = await assertCategoryAllowed(rowClientId, (body as { category?: unknown }).category);
          if (categoryError) return reply.code(400).send({ error: categoryError });
        }

        let updated: Record<string, unknown>;
        try {
          updated = await withAudit<Record<string, unknown> | null>({
            actor: { userId: user.sub, clientId: rowClientId, ipAddress: request.ip, userAgent: request.headers['user-agent'] },
            action: `knowledge.${name}.updated`,
            entityType: name,
            entityId: request.params.id,
            before: async () => existing as Record<string, unknown>,
            mutate: async () => {
              const { data, error } = await supabase
                .from(config.table)
                .update({ ...body, updated_at: new Date().toISOString() })
                .eq('id', request.params.id)
                .select()
                .single();
              if (error) throw new Error(error.message);
              return data as Record<string, unknown>;
            },
          }) as Record<string, unknown>;
        } catch (err) {
          return reply.code(400).send({ error: (err as Error).message });
        }

        await afterWrite(rowClientId, user.sub);
        reply.send(updated);
      },
    });

    app.delete<{ Params: { id: string } }>(`/knowledge/${name}/:id`, {
      preHandler: requirePermission('knowledge:write'),
      handler: async (request, reply) => {
        const user = request.user as JwtPayload;
        const { data: existing } = await supabase
          .from(config.table)
          .select('*')
          .eq('id', request.params.id)
          .maybeSingle();
        if (!existing) return reply.code(404).send({ error: 'Not found' });

        const rowClientId = (existing as { client_id: string }).client_id;
        if (!assertClientAccess(user, rowClientId)) return reply.code(403).send({ error: 'Forbidden' });

        try {
          await withAudit<Record<string, unknown> | null>({
            actor: { userId: user.sub, clientId: rowClientId, ipAddress: request.ip, userAgent: request.headers['user-agent'] },
            action: `knowledge.${name}.deactivated`,
            entityType: name,
            entityId: request.params.id,
            // The full row, so a deactivated FAQ can be reconstructed from the
            // audit trail alone if someone needs it back.
            before: async () => existing as Record<string, unknown>,
            mutate: async () => {
              // Soft delete: the agent stops using it, but history and any prompt
              // version that referenced it stay coherent.
              const { error } = await supabase
                .from(config.table)
                .update({ active: false, updated_at: new Date().toISOString() })
                .eq('id', request.params.id);
              if (error) throw new Error(error.message);
              return { ...(existing as Record<string, unknown>), active: false };
            },
          });
        } catch (err) {
          return reply.code(400).send({ error: (err as Error).message });
        }

        await afterWrite(rowClientId, user.sub);
        reply.send({ ok: true });
      },
    });
  }

  /**
   * FAQ categories.
   *
   * Reading is tenant-scoped and open to anyone with knowledge:read, because the
   * FAQ form needs the list to populate its dropdown. Writing is platform-only:
   * the point of the change is that clients pick from a curated list rather than
   * inventing one, so a client who could edit the list would be back where they
   * started.
   */
  const categorySchema = z.object({
    name: z.string().min(1).max(100),
    sort_order: z.number().int().min(0).max(9999).optional(),
    active: z.boolean().optional(),
  });

  app.get<{ Querystring: { clientId?: string; includeInactive?: string } }>('/knowledge/categories', {
    preHandler: requirePermission('knowledge:read'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const clientId = scopeFor(user, request.query.clientId);
      if (!clientId) return reply.code(403).send({ error: 'Forbidden' });

      let query = supabase
        .from('knowledge_categories')
        .select('*')
        .eq('client_id', clientId)
        .order('sort_order')
        .order('name');
      if (request.query.includeInactive !== 'true') query = query.eq('active', true);

      const { data, error } = await query;
      if (error) return reply.code(500).send({ error: error.message });
      reply.send({ data: data ?? [] });
    },
  });

  app.post<{ Querystring: { clientId?: string } }>('/knowledge/categories', {
    preHandler: requirePlatform('knowledge:write'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const clientId = scopeFor(user, request.query.clientId);
      if (!clientId) return reply.code(403).send({ error: 'Forbidden' });

      const body = categorySchema.parse(request.body);

      // Routed through withAudit — like every other configure-axis write in this
      // file — rather than a direct writeAuditLog call, so this stays covered by
      // the same audit-coverage guard the rest of knowledge.route.ts is (spec
      // §2.5). `before` is `null`: this is a create, nothing existed yet.
      let created: Record<string, unknown>;
      try {
        created = await withAudit<Record<string, unknown> | null>({
          actor: { userId: user.sub, clientId, ipAddress: request.ip, userAgent: request.headers['user-agent'] },
          action: 'knowledge.category.created',
          entityType: 'knowledge_category',
          before: async () => null,
          mutate: async () => {
            const { data, error } = await supabase
              .from('knowledge_categories')
              .insert({ ...body, client_id: clientId })
              .select()
              .single();
            if (error) {
              // 23505 is the (client_id, name) unique index. Carry the code
              // through so the catch below can answer the question the caller
              // asked rather than leaking a constraint name as a 500.
              const wrapped = new Error(error.message) as Error & { code?: string };
              wrapped.code = error.code;
              throw wrapped;
            }
            return data as Record<string, unknown>;
          },
        }) as Record<string, unknown>;
      } catch (err) {
        const wrapped = err as Error & { code?: string };
        if (wrapped.code === '23505') {
          return reply.code(409).send({ error: 'That category already exists for this client' });
        }
        return reply.code(400).send({ error: wrapped.message });
      }

      await afterWrite(clientId, user.sub);
      reply.code(201).send(created);
    },
  });

  /**
   * Rename or reactivate/adjust a category. Platform-only, same reasoning as
   * the POST above.
   *
   * `faqs.category` stores the NAME, not a foreign key (see the migration
   * header on knowledge_categories) — a deliberate choice that avoids an FK
   * migration against live rows and keeps `knowledge.service.ts`'s prompt
   * builder reading `r.category` unchanged. The cost is that a rename MUST
   * rewrite every FAQ row that used the old name, or those FAQs silently fall
   * off the client's category list. The cascade below is scoped to this
   * category's own client_id — never a cross-tenant rewrite, even if another
   * tenant happens to have a category with the same old name.
   */
  app.patch<{ Params: { id: string } }>('/knowledge/categories/:id', {
    preHandler: requirePlatform('knowledge:write'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;

      const { data: existing } = await supabase
        .from('knowledge_categories')
        .select('*')
        .eq('id', request.params.id)
        .maybeSingle();
      if (!existing) return reply.code(404).send({ error: 'Not found' });

      const row = existing as { id: string; client_id: string; name: string };
      if (!assertClientAccess(user, row.client_id)) return reply.code(403).send({ error: 'Forbidden' });

      const body = categorySchema.partial().parse(request.body);

      let updated: Record<string, unknown>;
      try {
        updated = await withAudit<Record<string, unknown> | null>({
          actor: { userId: user.sub, clientId: row.client_id, ipAddress: request.ip, userAgent: request.headers['user-agent'] },
          action: 'knowledge.category.updated',
          entityType: 'knowledge_category',
          entityId: row.id,
          before: async () => existing as Record<string, unknown>,
          mutate: async () => {
            const { data, error } = await supabase
              .from('knowledge_categories')
              .update({ ...body, updated_at: new Date().toISOString() })
              .eq('id', request.params.id)
              .select()
              .single();
            if (error) {
              // 23505 is the (client_id, name) unique index — same handling as
              // the POST above.
              const wrapped = new Error(error.message) as Error & { code?: string };
              wrapped.code = error.code;
              throw wrapped;
            }

            // The cascade: scoped to row.client_id AND the OLD name, so it can
            // only ever touch this one client's FAQ rows.
            if (body.name && body.name !== row.name) {
              const { error: cascadeError } = await supabase
                .from('faqs')
                .update({ category: body.name })
                .eq('client_id', row.client_id)
                .eq('category', row.name);
              if (cascadeError) throw new Error(cascadeError.message);
            }

            return data as Record<string, unknown>;
          },
        }) as Record<string, unknown>;
      } catch (err) {
        const wrapped = err as Error & { code?: string };
        if (wrapped.code === '23505') {
          return reply.code(409).send({ error: 'That category already exists for this client' });
        }
        return reply.code(400).send({ error: wrapped.message });
      }

      await afterWrite(row.client_id, user.sub);
      reply.send(updated);
    },
  });

  /**
   * Soft-delete a category. Platform-only.
   *
   * FAQ rows that reference it keep their `category` text untouched — removing
   * a category from the picker must never rewrite content a client already
   * wrote. Those FAQs simply stop matching an active category until reassigned
   * (the same state a FAQ is in immediately after this route existed but before
   * any category was ever created for it).
   */
  app.delete<{ Params: { id: string } }>('/knowledge/categories/:id', {
    preHandler: requirePlatform('knowledge:write'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;

      const { data: existing } = await supabase
        .from('knowledge_categories')
        .select('*')
        .eq('id', request.params.id)
        .maybeSingle();
      if (!existing) return reply.code(404).send({ error: 'Not found' });

      const row = existing as { id: string; client_id: string };
      if (!assertClientAccess(user, row.client_id)) return reply.code(403).send({ error: 'Forbidden' });

      try {
        await withAudit<Record<string, unknown> | null>({
          actor: { userId: user.sub, clientId: row.client_id, ipAddress: request.ip, userAgent: request.headers['user-agent'] },
          action: 'knowledge.category.deactivated',
          entityType: 'knowledge_category',
          entityId: row.id,
          before: async () => existing as Record<string, unknown>,
          mutate: async () => {
            const { error } = await supabase
              .from('knowledge_categories')
              .update({ active: false, updated_at: new Date().toISOString() })
              .eq('id', row.id);
            if (error) throw new Error(error.message);
            return { ...(existing as Record<string, unknown>), active: false };
          },
        });
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }

      await afterWrite(row.client_id, user.sub);
      reply.code(204).send();
    },
  });

  /**
   * Business policies — cancellation, deposits, insurance, parking, anything the
   * agent must state verbatim rather than improvise.
   *
   * These are now rows in `client_policies` (migration 032) with a title and a
   * body, rather than a bare text array — the array was one broad text box that
   * operators found hard to fill in well. `client_settings.business_policies`
   * stays the agent-facing contract (seven Retell templates and four other call
   * sites read it straight), so every write here calls `renderPolicies()` to
   * rebuild that array as `"Title: Body"` strings immediately afterward. Nothing
   * downstream of that array changes.
   */
  app.get<{ Querystring: { clientId?: string } }>('/knowledge/policies', {
    preHandler: requirePermission('knowledge:read'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const clientId = scopeFor(user, request.query.clientId);
      if (!clientId) return reply.code(403).send({ error: 'Forbidden' });

      const { data, error } = await supabase
        .from('client_policies')
        .select('id, title, body, sort_order')
        .eq('client_id', clientId)
        .eq('active', true)
        .order('sort_order');
      if (error) return reply.code(500).send({ error: error.message });

      reply.send({ data: data ?? [] });
    },
  });

  app.put<{ Querystring: { clientId?: string }; Body: unknown }>('/knowledge/policies', {
    preHandler: requirePermission('knowledge:write'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const clientId = scopeFor(user, request.query.clientId);
      if (!clientId) return reply.code(403).send({ error: 'Forbidden' });

      // Whole-list replace rather than per-item CRUD: policies are short, are
      // reordered as often as they are edited, and the payload carries no
      // stable id to patch against. sort_order follows array position.
      // Titles are trimmed before the length check: a whitespace-only title
      // would otherwise pass validation and render into the agent's prompt
      // array as a blank heading.
      const body = z
        .object({
          policies: z
            .array(
              z.object({
                title: z.string().trim().min(1).max(200),
                body: z.string().max(4000).default(''),
              })
            )
            .max(50),
        })
        .parse(request.body);

      // Populated by `before()`, read by `mutate()` — the ids of the rows
      // that existed BEFORE this write, so the delete step targets exactly
      // those and never the rows the same call just inserted.
      let previousIds: string[] = [];

      let saved: Array<Record<string, unknown>>;
      try {
        saved = await withAudit<Array<Record<string, unknown>>>({
          actor: { userId: user.sub, clientId, ipAddress: request.ip, userAgent: request.headers['user-agent'] },
          action: 'knowledge.policies.updated',
          entityType: 'client_policies',
          entityId: clientId,
          before: async () => {
            const { data } = await supabase
              .from('client_policies')
              .select('id, title, body, sort_order')
              .eq('client_id', clientId)
              .eq('active', true)
              .order('sort_order');
            const rows = (data ?? []) as Array<Record<string, unknown>>;
            previousIds = rows.map((r) => r.id as string);
            return rows;
          },
          mutate: async () => {
            // Insert-first, delete-second — NOT delete-then-insert. A plain
            // delete-then-insert leaves the client with ZERO policy rows for
            // the entire window until the insert lands, and if the insert
            // fails the client is left with nothing: `client_policies` is
            // empty, `business_policies` still holds the old text (renderPolicies
            // never runs because mutate() threw), and withAudit's own log write
            // is skipped too — a throwing mutate() never reaches the
            // writeAuditLog call (see withAudit in audit.service.ts), so even
            // the `before` snapshot goes unrecorded. That combination is
            // unrecoverable production data loss.
            //
            // Inserting first means an insert failure leaves the PREVIOUS rows
            // (and business_policies, and the `before` snapshot already
            // captured above) completely untouched — the write simply did not
            // happen, and the 400 below is accurate. This codebase has no
            // precedent for wrapping a multi-statement write in a transactional
            // Postgres RPC (the existing `.rpc()` calls throughout the backend
            // are all read-only reporting functions, e.g. `report_kpis`,
            // `report_pulse`); reordering to insert-first gets the same safety
            // property using the same delete/insert primitives already used
            // everywhere else in this file, with no new migration required.
            if (body.policies.length === 0) {
              // Nothing new to protect — just remove what existed. If this
              // delete fails, the previous rows simply remain (mutate throws,
              // nothing was lost).
              if (previousIds.length > 0) {
                const { error: deleteError } = await supabase
                  .from('client_policies')
                  .delete()
                  .in('id', previousIds);
                if (deleteError) throw new Error(deleteError.message);
              }
              return [];
            }

            const rows = body.policies.map((p, i) => ({
              client_id: clientId,
              title: p.title,
              body: p.body,
              sort_order: i,
            }));
            const { data, error: insertError } = await supabase
              .from('client_policies')
              .insert(rows)
              .select();
            if (insertError) throw new Error(insertError.message);

            // Only now remove the rows that predate this write, by id — never
            // the ones just inserted. If THIS delete fails, the client ends up
            // with both old and new rows visible at once (a duplicate an
            // operator can spot and clean up), never with nothing.
            if (previousIds.length > 0) {
              const { error: deleteError } = await supabase
                .from('client_policies')
                .delete()
                .in('id', previousIds);
              if (deleteError) throw new Error(deleteError.message);
            }

            return (data ?? []) as Record<string, unknown>[];
          },
        }) as Array<Record<string, unknown>>;
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }

      // The rows above are already saved — a failure past this point must
      // not read as "the save failed". renderPolicies keeps
      // client_settings.business_policies (the agent's actual input) in sync
      // with what was just written; if THAT fails, the new rows still exist
      // but the agent keeps speaking the previous text until the next
      // successful save or sync. That is logged loudly here (the same
      // "succeeded but not fully recorded" precedent as the audit-write
      // failure path in audit.service.ts) and reported to the caller as a
      // 200 with an explicit warning — not folded into the 400 above, which
      // would wrongly imply nothing was saved.
      try {
        await renderPolicies(clientId);
      } catch (err) {
        logger.error(
          { err, clientId, userId: user.sub },
          'renderPolicies failed after a client_policies write — business_policies is stale'
        );
        return reply.code(200).send({
          data: saved,
          warning: `Policies were saved, but the live agent's text could not be refreshed (${(err as Error).message}). It will keep saying the previous policies until this is retried or a sync runs.`,
        });
      }

      await afterWrite(clientId, user.sub);
      reply.send({ data: saved });
    },
  });

  /**
   * Opening hours.
   *
   * Stored as `booking_rules.working_hours`, keyed by lowercase weekday name,
   * with a closed day represented by the key being ABSENT:
   *
   *     { "monday": { "open": "09:00", "close": "17:00" }, ... }
   *
   * That is the canonical shape: `booking.service.ts` resolves availability from
   * it, all seven agent templates render it, and it is what every configured
   * tenant stores.
   *
   * This route previously read and wrote `booking_rules.business_hours` in a
   * different `{tz, weekly[], exceptions[]}` shape, with a comment claiming it
   * stored there so the hours the agent speaks could not drift from the hours it
   * books. The opposite was true: nothing read `business_hours`, so the editor
   * showed empty for every tenant and saving changed neither booking nor the
   * agent. Confirmed against production — 7 of 8 tenants had `working_hours`
   * and none had `business_hours`.
   *
   * The API shape is preserved so the dashboard editor is unchanged; the
   * translation happens here.
   */
  const WEEKDAYS = [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
  ] as const;

  type ApiHours = z.infer<typeof hoursSchema>;
  type StoredDay = { open: string; close: string };

  /** API shape → canonical storage. Closed days are omitted, not flagged. */
  function toStored(hours: ApiHours): {
    working_hours: Record<string, StoredDay>;
    blackout_dates: string[];
  } {
    const working: Record<string, StoredDay> = {};
    for (const d of hours.weekly) {
      if (d.closed) continue;
      working[WEEKDAYS[d.day]] = { open: d.open, close: d.close };
    }
    return {
      working_hours: working,
      // Only full-day closures survive the round trip: `blackout_dates` is a
      // date array, with nowhere to put per-date open/close overrides. Partial
      // exceptions are dropped rather than silently stored where the booking
      // service cannot see them — see the note in the PUT handler.
      blackout_dates: hours.exceptions.filter((e) => e.closed).map((e) => e.date),
    };
  }

  /** Canonical storage → API shape, for the editor to render. */
  function fromStored(rules: Record<string, unknown>, tz: string): ApiHours | null {
    const working = rules.working_hours as Record<string, StoredDay> | undefined;
    if (!working || Object.keys(working).length === 0) return null;

    const weekly = WEEKDAYS.map((name, day) => {
      const d = working[name];
      return d
        ? { day, open: d.open, close: d.close, closed: false }
        : { day, open: '09:00', close: '17:00', closed: true };
    });

    const blackouts = Array.isArray(rules.blackout_dates) ? (rules.blackout_dates as string[]) : [];
    return {
      tz,
      weekly,
      exceptions: blackouts.map((date) => ({ date, closed: true })),
    };
  }

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

      const [{ data }, { data: client }] = await Promise.all([
        supabase.from('client_settings').select('booking_rules').eq('client_id', clientId).maybeSingle(),
        supabase.from('clients').select('timezone').eq('id', clientId).maybeSingle(),
      ]);

      const rules = (data as { booking_rules: Record<string, unknown> | null } | null)?.booking_rules ?? {};
      const tz = (client as { timezone?: string } | null)?.timezone ?? 'UTC';
      reply.send({ data: fromStored(rules, tz) });
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

      const stored = toStored(hours);

      try {
        await withAudit<Record<string, unknown>>({
          actor: { userId: user.sub, clientId, ipAddress: request.ip, userAgent: request.headers['user-agent'] },
          action: 'knowledge.hours.updated',
          entityType: 'client_settings',
          entityId: clientId,
          // Only the hours keys, not all of booking_rules: an audit row that
          // repeats the buffers and qualification rules on every hours edit
          // makes the change itself harder to find.
          before: async () => ({ working_hours: existingRules.working_hours ?? null }),
          mutate: async () => {
            const { error } = await supabase
              .from('client_settings')
              .update({ booking_rules: { ...existingRules, ...stored } })
              .eq('client_id', clientId);
            if (error) throw new Error(error.message);
            return stored as Record<string, unknown>;
          },
        });
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }

      await afterWrite(clientId, user.sub);

      // Report what was actually persisted, not what was posted. A partial-day
      // exception (open late on the 24th) has nowhere to live in the canonical
      // shape, so it is dropped — and the caller is told, rather than being
      // handed its own input back as confirmation of a save that did not happen.
      const droppedExceptions = hours.exceptions.filter((e) => !e.closed).map((e) => e.date);
      reply.send({
        data: fromStored({ ...existingRules, ...stored }, hours.tz),
        ...(droppedExceptions.length > 0 && {
          warning: `Partial-day exceptions are not supported and were not saved: ${droppedExceptions.join(', ')}. Only full-day closures are stored.`,
        }),
      });
    },
  });

  /**
   * Push a knowledge change to the live agent.
   *
   * The audit half of this used to live here too, which meant every knowledge
   * write recorded a verb and an id and nothing else — enough to say a price
   * changed, not enough to say what it changed from. The routes now go through
   * `withAudit` with the real before/after row, and this is left with the one job
   * it was always doing: without the re-provision the row changes and the agent
   * keeps quoting the old answer.
   */
  async function afterWrite(clientId: string, userId: string): Promise<void> {
    await agentSyncService.requestSync(clientId, { userId });
  }
}
