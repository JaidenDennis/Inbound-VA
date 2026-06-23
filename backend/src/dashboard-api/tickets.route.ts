import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ticketService, clientService, writeAuditLog } from '../services/index.js';
import { requirePermission, assertClientAccess, isPlatformUser } from '../middleware/index.js';
import { notify } from '../notify/index.js';
import { env } from '../config/index.js';
import { logger } from '../utils/index.js';
import { TICKET_PRIORITIES, TICKET_STATUSES } from '../types/index.js';
import type { JwtPayload } from '../types/index.js';

const createTicketSchema = z.object({
  subject: z.string().min(1).max(200),
  description: z.string().max(5000).default(''),
  priority: z.enum(TICKET_PRIORITIES as [string, ...string[]]).default('normal'),
  // Platform users may file on behalf of a tenant; client users are pinned to their own.
  clientId: z.string().uuid().optional(),
});

const messageSchema = z.object({ body: z.string().min(1).max(5000) });

const patchSchema = z
  .object({
    status: z.enum(TICKET_STATUSES as [string, ...string[]]).optional(),
    assignedTo: z.string().uuid().nullable().optional(),
    note: z.string().optional(),
  })
  .refine((b) => b.status !== undefined || b.assignedTo !== undefined, {
    message: 'Provide status and/or assignedTo',
  });

export async function ticketRoutes(app: FastifyInstance): Promise<void> {
  // List tickets — client users see only their tenant; platform users see all
  // (optionally filtered by clientId). The tenant scoping is the active boundary.
  app.get<{ Querystring: { status?: string; clientId?: string; page?: string } }>('/tickets', {
    preHandler: requirePermission('tickets:read'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const clientId = user.clientId ?? request.query.clientId ?? null;
      if (user.clientId && !assertClientAccess(user, clientId)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const result = await ticketService.list({
        clientId,
        status: request.query.status,
        page: Number(request.query.page ?? 1),
      });
      reply.send(result);
    },
  });

  // One ticket with its Conversation (messages) + History (status trail).
  app.get<{ Params: { id: string } }>('/tickets/:id', {
    preHandler: requirePermission('tickets:read'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const ticket = await ticketService.findById(request.params.id);
      if (!ticket) return reply.code(404).send({ error: 'Not found' });
      if (!assertClientAccess(user, ticket.client_id)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const [messages, history] = await Promise.all([
        ticketService.getMessages(ticket.id),
        ticketService.getHistory(ticket.id),
      ]);
      reply.send({ ...ticket, messages, history });
    },
  });

  // Create → insert + initial history row, THEN fire the notification. A failed
  // notification must never fail the client's submission (logged + swallowed).
  app.post('/tickets', {
    preHandler: requirePermission('tickets:write'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const body = createTicketSchema.parse(request.body);

      let clientId: string;
      if (isPlatformUser(user)) {
        if (!body.clientId) return reply.code(400).send({ error: 'clientId is required' });
        clientId = body.clientId;
      } else {
        clientId = user.clientId as string;
        if (body.clientId && body.clientId !== clientId) {
          return reply.code(403).send({ error: 'Cannot create a ticket for another client' });
        }
      }

      // Validate the tenant exists BEFORE inserting — a bad clientId would
      // otherwise surface as a 500 FK violation. The lookup is reused for the alert.
      const client = await clientService.findById(clientId);
      if (!client) return reply.code(404).send({ error: 'Client not found' });

      const ticket = await ticketService.create({
        clientId,
        createdBy: user.sub,
        subject: body.subject,
        description: body.description,
        priority: body.priority as typeof TICKET_PRIORITIES[number],
      });

      // Best-effort alert. .catch keeps a down channel from failing the request.
      void notify({
        title: '🎫 New support ticket',
        fields: [
          { label: 'Client', value: client.name },
          { label: 'Subject', value: ticket.subject },
          { label: 'Priority', value: ticket.priority },
        ],
        url: `${env.DASHBOARD_URL}/dashboard/support/${ticket.id}`,
      }).catch((err) => logger.error({ err, ticketId: ticket.id }, 'Ticket notification failed'));

      await writeAuditLog({
        userId: user.sub,
        clientId,
        action: 'ticket.created',
        entityType: 'ticket',
        entityId: ticket.id,
        newValue: { subject: ticket.subject, priority: ticket.priority },
        ipAddress: request.ip,
      });
      reply.code(201).send(ticket);
    },
  });

  // Append a message to the Conversation thread (client or staff).
  app.post<{ Params: { id: string } }>('/tickets/:id/messages', {
    preHandler: requirePermission('tickets:write'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const ticket = await ticketService.findById(request.params.id);
      if (!ticket) return reply.code(404).send({ error: 'Not found' });
      if (!assertClientAccess(user, ticket.client_id)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const { body } = messageSchema.parse(request.body);
      const message = await ticketService.addMessage({ ticketId: ticket.id, authorId: user.sub, body });
      reply.code(201).send(message);
    },
  });

  // Triage: assign and/or change status. Staff-only (platform users). A status
  // change writes a ticket_status_history row via the service.
  app.patch<{ Params: { id: string } }>('/tickets/:id', {
    preHandler: requirePermission('tickets:write'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      if (!isPlatformUser(user)) return reply.code(403).send({ error: 'Forbidden' });

      const ticket = await ticketService.findById(request.params.id);
      if (!ticket) return reply.code(404).send({ error: 'Not found' });
      const body = patchSchema.parse(request.body);

      let updated = ticket;
      if (body.status && body.status !== ticket.status) {
        updated = await ticketService.changeStatus({
          ticketId: ticket.id,
          fromStatus: ticket.status,
          toStatus: body.status as typeof TICKET_STATUSES[number],
          changedBy: user.sub,
          note: body.note,
        });
      }
      if (body.assignedTo !== undefined) {
        updated = await ticketService.assign({ ticketId: ticket.id, assignedTo: body.assignedTo });
      }

      await writeAuditLog({
        userId: user.sub,
        clientId: ticket.client_id,
        action: 'ticket.updated',
        entityType: 'ticket',
        entityId: ticket.id,
        oldValue: { status: ticket.status, assigned_to: ticket.assigned_to },
        newValue: { status: updated.status, assigned_to: updated.assigned_to },
        ipAddress: request.ip,
      });
      reply.send(updated);
    },
  });
}
