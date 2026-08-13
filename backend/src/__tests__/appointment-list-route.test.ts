import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { JwtPayload } from '../types/index.js';

// GET /booking/appointments regression cover.
//
// bookingService.listAppointments shipped with migration 001 and no route ever
// exposed it, so the dashboard bookings page had nothing to call and rendered
// "No appointments found" no matter what was stored. These tests pin the route
// down and, more importantly, pin down the tenant scoping: a client-scoped user
// must never be able to read another tenant's calendar by passing a clientId.

let currentUser: JwtPayload | null = null;

vi.mock('../middleware/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/index.js')>();
  return {
    ...actual,
    requirePermission: () => async (
      request: { user?: JwtPayload },
      reply: { code: (n: number) => { send: (b: unknown) => void } }
    ) => {
      if (!currentUser) return reply.code(401).send({ error: 'Unauthorized' });
      request.user = currentUser;
    },
  };
});

const listAppointments = vi.fn(
  async (_clientId: string, _status?: string) => [
    { id: 'a-1', title: 'Botox', start_time: '2026-08-14T13:00:00Z', status: 'confirmed' },
  ]
);
vi.mock('../booking/index.js', () => ({
  bookingService: {
    listAppointments: (clientId: string, status?: string) => listAppointments(clientId, status),
  },
}));

const { bookingRoutes } = await import('../routes/booking.route.js');

const CLIENT_ID = '5f31ba41-edc8-472c-a0c3-3f5e89639785';
const OTHER_CLIENT = '11111111-2222-3333-4444-555555555555';

function platformUser(): JwtPayload {
  return { sub: 'u1', email: 'admin@x.com', role: 'super_admin', clientId: null, iat: 0, exp: 0 };
}

function scopedUser(clientId: string): JwtPayload {
  return { sub: 'u2', email: 'a@x.com', role: 'client_owner', clientId, iat: 0, exp: 0 };
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: 'Validation failed' });
    }
    reply.code(500).send({ error: 'Internal server error' });
  });
  await app.register(bookingRoutes);
  return app;
}

let app: FastifyInstance;

beforeEach(async () => {
  currentUser = platformUser();
  listAppointments.mockClear();
  app = await buildApp();
});

describe('GET /booking/appointments', () => {
  it('returns the requested client\'s appointments', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/booking/appointments?clientId=${CLIENT_ID}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
    expect(res.json().count).toBe(1);
    expect(listAppointments).toHaveBeenCalledWith(CLIENT_ID, undefined);
  });

  it('passes a status filter through', async () => {
    await app.inject({
      method: 'GET',
      url: `/booking/appointments?clientId=${CLIENT_ID}&status=confirmed`,
    });
    expect(listAppointments).toHaveBeenCalledWith(CLIENT_ID, 'confirmed');
  });

  it('locks a client-scoped user to their own tenant, ignoring the query', async () => {
    currentUser = scopedUser(CLIENT_ID);
    const res = await app.inject({
      method: 'GET',
      url: `/booking/appointments?clientId=${OTHER_CLIENT}`,
    });

    expect(res.statusCode).toBe(200);
    expect(listAppointments).toHaveBeenCalledWith(CLIENT_ID, undefined);
  });

  it('400s when no client can be resolved', async () => {
    const res = await app.inject({ method: 'GET', url: '/booking/appointments' });

    expect(res.statusCode).toBe(400);
    expect(listAppointments).not.toHaveBeenCalled();
  });

  it('401s an unauthenticated caller', async () => {
    currentUser = null;
    const res = await app.inject({
      method: 'GET',
      url: `/booking/appointments?clientId=${CLIENT_ID}`,
    });

    expect(res.statusCode).toBe(401);
    expect(listAppointments).not.toHaveBeenCalled();
  });
});
