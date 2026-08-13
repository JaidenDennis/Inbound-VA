import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actionItemService, writeAuditLog, withAudit } from '../services/index.js';
import { requirePermission, assertClientAccess, isPlatformUser } from '../middleware/index.js';
import { ACTION_ITEM_STATUSES, ACTION_ITEM_CATEGORIES } from '../types/index.js';
import type { JwtPayload, ActionItemStatus, ActionItemCategory } from '../types/index.js';

const createSchema = z.object({
  clientId: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  // Omitted means 'operations' — see migration 033. Onboarding is the narrow
  // case and names itself; ongoing work is the default.
  category: z.enum(ACTION_ITEM_CATEGORIES as [string, ...string[]]).optional(),
});

const listSchema = z.object({
  clientId: z.string().uuid().optional(),
  category: z.enum(ACTION_ITEM_CATEGORIES as [string, ...string[]]).optional(),
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
  app.get<{ Querystring: { clientId?: string; category?: string } }>('/action-items', {
    preHandler: requirePermission('clients:read'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const query = listSchema.parse(request.query);
      const category = query.category as ActionItemCategory | undefined;
      const clientId = user.clientId ?? query.clientId;
      // Staff with no client named see every client's items rather than a 400.
      if (!clientId) {
        if (!isPlatformUser(user)) return reply.code(403).send({ error: 'Forbidden' });
        return reply.send({ scope: 'platform', data: await actionItemService.listAllForPlatform() });
      }
      if (!assertClientAccess(user, clientId)) return reply.code(403).send({ error: 'Forbidden' });
      const items = await actionItemService.listForClient(clientId, category);
      reply.send({ scope: 'client', data: items });
    },
  });

  // Add an item — staff only ("Owner adds items; client marks them done").
  app.post('/action-items', {
    preHandler: requirePermission('clients:write'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      if (!isPlatformUser(user)) return reply.code(403).send({ error: 'Forbidden' });
      const body = createSchema.parse(request.body);

      const item = await withAudit({
        actor: { userId: user.sub, clientId: body.clientId, ipAddress: request.ip, userAgent: request.headers['user-agent'] },
        action: 'action_item.created',
        entityType: 'client_action_item',
        // Nothing existed before a create. Stated explicitly rather than left to
        // the wrapper's default so the null is a decision, not an omission.
        before: async () => null,
        mutate: () =>
          actionItemService.create({
            clientId: body.clientId,
            title: body.title,
            description: body.description,
            createdBy: user.sub,
            category: body.category as ActionItemCategory | undefined,
          }),
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
