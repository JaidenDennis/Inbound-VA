import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../db/index.js';
import { getCrmAdapter } from '../crm/index.js';
import { resolveAdapterConfig } from '../crm/credentials.js';
import { activeGhlConnection } from '../crm/ghl-connection.js';
import {
  buildInstallUrl,
  exchangeCode,
  signOAuthState,
  verifyOAuthState,
} from '../crm/gohighlevel-oauth.service.js';
import type { GhlPipeline, GhlCalendar } from '../crm/adapters/gohighlevel.adapter.js';
import { encrypt, logger } from '../utils/index.js';
import { env } from '../config/index.js';
import { requirePermission, assertClientAccess } from '../middleware/index.js';
import type { CrmConnection, JwtPayload } from '../types/index.js';

// GoHighLevel marketplace OAuth flow + sub-account discovery endpoints.
//
//   1. Dashboard asks /install for a signed authorize URL and sends the user
//      to GHL, where they pick the sub-account (Location) to install on.
//   2. GHL redirects the browser to /callback (unauthenticated — the signed
//      state is what binds the code to a tenant); tokens are exchanged and
//      stored encrypted on crm_connections.
//   3. Dashboard lists pipelines/calendars and saves the selection via
//      /config. Pipelines/fields/tags can also be created in bulk from a
//      blueprint via POST /crm/ghl/provision (crm-provisioning.route.ts).

const configSchema = z.object({
  pipelineId: z.string().min(1).optional(),
  stageId: z.string().min(1).optional(),
  calendarId: z.string().min(1).optional(),
});

interface GhlDiscovery {
  listPipelines(): Promise<GhlPipeline[]>;
  listCalendars(): Promise<GhlCalendar[]>;
}

async function ghlAdapterFor(conn: CrmConnection): Promise<GhlDiscovery> {
  const config = await resolveAdapterConfig(conn);
  return getCrmAdapter('gohighlevel', config) as unknown as GhlDiscovery;
}

