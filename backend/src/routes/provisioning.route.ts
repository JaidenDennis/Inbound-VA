import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { provisioningService } from '../services/index.js';
import { requirePermission, assertClientAccess } from '../middleware/index.js';
import { env } from '../config/index.js';
import type { JwtPayload } from '../types/index.js';

const provisionSchema = z.object({
  template: z.string().optional(),
  phoneNumbers: z.array(z.string()).optional(),
  buyAreaCode: z.number().int().optional(),
});

export async function provisioningRoutes(app: FastifyInstance): Promise<void> {
  // Idempotently create/update the client's Retell agent from its settings.
  app.post<{ Params: { id: string } }>('/clients/:id/provision', {
    preHandler: requirePermission('settings:write'),
    // Provisioning triggers paid Retell API calls; cap it per IP on top of auth.
    config: {
      rateLimit: {
        max: env.PROVISION_RATE_LIMIT_MAX,
        timeWindow: env.RATE_LIMIT_WINDOW_MS,
      },
    },
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      if (!assertClientAccess(user, request.params.id)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const body = provisionSchema.parse(request.body ?? {});
      try {
        const result = await provisioningService.provisionClient(request.params.id, {
          template: body.template,
          phoneNumbers: body.phoneNumbers,
          buyAreaCode: body.buyAreaCode,
          userId: user.sub,
        });
        reply.send(result);
      } catch (err) {
        request.log.error({ err, clientId: request.params.id }, 'Provisioning failed');
        reply.code(502).send({ error: (err as Error).message });
      }
    },
  });
}
