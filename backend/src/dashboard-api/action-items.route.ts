import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actionItemService, writeAuditLog } from '../services/index.js';
import { requirePermission, assertClientAccess, isPlatformUser } from '../middleware/index.js';
import { ACTION_ITEM_STATUSES } from '../types/index.js';
import type { JwtPayload, ActionItemStatus } from '../types/index.js';

const createSchema = z.object({
  clientId: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
});

const updateSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(5000).nullable().optional(),
    status: z.enum(ACTION_ITEM_STATUSES as [string, ...string[]]).optional(),
  })
  .refine((b) => b.title !== undefined || b.description !== undefined || b.status !== undefined, {
    message: 'Nothing to update',
  });

export async function actionItemRoutes(app: FastifyInstance): Promise<void> {
  // List a client's action items (own tenant for clients; ?clientId for staff).
  app.get<{ Querystring: { clientId?: string } }>('/action-items', {
    preHandler: requirePermission('clients:read'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const clientId = user.clientId ?? request.query.clientId;
      if (!clientId) return reply.code(400).send({ error: 'clientId is required' });
      if (!assertClientAccess(user, clientId)) return reply.code(403).send({ error: 'Forbidden' });
      const items = await actionItemService.listForClient(clientId);
      reply.send({ data: items });
    },
  });

  // Add an item — staff only ("Owner adds items; client marks them done").
  app.post('/action-items', {
    preHandler: requirePermission('clients:write'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      if (!isPlatformUser(user)) return reply.code(403).send({ error: 'Forbidden' });
      const body = createSchema.parse(request.body);
      const item = await actionItemService.create({
        clientId: body.clientId,
        title: body.title,
        description: body.description,
        createdBy: user.sub,
      });
      await writeAuditLog({
        userId: user.sub,
        clientId: body.clientId,
        action: 'action_item.created',
        entityType: 'client_action_item',
        entityId: item.id,
        newValue: { title: item.title },
        ipAddress: request.ip,
      });
      reply.code(201).send(item);
    },
  });

  // Update an item. Staff may edit title/description/status; a client user may
  // only toggle status (mark their own items done / reopen).
  app.patch<{ Params: { id: string } }>('/action-items/:id', {
    preHandler: requirePermission('clients:read'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const item = await actionItemService.findById(request.params.id);
      if (!item) return reply.code(404).send({ error: 'Not found' });
      if (!assertClientAccess(user, item.client_id)) return reply.code(403).send({ error: 'Forbidden' });

      const body = updateSchema.parse(request.body);
      const isStaff = isPlatformUser(user);
      // Client users own only the status transition, nothing else.
      if (!isStaff && body.status === undefined) {
        return reply.code(403).send({ error: 'You may only change the status' });
      }
      const patch = isStaff
        ? {
            title: body.title,
            description: body.description,
            status: body.status as ActionItemStatus | undefined,
          }
        : { status: body.status as ActionItemStatus };

      const updated = await actionItemService.update(item.id, patch);
      reply.send(updated);
    },
  });
}