export async function crmOAuthRoutes(app: FastifyInstance): Promise<void> {
  // Step 1: signed authorize URL. The dashboard opens it in the browser.
  app.get('/crm/gohighlevel/oauth/install', {
    preHandler: requirePermission('crm:write'),
    handler: async (request, reply) => {
      const query = z.object({ clientId: z.string().uuid() }).parse(request.query);
      if (!assertClientAccess(request.user as JwtPayload, query.clientId)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      try {
        reply.send({ url: buildInstallUrl(signOAuthState(query.clientId)) });
      } catch (err) {
        // Missing GHL_CLIENT_ID/SECRET — configuration, not client, error.
        reply.code(503).send({ error: (err as Error).message });
      }
    },
  });

  // Step 2: OAuth redirect target. No JWT — GHL sends the user's browser here;
  // the HMAC-signed, expiring state is the tenant binding. Always redirects
  // back to the dashboard with an outcome flag.
  // Path uses "level" because the GHL marketplace rejects redirect URLs that
  // contain brand references ("highlevel", "ghl").
  app.get('/crm/level/oauth/callback', async (request, reply) => {
    const redirectBack = (params: Record<string, string>) =>
      reply.redirect(`${env.DASHBOARD_URL}/dashboard/crm?${new URLSearchParams(params).toString()}`);

    const query = z.object({ code: z.string().min(1), state: z.string().min(1) }).safeParse(request.query);
    if (!query.success) return redirectBack({ ghl: 'error', reason: 'missing_code_or_state' });

    const clientId = verifyOAuthState(query.data.state);
    if (!clientId) return redirectBack({ ghl: 'error', reason: 'invalid_or_expired_state' });

    try {
      const credentials = await exchangeCode(query.data.code);
      const { error } = await supabase
        .from('crm_connections')
        .upsert({
          client_id: clientId,
          crm_type: 'gohighlevel',
          credentials_encrypted: encrypt(JSON.stringify(credentials)),
          is_active: true,
          // A fresh install always yields working tokens — clear any 401 flag.
          needs_reauth: false,
        }, { onConflict: 'client_id,crm_type' });
      if (error) {
        logger.error({ clientId, error: error.message }, 'Failed to store GHL connection');
        return redirectBack({ ghl: 'error', reason: 'storage_failed' });
      }
      logger.info({ clientId, locationId: credentials.locationId }, 'GoHighLevel connected');
      return redirectBack({ ghl: 'connected', locationId: credentials.locationId });
    } catch (err) {
      logger.error({ clientId, err }, 'GHL OAuth code exchange failed');
      return redirectBack({ ghl: 'error', reason: 'token_exchange_failed' });
    }
  });

  // Connection status for the dashboard (never exposes credentials).
  app.get<{ Params: { clientId: string } }>('/crm/:clientId/gohighlevel/status', {
    preHandler: requirePermission('crm:read'),
    handler: async (request, reply) => {
      if (!assertClientAccess(request.user as JwtPayload, request.params.clientId)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const conn = await activeGhlConnection(request.params.clientId);
      if (!conn) return reply.send({ connected: false });
      reply.send({
        connected: true,
        needsReauth: conn.needs_reauth,
        pipelineId: conn.pipeline_id,
        stageId: (conn.crm_config as Record<string, unknown> | null)?.stageId ?? null,
        calendarId: (conn.crm_config as Record<string, unknown> | null)?.calendarId ?? null,
        lastSyncAt: conn.last_sync_at,
      });
    },
  });

  // Step 3a: discovery — pipelines/stages and calendars from the connected
  // sub-account, so the dashboard can offer pickers.
  app.get<{ Params: { clientId: string } }>('/crm/:clientId/gohighlevel/pipelines', {
    preHandler: requirePermission('crm:read'),
    handler: async (request, reply) => {
      if (!assertClientAccess(request.user as JwtPayload, request.params.clientId)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const conn = await activeGhlConnection(request.params.clientId);
      if (!conn) return reply.code(404).send({ error: 'No active GoHighLevel connection' });
      reply.send(await (await ghlAdapterFor(conn)).listPipelines());
    },
  });

  app.get<{ Params: { clientId: string } }>('/crm/:clientId/gohighlevel/calendars', {
    preHandler: requirePermission('crm:read'),
    handler: async (request, reply) => {
      if (!assertClientAccess(request.user as JwtPayload, request.params.clientId)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const conn = await activeGhlConnection(request.params.clientId);
      if (!conn) return reply.code(404).send({ error: 'No active GoHighLevel connection' });
      reply.send(await (await ghlAdapterFor(conn)).listCalendars());
    },
  });

  // Step 3b: persist the chosen pipeline/stage/calendar on the connection.
  app.post<{ Params: { clientId: string } }>('/crm/:clientId/gohighlevel/config', {
    preHandler: requirePermission('crm:write'),
    handler: async (request, reply) => {
      if (!assertClientAccess(request.user as JwtPayload, request.params.clientId)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const body = configSchema.parse(request.body);
      const conn = await activeGhlConnection(request.params.clientId);
      if (!conn) return reply.code(404).send({ error: 'No active GoHighLevel connection' });

      const crmConfig = {
        ...((conn.crm_config as Record<string, unknown> | null) ?? {}),
        ...(body.stageId !== undefined ? { stageId: body.stageId } : {}),
        ...(body.calendarId !== undefined ? { calendarId: body.calendarId } : {}),
      };
      const { error } = await supabase
        .from('crm_connections')
        .update({
          ...(body.pipelineId !== undefined ? { pipeline_id: body.pipelineId } : {}),
          crm_config: crmConfig,
          updated_at: new Date().toISOString(),
        })
        .eq('id', conn.id);
      if (error) return reply.code(500).send({ error: error.message });
      reply.send({ ok: true });
    },
  });
}
