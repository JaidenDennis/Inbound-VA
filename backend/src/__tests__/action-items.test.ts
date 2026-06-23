import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { env } from '../config/index.js';

const svc = vi.hoisted(() => ({
  findById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  writeAuditLog: vi.fn(),
}));
vi.mock('../services/index.js', () => ({
  actionItemService: { findById: svc.findById, create: svc.create, update: svc.update },
  writeAuditLog: svc.writeAuditLog,
}));

import { actionItemRoutes } from '../dashboard-api/action-items.route.js';

const CLIENT = '11111111-1111-1111-1111-111111111111';

async function buildApp() {
  const app = Fastify();
  await app.register(jwt, { secret: env.JWT_SECRET });
  await app.register(actionItemRoutes);
  await app.ready();
  return app;
}

function tokenFor(app: Awaited<ReturnType<typeof buildApp>>, role: string, clientId: string | null) {
  return app.jwt.sign({ sub: 'u-' + role, email: 'x@y.com', role, clientId });
}

describe('action-items authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    svc.create.mockResolvedValue({ id: 'a1', client_id: CLIENT, title: 't', status: 'pending' });
    svc.update.mockResolvedValue({ id: 'a1', client_id: CLIENT, status: 'done' });
    svc.findById.mockResolvedValue({ id: 'a1', client_id: CLIENT, title: 't', status: 'pending' });
  });

  it('platform staff can create an item', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/action-items',
      headers: { authorization: `Bearer ${tokenFor(app, 'super_admin', null)}` },
      payload: { clientId: CLIENT, title: 'Send your logo' },
    });
    expect(res.statusCode).toBe(201);
    expect(svc.create).toHaveBeenCalledWith(expect.objectContaining({ clientId: CLIENT, title: 'Send your logo' }));
    await app.close();
  });

  it('a tenant admin (non-platform) cannot create items', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/action-items',
      headers: { authorization: `Bearer ${tokenFor(app, 'admin', CLIENT)}` },
      payload: { clientId: CLIENT, title: 'x' },
    });
    expect(res.statusCode).toBe(403);
    expect(svc.create).not.toHaveBeenCalled();
    await app.close();
  });

  it('a client user may toggle status on their own item', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/action-items/a1',
      headers: { authorization: `Bearer ${tokenFor(app, 'viewer', CLIENT)}` },
      payload: { status: 'done' },
    });
    expect(res.statusCode).toBe(200);
    expect(svc.update).toHaveBeenCalledWith('a1', { status: 'done' });
    await app.close();
  });

  it('a client user may NOT edit the title (status-only)', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/action-items/a1',
      headers: { authorization: `Bearer ${tokenFor(app, 'viewer', CLIENT)}` },
      payload: { title: 'rewritten' },
    });
    expect(res.statusCode).toBe(403);
    expect(svc.update).not.toHaveBeenCalled();
    await app.close();
  });

  it('a client user cannot touch another tenant’s item', async () => {
    svc.findById.mockResolvedValue({ id: 'a1', client_id: 'other-client', title: 't', status: 'pending' });
    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/action-items/a1',
      headers: { authorization: `Bearer ${tokenFor(app, 'viewer', CLIENT)}` },
      payload: { status: 'done' },
    });
    expect(res.statusCode).toBe(403);
    expect(svc.update).not.toHaveBeenCalled();
    await app.close();
  });
});
