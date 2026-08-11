import { describe, it, expect, vi, beforeEach } from 'vitest';

const svc = vi.hoisted(() => ({
  findById: vi.fn(),
  update: vi.fn(),
  findByEmail: vi.fn(),
}));
const audit = vi.hoisted(() => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../services/index.js', () => ({
  userService: svc,
  withAudit: vi.fn(async (o: { mutate: () => Promise<unknown> }) => o.mutate()),
  writeAuditLog: audit.writeAuditLog,
}));

vi.mock('../middleware/index.js', () => ({
  // requireAuth is a factory in the real module (see auth.middleware.ts), just
  // like requirePermission below — it must be CALLED to produce the
  // preHandler. Mocking it as a bare `vi.fn()` (or as the preHandler itself)
  // would hand Fastify the wrong shape; a bare `vi.fn()` in particular reads
  // as callback-style (arity 3) and hangs the request forever.
  requireAuth: () => async (_req: unknown, _reply: unknown) => undefined,
  requirePermission: () => async (_req: unknown, _reply: unknown) => undefined,
  assertClientAccess: (actor: { clientId?: string | null }, clientId: string | null) =>
    !actor.clientId || actor.clientId === clientId,
  isPlatformUser: (actor: { clientId?: string | null }) => !actor.clientId,
}));

import Fastify from 'fastify';
import { userRoutes } from '../dashboard-api/users.route.js';

const PLATFORM = { sub: 'staff-1', clientId: null, role: 'super_admin' };
const CLIENT_ADMIN = { sub: 'ca-1', clientId: 'client-a', role: 'client_admin' };

async function build(actor: Record<string, unknown>) {
  const app = Fastify();
  // @fastify/jwt's module augmentation types `request.user` as
  // `string | object | Buffer` (no `FastifyJWT.user` override in this repo),
  // which rejects `null` under strict mode even though it's exactly what a
  // fresh decorator holds before the preHandler below overwrites it.
  app.decorateRequest('user', null as any);
  app.addHook('preHandler', async (req) => {
    (req as unknown as { user: unknown }).user = actor;
  });
  await app.register(userRoutes);
  return app;
}

