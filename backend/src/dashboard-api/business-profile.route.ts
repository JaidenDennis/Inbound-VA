import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../db/index.js';
import { requirePermission, assertClientAccess } from '../middleware/index.js';
import { withAudit } from '../services/index.js';
import type { JwtPayload } from '../types/index.js';

/**
 * The business profile: who the account belongs to, and where the business is.
 *
 * Stored as one JSONB blob on `clients` (migration 035), following the
 * `branding` precedent — written whole by one form, read whole by whoever needs
 * it, and nothing joins or filters on a postal code.
 *
 * Every field is optional. A client fills this in during onboarding and will
 * not have all of it on the first save, and a form that refuses a partial save
 * is a form people abandon. What matters is that whatever IS supplied is
 * shaped correctly.
 */

/** Trim, and treat a field the user cleared as absent rather than empty. */
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s.length ? s : undefined))
    .optional();

const profileSchema = z.object({
  contact_first_name: text(100),
  contact_last_name: text(100),
  address_line1: text(200),
  address_line2: text(200),
  city: text(100),
  // 'region', not 'state' — most of the world does not have states, and naming
  // the field for one country's subdivision produces forms that only work there.
  region: text(100),
  postal_code: text(20),
  // ISO 3166-1 alpha-2. Uppercased so 'gb' and 'GB' are the same country rather
  // than two, which matters the moment anything groups by it.
  country: z
    .string()
    .trim()
    .length(2)
    .transform((s) => s.toUpperCase())
    .optional()
    .or(z.literal('').transform(() => undefined)),
});

export type BusinessProfile = z.infer<typeof profileSchema>;

export async function businessProfileRoutes(app: FastifyInstance): Promise<void> {
  /** The tenant this request acts on. Staff must name one; clients cannot. */
  function scopeFor(user: JwtPayload, requested?: string): string | null {
    const clientId = user.clientId ?? requested ?? null;
    if (!clientId) return null;
    return assertClientAccess(user, clientId) ? clientId : null;
  }

  app.get<{ Querystring: { clientId?: string } }>('/business-profile', {
    preHandler: requirePermission('settings:read'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const clientId = scopeFor(user, request.query.clientId);
      if (!clientId) return reply.code(403).send({ error: 'Forbidden' });

      const { data, error } = await supabase
        .from('clients')
        .select('name, business_profile')
        .eq('id', clientId)
        .maybeSingle();

      if (error) return reply.code(500).send({ error: error.message });
      if (!data) return reply.code(404).send({ error: 'Client not found' });

      const row = data as { name: string; business_profile: Record<string, unknown> | null };
      reply.send({
        // The business name lives on `clients.name` and is not part of the blob:
        // it identifies the tenant everywhere else in the product, so it is
        // shown here but changed through the client record.
        business_name: row.name,
        profile: row.business_profile ?? {},
      });
    },
  });

  /**
   * Replace the profile.
   *
   * A whole-object PUT rather than a PATCH: the form owns every field, so a
   * merge would make "I cleared my address line 2" indistinguishable from "I
   * did not send address line 2", and the field would be impossible to empty.
   */
  app.put<{ Querystring: { clientId?: string } }>('/business-profile', {
    // `account:write`, not `settings:write`. This is the tenant's own record,
    // and `settings:write` is platform-only by construction (022), so gating it
    // there meant the owner whose address this is could never save the form.
    // Migration 037 split the two.
    preHandler: requirePermission('account:write'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const clientId = scopeFor(user, request.query.clientId);
      if (!clientId) return reply.code(403).send({ error: 'Forbidden' });

      const parsed = profileSchema.parse(request.body ?? {});
      // Cleared fields transform to undefined; dropping them keeps the stored
      // blob to what is actually set rather than a wall of nulls.
      const profile = Object.fromEntries(
        Object.entries(parsed).filter(([, v]) => v !== undefined)
      );

      const updated = await withAudit({
        actor: {
          userId: user.sub,
          clientId,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        },
        action: 'client.business_profile.updated',
        entityType: 'client',
        entityId: clientId,
        before: async () => {
          const { data } = await supabase
            .from('clients')
            .select('business_profile')
            .eq('id', clientId)
            .maybeSingle();
          return (data as { business_profile?: Record<string, unknown> } | null)?.business_profile ?? null;
        },
        mutate: async () => {
          const { data, error } = await supabase
            .from('clients')
            .update({ business_profile: profile })
            .eq('id', clientId)
            .select('business_profile')
            .single();
          if (error) throw new Error(error.message);
          return (data as { business_profile: Record<string, unknown> }).business_profile;
        },
      });

      reply.send({ profile: updated });
    },
  });
}
