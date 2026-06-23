import type { FastifyInstance } from 'fastify';
import { callRecordService } from '../services/index.js';
import { requirePermission, assertClientAccess } from '../middleware/index.js';
import type { JwtPayload } from '../types/index.js';

export async function statsRoutes(app: FastifyInstance): Promise<void> {
  // Near-real-time call stats from call_records. Tenant-scoped: client users see
  // only their own; platform users may pass ?clientId. The "only after go-live"
  // gate is applied in the dashboard UI (this just returns the aggregates).
  app.get<{ Querystring: { clientId?: string; from?: string; to?: string } }>('/stats', {
    preHandler: requirePermission('analytics:read'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const clientId = user.clientId ?? request.query.clientId;
      if (!clientId) return reply.code(400).send({ error: 'clientId is required' });
      if (!assertClientAccess(user, clientId)) return reply.code(403).send({ error: 'Forbidden' });

      const from = request.query.from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const to = request.query.to ?? new Date().toISOString();

      const stats = await callRecordService.getStats(clientId, from, to);
      reply.send({ period: { from, to }, ...stats });
    },
  });
}
