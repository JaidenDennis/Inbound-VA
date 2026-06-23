import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { env } from '../config/index.js';

// ── Service-level mock: capture every insert so we can assert the ticket row
//    AND the initial status-history row are both written. ──────────────────────
const db = vi.hoisted(() => {
  const inserts: Record<string, Array<Record<string, unknown>>> = {};
  const builder = (result: unknown) => ({
    select: () => ({ single: () => Promise.resolve(result) }),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(res, rej),
  });
  const supabase = {
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        (inserts[table] ||= []).push(row);
        if (table === 'tickets') {
          return builder({ data: { id: 'ticket-1', ...row }, error: null });
        }
        return builder({ data: null, error: null });
      },
    }),
  };
  return { inserts, supabase };
});
vi.mock('../db/index.js', () => ({ supabase: db.supabase }));

// ── Route-level mocks: stub the service barrel + notify so the endpoint test
//    asserts orchestration (create + notification attempt) in isolation. ───────
const routeMocks = vi.hoisted(() => ({
  ticketCreate: vi.fn(),
  clientFindById: vi.fn(),
  writeAuditLog: vi.fn(),
  notify: vi.fn(),
}));
vi.mock('../services/index.js', () => ({
  ticketService: { create: routeMocks.ticketCreate },
  clientService: { findById: routeMocks.clientFindById },
  writeAuditLog: routeMocks.writeAuditLog,
}));
vi.mock('../notify/index.js', () => ({ notify: routeMocks.notify }));

import { TicketService } from '../services/ticket.service.js';
import { ticketRoutes } from '../dashboard-api/tickets.route.js';

describe('TicketService.create', () => {
  beforeEach(() => {
    for (const k of Object.keys(db.inserts)) delete db.inserts[k];
  });

  it('inserts the ticket and the initial status-history row', async () => {
    const ticket = await new TicketService().create({
      clientId: 'client-a',
      createdBy: 'user-1',
      subject: 'Phone line down',
      description: 'No inbound calls connecting',
      priority: 'high',
    });

    expect(ticket.status).toBe('investigating');
    expect(db.inserts['tickets'][0]).toMatchObject({
      client_id: 'client-a',
      created_by: 'user-1',
      subject: 'Phone line down',
      priority: 'high',
      status: 'investigating',
    });
    // Append-only audit: first history row is the creation row (null → investigating).
    expect(db.inserts['ticket_status_history'][0]).toMatchObject({
      ticket_id: 'ticket-1',
      from_status: null,
      to_status: 'investigating',
      changed_by: 'user-1',
    });
  });
});

describe('POST /tickets', () => {
  async function buildApp() {
    const app = Fastify();
    await app.register(jwt, { secret: env.JWT_SECRET });
    await app.register(ticketRoutes);
    await app.ready();
    return app;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    routeMocks.ticketCreate.mockResolvedValue({
      id: 't-1',
      client_id: 'client-a',
      subject: 'Help',
      priority: 'high',
      status: 'investigating',
    });
    routeMocks.clientFindById.mockResolvedValue({ id: 'client-a', name: 'Acme Dental' });
    routeMocks.notify.mockResolvedValue(true);
    routeMocks.writeAuditLog.mockResolvedValue(undefined);
  });

  it('creates a ticket for the caller’s tenant and attempts a notification', async () => {
    const app = await buildApp();
    const token = app.jwt.sign({ sub: 'user-1', email: 'c@acme.com', role: 'viewer', clientId: 'client-a' });

    const res = await app.inject({
      method: 'POST',
      url: '/tickets',
      headers: { authorization: `Bearer ${token}` },
      payload: { subject: 'Help', description: 'x', priority: 'high' },
    });

    expect(res.statusCode).toBe(201);
    expect(routeMocks.ticketCreate).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'client-a', createdBy: 'user-1', subject: 'Help', priority: 'high' })
    );
    expect(routeMocks.notify).toHaveBeenCalledTimes(1);
    expect(routeMocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({ url: expect.stringContaining('/dashboard/support/t-1') })
    );
    await app.close();
  });

  it('rejects an unauthenticated request', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/tickets', payload: { subject: 'Help' } });
    expect(res.statusCode).toBe(401);
    expect(routeMocks.ticketCreate).not.toHaveBeenCalled();
    await app.close();
  });
});
