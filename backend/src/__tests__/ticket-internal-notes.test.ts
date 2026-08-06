import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { env } from '../config/index.js';

/**
 * The leak test.
 *
 * Staff discuss clients in internal notes. If one reaches the client thread the
 * damage is immediate and nobody finds out — there is no error, no alert, just a
 * client reading something never meant for them. So the assertions here are
 * against the API response body, not the rendered UI, and they cover both the
 * read path (can a client see one?) and the write path (can a client create one,
 * or probe the field?).
 */

const CLIENT = '11111111-1111-1111-1111-111111111111';
const OTHER_CLIENT = '22222222-2222-2222-2222-222222222222';

const MESSAGES = [
  { id: 'm1', ticket_id: 't1', author_id: 'u-client', body: 'My phones are down', visibility: 'client', created_at: '2026-08-01T10:00:00Z' },
  { id: 'm2', ticket_id: 't1', author_id: 'u-staff', body: 'This client is always like this', visibility: 'internal', created_at: '2026-08-01T10:05:00Z' },
  { id: 'm3', ticket_id: 't1', author_id: 'u-staff', body: 'Looking into it now', visibility: 'client', created_at: '2026-08-01T10:10:00Z' },
  { id: 'm4', ticket_id: 't1', author_id: 'u-staff', body: 'Root cause is their own router', visibility: 'internal', created_at: '2026-08-01T10:20:00Z' },
];

// A Supabase stand-in that honours .eq('visibility', …) the way PostgREST does,
// so the test exercises the real filter rather than a hand-waved mock.
const db = vi.hoisted(() => {
  const inserted: Array<Record<string, unknown>> = [];
  const makeMessagesQuery = () => {
    const filters: Record<string, unknown> = {};
    const builder: Record<string, unknown> = {
      eq(column: string, value: unknown) {
        filters[column] = value;
        return builder;
      },
      order() {
        return builder;
      },
      then(resolve: (v: unknown) => unknown) {
        const rows = MESSAGES.filter((m) =>
          Object.entries(filters).every(([k, v]) => (m as Record<string, unknown>)[k] === v)
        );
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      },
    };
    return builder;
  };

  const supabase = {
    from(table: string) {
      if (table === 'ticket_messages') {
        return {
          select: () => makeMessagesQuery(),
          insert: (row: Record<string, unknown>) => {
            inserted.push(row);
            return { select: () => ({ single: () => Promise.resolve({ data: { id: 'new', ...row }, error: null }) }) };
          },
        };
      }
      if (table === 'ticket_status_history') {
        return {
          select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
          insert: () => Promise.resolve({ data: null, error: null }),
        };
      }
      // tickets
      return {
        update: () => ({ eq: () => ({ is: () => Promise.resolve({ data: null, error: null }) }) }),
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
      };
    },
  };
  return { supabase, inserted };
});
vi.mock('../db/index.js', () => ({ supabase: db.supabase }));

vi.mock('../services/permission.service.js', async () => {
  const { permissionServiceMock } = await import('./helpers/rbac.js');
  return permissionServiceMock();
});

const TICKET = {
  id: 't1',
  client_id: CLIENT,
  subject: 'Phones down',
  status: 'investigating',
  priority: 'high',
  assigned_to: 'u-staff',
  created_by: 'u-client',
};

const svc = vi.hoisted(() => ({
  findById: vi.fn(),
  getHistory: vi.fn(),
  changeStatus: vi.fn(),
  changePriority: vi.fn(),
  assign: vi.fn(),
  writeAuditLog: vi.fn(),
  clientFindById: vi.fn(),
  create: vi.fn(),
}));

vi.mock('../services/index.js', async () => {
  const { TicketService } = await import('../services/ticket.service.js');
  const real = new TicketService();
  return {
    ticketService: {
      // getMessages and addMessage are the code under test — keep them real.
      getMessages: real.getMessages.bind(real),
      addMessage: real.addMessage.bind(real),
      findById: svc.findById,
      getHistory: svc.getHistory,
      changeStatus: svc.changeStatus,
      changePriority: svc.changePriority,
      assign: svc.assign,
      create: svc.create,
    },
    clientService: { findById: svc.clientFindById },
    writeAuditLog: svc.writeAuditLog,
  };
});
vi.mock('../notify/index.js', () => ({ notify: vi.fn().mockResolvedValue(true) }));

const { ticketRoutes } = await import('../dashboard-api/tickets.route.js');

async function buildApp() {
  const app = Fastify();
  await app.register(jwt, { secret: env.JWT_SECRET });
  await app.register(ticketRoutes);
  await app.ready();
  return app;
}

