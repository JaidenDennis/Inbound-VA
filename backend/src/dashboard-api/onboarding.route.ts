import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { onboardingService, withAudit } from '../services/index.js';
import { requirePermission, assertClientAccess, isPlatformUser } from '../middleware/index.js';
import { ONBOARDING_STAGES, ONBOARDING_STATUSES } from '../types/index.js';
import type { JwtPayload, OnboardingStageKey, OnboardingStatus } from '../types/index.js';

const VALID_STAGE_KEYS = new Set(ONBOARDING_STAGES.map((s) => s.key));

const updateSchema = z.object({
  clientId: z.string().uuid(),
  status: z.enum(ONBOARDING_STATUSES as [string, ...string[]]),
});

export async function onboardingRoutes(app: FastifyInstance): Promise<void> {
  // List a client's milestones. Client users see their own tenant; platform
  // staff pass ?clientId to view a specific client.
  app.get<{ Querystring: { clientId?: string } }>('/onboarding', {
    preHandler: requirePermission('clients:read'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const clientId = user.clientId ?? request.query.clientId;
      // Staff who named no client get the estate rollup instead of a 400 —
      // there is no single tenant to scope them to, and the page has to draw
      // something.
      if (!clientId) {
        if (!isPlatformUser(user)) return reply.code(403).send({ error: 'Forbidden' });
        return reply.send({ scope: 'platform', data: await onboardingService.listAllForPlatform() });
      }
      if (!assertClientAccess(user, clientId)) return reply.code(403).send({ error: 'Forbidden' });
      const milestones = await onboardingService.listForClient(clientId);
      reply.send({ scope: 'client', data: milestones });
    },
  });

  // Advance/modify a stage — platform staff only (clients see it read-only).
  app.patch<{ Params: { stageKey: string } }>('/onboarding/:stageKey', {
    preHandler: requirePermission('clients:write'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      if (!isPlatformUser(user)) return reply.code(403).send({ error: 'Forbidden' });
      if (!VALID_STAGE_KEYS.has(request.params.stageKey as OnboardingStageKey)) {
        return reply.code(400).send({ error: 'Unknown stage' });
      }
      const body = updateSchema.parse(request.body);
      const stageKey = request.params.stageKey as OnboardingStageKey;

      const milestone = await withAudit({
        actor: { userId: user.sub, clientId: body.clientId, ipAddress: request.ip, userAgent: request.headers['user-agent'] },
        action: 'onboarding.stage.updated',
        entityType: 'onboarding_milestone',
        before: async () =>
          (await onboardingService.listForClient(body.clientId)).find((m) => m.stage_key === stageKey) ?? null,
        mutate: () => onboardingService.updateStage(body.clientId, stageKey, body.status as OnboardingStatus),
      });

      reply.send(milestone);
    },
  });
}
