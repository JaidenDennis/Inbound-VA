import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { bookingService } from '../booking/index.js';
import { requirePermission, assertClientAccess } from '../middleware/index.js';
import type { JwtPayload } from '../types/index.js';

const createSchema = z.object({
  clientId: z.string().uuid(),
  contactId: z.string().uuid(),
  callId: z.string().uuid().optional(),
  title: z.string().min(1),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  timezone: z.string(),
  serviceType: z.string().optional(),
  notes: z.string().optional(),
});

const cancelSchema = z.object({
  appointmentId: z.string().uuid(),
  reason: z.string().optional(),
});

const updateSchema = z.object({
  appointmentId: z.string().uuid(),
  newStartTime: z.string().datetime(),
  newEndTime: z.string().datetime(),
  reason: z.string().optional(),
});

export async function bookingRoutes(app: FastifyInstance): Promise<void> {
  app.post('/booking/create', {
    preHandler: requirePermission('bookings:write'),
    handler: async (request, reply) => {
      const body = createSchema.parse(request.body);
      const user = request.user as JwtPayload;
      if (!assertClientAccess(user, body.clientId)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const appointment = await bookingService.createAppointment({
        ...body,
        startTime: new Date(body.startTime),
        endTime: new Date(body.endTime),
      });
      reply.code(201).send(appointment);
    },
  });

  app.post('/booking/cancel', {
    preHandler: requirePermission('bookings:write'),
    handler: async (request, reply) => {
      const body = cancelSchema.parse(request.body);
      const user = request.user as JwtPayload;
      const existing = await bookingService.getAppointment(body.appointmentId);
      if (!existing) return reply.code(404).send({ error: 'Not found' });
      if (!assertClientAccess(user, existing.client_id)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const appointment = await bookingService.cancelAppointment(body.appointmentId, body.reason);
      reply.send(appointment);
    },
  });

  app.post('/booking/update', {
    preHandler: requirePermission('bookings:write'),
    handler: async (request, reply) => {
      const body = updateSchema.parse(request.body);
      const user = request.user as JwtPayload;
      const existing = await bookingService.getAppointment(body.appointmentId);
      if (!existing) return reply.code(404).send({ error: 'Not found' });
      if (!assertClientAccess(user, existing.client_id)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const appointment = await bookingService.rescheduleAppointment({
        appointmentId: body.appointmentId,
        newStartTime: new Date(body.newStartTime),
        newEndTime: new Date(body.newEndTime),
        reason: body.reason,
      });
      reply.send(appointment);
    },
  });

  app.get<{ Querystring: { clientId: string; date: string; timezone?: string } }>(
    '/booking/availability',
    {
      preHandler: requirePermission('bookings:read'),
      handler: async (request, reply) => {
        const user = request.user as JwtPayload;
        // Client-scoped users are locked to their own tenant regardless of query.
        const clientId = user.clientId ?? request.query.clientId;
        if (!clientId) return reply.code(400).send({ error: 'clientId required' });
        if (!assertClientAccess(user, clientId)) {
          return reply.code(403).send({ error: 'Forbidden' });
        }
        const slots = await bookingService.getAvailability({ clientId, date: request.query.date, timezone: request.query.timezone });
        reply.send(slots);
      },
    }
  );
}