function token(app: Awaited<ReturnType<typeof buildApp>>, role: string, clientId: string | null) {
  return app.jwt.sign({ sub: `u-${role}`, email: `${role}@x.com`, role, clientId });
}

describe('internal notes — read path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    svc.findById.mockResolvedValue(TICKET);
    svc.getHistory.mockResolvedValue([]);
  });

  it('never returns an internal note to a client_owner', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/tickets/t1',
      headers: { authorization: `Bearer ${token(app, 'client_owner', CLIENT)}` },
    });

    expect(res.statusCode).toBe(200);
    const messages = res.json().messages as Array<{ visibility: string; body: string }>;
    expect(messages).toHaveLength(2);
    expect(messages.every((m) => m.visibility === 'client')).toBe(true);
    // Assert on the actual text: a filter that passes the count but leaks the
    // body would still be a breach.
    expect(JSON.stringify(messages)).not.toContain('always like this');
    expect(JSON.stringify(messages)).not.toContain('their own router');
    await app.close();
  });

  it('never returns an internal note to a client_manager or client_viewer', async () => {
    const app = await buildApp();
    for (const role of ['client_manager', 'client_viewer']) {
      const res = await app.inject({
        method: 'GET',
        url: '/tickets/t1',
        headers: { authorization: `Bearer ${token(app, role, CLIENT)}` },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.stringify(res.json().messages)).not.toContain('internal');
    }
    await app.close();
  });

  it('returns the full thread to platform staff', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/tickets/t1',
      headers: { authorization: `Bearer ${token(app, 'support_agent', null)}` },
    });

    const messages = res.json().messages as Array<{ visibility: string }>;
    expect(messages).toHaveLength(4);
    expect(messages.filter((m) => m.visibility === 'internal')).toHaveLength(2);
    await app.close();
  });

  it('hides which staff member is assigned from the client', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/tickets/t1',
      headers: { authorization: `Bearer ${token(app, 'client_owner', CLIENT)}` },
    });
    expect(res.json().assigned_to).toBeNull();
    await app.close();
  });

  it('still enforces tenant isolation on the ticket itself', async () => {
    svc.findById.mockResolvedValue({ ...TICKET, client_id: OTHER_CLIENT });
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/tickets/t1',
      headers: { authorization: `Bearer ${token(app, 'client_owner', CLIENT)}` },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

describe('internal notes — write path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.inserted.length = 0;
    svc.findById.mockResolvedValue(TICKET);
  });

  it('refuses an internal note from a client role', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/tickets/t1/messages',
      headers: { authorization: `Bearer ${token(app, 'client_owner', CLIENT)}` },
      payload: { body: 'sneaky', visibility: 'internal' },
    });

    expect(res.statusCode).toBe(403);
    expect(db.inserted).toHaveLength(0);
    await app.close();
  });

  it('stores a client reply as client-visible', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/tickets/t1/messages',
      headers: { authorization: `Bearer ${token(app, 'client_owner', CLIENT)}` },
      payload: { body: 'any update?' },
    });

    expect(res.statusCode).toBe(201);
    expect(db.inserted[0].visibility).toBe('client');
    await app.close();
  });

  it('lets staff post an internal note', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/tickets/t1/messages',
      headers: { authorization: `Bearer ${token(app, 'support_agent', null)}` },
      payload: { body: 'checking their router config', visibility: 'internal' },
    });

    expect(res.statusCode).toBe(201);
    expect(db.inserted[0].visibility).toBe('internal');
    await app.close();
  });
});

describe('triage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    svc.findById.mockResolvedValue(TICKET);
    svc.changeStatus.mockResolvedValue({ ...TICKET, status: 'resolved' });
    svc.assign.mockResolvedValue(TICKET);
  });

  it('is refused to every client role, including the owner', async () => {
    const app = await buildApp();
    for (const role of ['client_owner', 'client_manager', 'client_viewer']) {
      const res = await app.inject({
        method: 'PATCH',
        url: '/tickets/t1',
        headers: { authorization: `Bearer ${token(app, role, CLIENT)}` },
        payload: { status: 'resolved' },
      });
      expect(res.statusCode).toBe(403);
    }
    expect(svc.changeStatus).not.toHaveBeenCalled();
    await app.close();
  });

  it('is allowed for support staff', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/tickets/t1',
      headers: { authorization: `Bearer ${token(app, 'support_agent', null)}` },
      payload: { status: 'resolved' },
    });
    expect(res.statusCode).toBe(200);
    expect(svc.changeStatus).toHaveBeenCalled();
    await app.close();
  });

  it('is refused to an analyst, who is read-only', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/tickets/t1',
      headers: { authorization: `Bearer ${token(app, 'analyst', null)}` },
      payload: { status: 'resolved' },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
