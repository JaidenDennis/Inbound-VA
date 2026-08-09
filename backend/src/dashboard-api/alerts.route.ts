import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../db/index.js';
import { requirePermission, assertClientAccess, resolveClientScope, isPlatformUser } from '../middleware/index.js';
import { withAudit } from '../services/index.js';
import { ALERT_METRICS, metricLabel } from '../services/alert.service.js';
import {
  readBranding,
  writeBranding,
  BrandingError,
} from '../services/branding.service.js';
import type { JwtPayload } from '../types/index.js';

/**
 * Alert rules and branding — the two things a tenant configures that are not
 * about the agent itself.
 *
 * Both sit behind `configure:alerts` and `settings:write` respectively, and both
 * go through `withAudit`: they are configure-axis writes, and
 * `audit-coverage.test.ts` will fail the build if they stop being.
 */

const ruleSchema = z.object({
  metric: z.enum(ALERT_METRICS as unknown as [string, ...string[]]),
  threshold: z.number(),
  windowMinutes: z.number().int().min(5).max(43200).default(1440),
  cooldownMinutes: z.number().int().min(5).max(43200).default(1440),
  enabled: z.boolean().default(true),
  recipients: z.array(z.string().email()).max(20).default([]),
});

const brandingSchema = z.object({
  logo_url: z.string().max(500).nullable().optional(),
  primary_hex: z.string().max(7).nullable().optional(),
  wordmark_text: z.string().max(40).nullable().optional(),
});

export async function alertRoutes(app: FastifyInstance): Promise<void> {
  function scopeFor(user: JwtPayload, requested?: string): string | null {
    const clientId = resolveClientScope(user, requested);
    if (!clientId) return null;
    return assertClientAccess(user, clientId) ? clientId : null;
  }

  /** Rules for one tenant, with the metric catalogue so the UI never hardcodes it. */
  app.get<{ Querystring: { clientId?: string } }>('/alerts', {
    preHandler: requirePermission('analytics:read'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const clientId = scopeFor(user, request.query.clientId);
      if (!clientId) return reply.code(400).send({ error: 'clientId is required' });

      const [{ data: rules }, { data: recent }] = await Promise.all([
        supabase
          .from('client_alert_rules')
          .select('id, metric, threshold, window_minutes, cooldown_minutes, enabled, recipients, last_fired_at')
          .eq('client_id', clientId)
          .order('metric'),
        // What actually fired. An alert loop nobody can inspect is one nobody
        // trusts, and "did it ever fire?" is the first question asked of it.
        supabase
          .from('client_alert_events')
          .select('id, metric, observed, threshold, message, notified, created_at')
          .eq('client_id', clientId)
          .order('created_at', { ascending: false })
          .limit(20),
      ]);

      reply.send({
        data: rules ?? [],
        recent: recent ?? [],
        metrics: ALERT_METRICS.map((m) => ({ metric: m, label: metricLabel(m) })),
      });
    },
  });

  /**
   * Create or update the rule for one metric.
   *
   * Upsert on (client_id, metric): a tenant does not want two containment rules,
   * they want one with the right threshold, and two means two emails.
   */
  app.put<{ Querystring: { clientId?: string } }>('/alerts', {
    preHandler: requirePermission('configure:alerts'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const clientId = scopeFor(user, request.query.clientId);
      if (!clientId) return reply.code(400).send({ error: 'clientId is required' });

      const body = ruleSchema.parse(request.body);

      const saved = await withAudit({
        actor: { userId: user.sub, clientId, ipAddress: request.ip, userAgent: request.headers['user-agent'] },
        action: 'alert.rule.saved',
        entityType: 'client_alert_rules',
        before: async () => {
          const { data } = await supabase
            .from('client_alert_rules')
            .select('metric, threshold, window_minutes, cooldown_minutes, enabled, recipients')
            .eq('client_id', clientId)
            .eq('metric', body.metric)
            .maybeSingle();
          return data as Record<string, unknown> | null;
        },
        mutate: async () => {
          const { data, error } = await supabase
            .from('client_alert_rules')
            .upsert(
              {
                client_id: clientId,
                metric: body.metric,
                threshold: body.threshold,
                window_minutes: body.windowMinutes,
                cooldown_minutes: body.cooldownMinutes,
                enabled: body.enabled,
                recipients: body.recipients,
                created_by: user.sub,
                updated_at: new Date().toISOString(),
              },
              { onConflict: 'client_id,metric' }
            )
            .select('metric, threshold, window_minutes, cooldown_minutes, enabled, recipients')
            .single();
          if (error) throw new Error(error.message);
          return data as Record<string, unknown>;
        },
      });

      reply.send(saved);
    },
  });

  app.delete<{ Params: { metric: string }; Querystring: { clientId?: string } }>('/alerts/:metric', {
    preHandler: requirePermission('configure:alerts'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const clientId = scopeFor(user, request.query.clientId);
      if (!clientId) return reply.code(400).send({ error: 'clientId is required' });

      await withAudit<Record<string, unknown> | null>({
        actor: { userId: user.sub, clientId, ipAddress: request.ip, userAgent: request.headers['user-agent'] },
        action: 'alert.rule.deleted',
        entityType: 'client_alert_rules',
        before: async () => {
          const { data } = await supabase
            .from('client_alert_rules')
            .select('metric, threshold, enabled')
            .eq('client_id', clientId)
            .eq('metric', request.params.metric)
            .maybeSingle();
          return data as Record<string, unknown> | null;
        },
        mutate: async () => {
          await supabase
            .from('client_alert_rules')
            .delete()
            .eq('client_id', clientId)
            .eq('metric', request.params.metric);
          return null;
        },
      });

      reply.send({ ok: true });
    },
  });

  /* ---------------------------------------------------------------- branding */

  app.get<{ Querystring: { clientId?: string } }>('/branding', {
    preHandler: requirePermission('settings:read'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const clientId = scopeFor(user, request.query.clientId);
      if (!clientId) return reply.code(400).send({ error: 'clientId is required' });

      reply.send(await readBranding(clientId));
    },
  });

  /**
   * Branding is staff-only.
   *
   * Not because a client cannot be trusted with their own logo, but because the
   * accent rule needs explaining when it rejects something, and that conversation
   * belongs with whoever is onboarding them. The rejection message says why —
   * see branding.service.ts.
   */
  app.put<{ Querystring: { clientId?: string } }>('/branding', {
    preHandler: requirePermission('settings:write'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      if (!isPlatformUser(user)) return reply.code(403).send({ error: 'Forbidden' });

      const clientId = scopeFor(user, request.query.clientId);
      if (!clientId) return reply.code(400).send({ error: 'clientId is required' });

      const body = brandingSchema.parse(request.body);

      try {
        const saved = await withAudit({
          actor: { userId: user.sub, clientId, ipAddress: request.ip, userAgent: request.headers['user-agent'] },
          action: 'branding.updated',
          entityType: 'clients',
          entityId: clientId,
          before: () => readBranding(clientId),
          mutate: () => writeBranding(clientId, body),
        });
        reply.send(saved);
      } catch (err) {
        if (err instanceof BrandingError) {
          // 422, not 400: the payload is well-formed and the value is refused on
          // a design rule the message explains.
          return reply.code(422).send({ error: err.message, code: err.code });
        }
        throw err;
      }
    },
  });
}
