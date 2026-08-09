import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../db/index.js';
import { requirePermission, assertClientAccess } from '../middleware/index.js';
import { clientService, withAudit, integrationHealth } from '../services/index.js';
import type { JwtPayload } from '../types/index.js';

/**
 * Integrations, as one list.
 *
 * Connection state was previously readable only by asking each provider's own
 * endpoint, and only GoHighLevel had one — so the console could not answer
 * "what is this client connected to?" without knowing the answer first.
 *
 * This route reports every provider the platform knows about and where each one
 * stands for a given client, including the ones whose sync logic is not written
 * yet. Those are reported honestly as `available: false` rather than being
 * hidden, so the roadmap is visible and nobody connects something that will
 * silently do nothing.
 */

/**
 * The provider catalogue.
 *
 * `available` means the adapter is wired end to end — OAuth or credentials,
 * push, and sync. Anything false is listed for planning and refuses to connect.
 */
const PROVIDERS = [
  {
    id: 'gohighlevel',
    name: 'GoHighLevel',
    category: 'crm' as const,
    description: 'Contacts, opportunities, and calendar booking in a sub-account.',
    authKind: 'oauth' as const,
    available: true,
  },
  {
    id: 'hubspot',
    name: 'HubSpot',
    category: 'crm' as const,
    description: 'Contacts, deals, and engagement timeline.',
    authKind: 'apiKey' as const,
    available: false,
  },
  {
    id: 'salesforce',
    name: 'Salesforce',
    category: 'crm' as const,
    description: 'Leads, contacts, and tasks in Sales Cloud.',
    authKind: 'oauth' as const,
    available: false,
  },
  {
    id: 'zoho',
    name: 'Zoho CRM',
    category: 'crm' as const,
    description: 'Leads and contacts with per-module field mapping.',
    authKind: 'oauth' as const,
    available: false,
  },
  {
    id: 'webhook',
    name: 'Custom webhook',
    category: 'crm' as const,
    description: 'Post every normalised event to a URL you control.',
    authKind: 'url' as const,
    available: false,
  },
  {
    id: 'google_calendar',
    name: 'Google Calendar',
    category: 'calendar' as const,
    description: 'Read availability and write appointments to a Google calendar.',
    authKind: 'oauth' as const,
    available: false,
  },
  {
    id: 'outlook',
    name: 'Outlook Calendar',
    category: 'calendar' as const,
    description: 'Availability and booking against a Microsoft 365 calendar.',
    authKind: 'oauth' as const,
    available: false,
  },
  {
    id: 'calendly',
    name: 'Calendly',
    category: 'calendar' as const,
    description: 'Hand booking off to an existing Calendly event type.',
    authKind: 'apiKey' as const,
    available: false,
  },
] as const;

export async function connectionRoutes(app: FastifyInstance): Promise<void> {
  function scopeFor(user: JwtPayload, requested?: string): string | null {
    const clientId = user.clientId ?? requested ?? null;
    if (!clientId) return null;
    return assertClientAccess(user, clientId) ? clientId : null;
  }

  app.get<{ Querystring: { clientId?: string } }>('/connections', {
    preHandler: requirePermission('crm:read'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const clientId = scopeFor(user, request.query.clientId);
      if (!clientId) return reply.code(403).send({ error: 'Forbidden' });

      const settings = await clientService.getSettings(clientId);
      const activeCrm = settings?.crm_type ?? 'none';
      const crmConfig = (settings?.crm_config ?? {}) as Record<string, unknown>;

      // A stored credential row is the only honest evidence of a connection —
      // `crm_type` merely records which one is *selected*, and the two disagree
      // whenever someone picks a CRM they never authenticated with.
      const { data: stored } = await supabase
        .from('crm_connections')
        .select('crm_type, is_active, last_sync_at, updated_at')
        .eq('client_id', clientId);

      const storedByType = new Map(
        ((stored ?? []) as Array<{ crm_type: string; is_active: boolean; last_sync_at: string | null; updated_at: string }>)
          .map((row) => [row.crm_type, row])
      );

      const connections = PROVIDERS.map((p) => {
        const row = storedByType.get(p.id);
        return {
          ...p,
          connected: !!row && row.is_active,
          isActiveCrm: activeCrm === p.id,
          lastSyncAt: row?.last_sync_at ?? null,
          lastUpdated: row?.updated_at ?? null,
          // Selected as the sync target without a credential behind it. This is
          // a real misconfiguration and the UI calls it out.
          configuredWithoutCredential:
            activeCrm === p.id && !row && Object.keys(crmConfig).length === 0,
        };
      });

      // Per-channel health alongside the catalogue, not as a separate route:
      // "what am I connected to" and "is it working" are the same question asked
      // twice, and answering them on two screens is how a stalled integration
      // survives a review.
      reply.send({ data: connections, activeCrm, health: await integrationHealth(clientId) });
    },
  });

  /**
   * Choose which connected CRM the sync workers should push to.
   *
   * Selecting a provider is separate from authenticating with it: a client can
   * have several connected and only one receiving contacts. Unavailable
   * providers are refused here rather than in the UI, so the rule holds no
   * matter what calls the API.
   */
  app.post<{ Querystring: { clientId?: string } }>('/connections/active', {
    preHandler: requirePermission('crm:write'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const clientId = scopeFor(user, request.query.clientId);
      if (!clientId) return reply.code(403).send({ error: 'Forbidden' });

      const body = z.object({ provider: z.string().min(1) }).parse(request.body);
      const provider = PROVIDERS.find((p) => p.id === body.provider);

      if (body.provider !== 'none' && !provider) {
        return reply.code(400).send({ error: `Unknown provider "${body.provider}"` });
      }
      if (provider && !provider.available) {
        return reply.code(400).send({
          error: `${provider.name} is not available yet. Its adapter is registered but the sync path is not built, so selecting it would drop every contact silently.`,
        });
      }
      if (provider && provider.category !== 'crm') {
        return reply.code(400).send({ error: 'Only a CRM can be the active sync target.' });
      }

      try {
        await withAudit<{ crm_type: string | null }>({
          actor: { userId: user.sub, clientId, ipAddress: request.ip, userAgent: request.headers['user-agent'] },
          action: 'crm.active.changed',
          entityType: 'client_settings',
          entityId: clientId,
          before: async () => ({ crm_type: (await clientService.getSettings(clientId))?.crm_type ?? null }),
          mutate: async () => {
            const { error } = await supabase
              .from('client_settings')
              .update({ crm_type: body.provider })
              .eq('client_id', clientId);
            if (error) throw new Error(error.message);
            return { crm_type: body.provider };
          },
        });
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }

      reply.send({ ok: true, activeCrm: body.provider });
    },
  });
}