describe('user editing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    svc.findByEmail.mockResolvedValue(null);
    svc.update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
      id: 'u-1', email: 'new@example.com', role: 'client_viewer', is_active: true, ...patch,
    }));
  });

  it('lets platform staff change a user email', async () => {
    svc.findById.mockResolvedValue({ id: 'u-1', client_id: 'client-a', role: 'client_viewer', is_active: true });
    const app = await build(PLATFORM);

    const res = await app.inject({
      method: 'PATCH', url: '/users/u-1', payload: { email: 'new@example.com' },
    });

    expect(res.statusCode).toBe(200);
    expect(svc.update).toHaveBeenCalledWith('u-1', expect.objectContaining({ email: 'new@example.com' }));
  });

  it('rejects an email already used by someone else with 409, not 500', async () => {
    svc.findById.mockResolvedValue({ id: 'u-1', client_id: 'client-a', role: 'client_viewer', is_active: true });
    svc.findByEmail.mockResolvedValue({ id: 'u-2' });
    const app = await build(PLATFORM);

    const res = await app.inject({
      method: 'PATCH', url: '/users/u-1', payload: { email: 'taken@example.com' },
    });

    expect(res.statusCode).toBe(409);
    expect(svc.update).not.toHaveBeenCalled();
  });

  it('maps a lost race on email uniqueness to 409, not 500', async () => {
    // Pre-check passes (no clash seen yet), but the update itself loses a
    // concurrent race and the DB constraint fires — this is what F1 covers:
    // without a try/catch around userService.update, this thrown Error has
    // no statusCode, so app.setErrorHandler falls through to a 500.
    svc.findById.mockResolvedValue({
      id: 'u-1', client_id: 'client-a', role: 'client_viewer', is_active: true, email: 'old@example.com',
    });
    svc.findByEmail.mockResolvedValue(null);
    svc.update.mockRejectedValueOnce(new Error('A user with that email already exists'));
    const app = await build(PLATFORM);

    const res = await app.inject({
      method: 'PATCH', url: '/users/u-1', payload: { email: 'race@example.com' },
    });

    expect(res.statusCode).toBe(409);
  });

  it('records the email transition in the audit log', async () => {
    svc.findById.mockResolvedValue({
      id: 'u-1', client_id: 'client-a', role: 'client_viewer', is_active: true, email: 'old@example.com',
    });
    const app = await build(PLATFORM);

    await app.inject({
      method: 'PATCH', url: '/users/u-1', payload: { email: 'new@example.com' },
    });

    expect(audit.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      oldValue: expect.objectContaining({ email: 'old@example.com' }),
      newValue: expect.objectContaining({ email: 'new@example.com' }),
    }));
  });

  it('allows re-saving a user with their own unchanged email', async () => {
    svc.findById.mockResolvedValue({ id: 'u-1', client_id: 'client-a', role: 'client_viewer', is_active: true });
    svc.findByEmail.mockResolvedValue({ id: 'u-1' }); // themselves
    const app = await build(PLATFORM);

    const res = await app.inject({
      method: 'PATCH', url: '/users/u-1', payload: { email: 'same@example.com' },
    });

    expect(res.statusCode).toBe(200);
  });

  it('refuses to let anyone change their OWN role', async () => {
    svc.findById.mockResolvedValue({ id: 'ca-1', client_id: 'client-a', role: 'client_viewer', is_active: true });
    const app = await build(CLIENT_ADMIN);

    const res = await app.inject({
      method: 'PATCH', url: '/users/ca-1', payload: { role: 'client_admin' },
    });

    expect(res.statusCode).toBe(403);
    expect(svc.update).not.toHaveBeenCalled();
  });

  it('still lets a client admin change a teammate role', async () => {
    svc.findById.mockResolvedValue({ id: 'u-9', client_id: 'client-a', role: 'client_viewer', is_active: true });
    const app = await build(CLIENT_ADMIN);

    const res = await app.inject({
      method: 'PATCH', url: '/users/u-9', payload: { role: 'client_admin' },
    });

    expect(res.statusCode).toBe(200);
  });
});

describe('self-service PATCH /me', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    svc.findByEmail.mockResolvedValue(null);
    svc.update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
      id: 'ca-1', email: 'me@example.com', role: 'client_admin', is_active: true, ...patch,
    }));
  });

  it('updates the caller own email', async () => {
    svc.findById.mockResolvedValue({ id: 'ca-1', client_id: 'client-a', role: 'client_admin', is_active: true });
    const app = await build(CLIENT_ADMIN);

    const res = await app.inject({ method: 'PATCH', url: '/me', payload: { email: 'me@example.com' } });

    expect(res.statusCode).toBe(200);
    expect(svc.update).toHaveBeenCalledWith('ca-1', expect.objectContaining({ email: 'me@example.com' }));
  });

  it('ignores a role smuggled into the body', async () => {
    svc.findById.mockResolvedValue({ id: 'ca-1', client_id: 'client-a', role: 'client_admin', is_active: true });
    const app = await build(CLIENT_ADMIN);

    await app.inject({
      method: 'PATCH', url: '/me',
      payload: { email: 'me@example.com', role: 'super_admin', is_active: false },
    });

    const patch = svc.update.mock.calls[0][1];
    expect(patch).not.toHaveProperty('role');
    expect(patch).not.toHaveProperty('is_active');
  });

  it('rejects an email belonging to someone else', async () => {
    svc.findById.mockResolvedValue({ id: 'ca-1', client_id: 'client-a', role: 'client_admin', is_active: true });
    svc.findByEmail.mockResolvedValue({ id: 'someone-else' });
    const app = await build(CLIENT_ADMIN);

    const res = await app.inject({ method: 'PATCH', url: '/me', payload: { email: 'taken@example.com' } });

    expect(res.statusCode).toBe(409);
  });
});
