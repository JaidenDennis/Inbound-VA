import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { ZodError } from 'zod';
import { env } from '../config/index.js';

/**
 * `client_policies` (migration 032): policies as titled entries instead of an
 * anonymous TEXT[]. `client_settings.business_policies` stays the
 * agent-facing contract — seven Retell templates and four other call sites
 * read it straight — so `renderPolicies()` rebuilds that array from this
 * table on every write. The exact rendered string is the load-bearing
 * assertion here: it is literally the agent's input.
 *
 * The Supabase mock backs two tables (`client_policies`, `client_settings`)
 * with a hand-rolled in-memory chain, following the same shape as
 * knowledge-categories.test.ts's mock. `renderPolicies` itself is imported
 * for real (not mocked) so both the direct unit tests and the route tests
 * exercise the actual rendering logic against this mock.
 */

const db = vi.hoisted(() => ({
  policies: [] as Array<Record<string, unknown>>,
  settings: [] as Array<Record<string, unknown>>,
}));

vi.mock('../db/index.js', () => {
  function tableStore(table: string): Array<Record<string, unknown>> | null {
    if (table === 'client_policies') return db.policies;
    if (table === 'client_settings') return db.settings;
    return null;
  }

  function makeChain(table: string) {
    const store = tableStore(table);
    const state: {
      filters: Record<string, unknown>;
      orders: string[];
      insertBody?: Record<string, unknown> | Record<string, unknown>[];
      updateBody?: Record<string, unknown>;
      isDelete?: boolean;
    } = { filters: {}, orders: [] };

    function matchRows() {
      if (!store) return [];
      return store.filter((row) =>
        Object.entries(state.filters).every(([col, val]) => row[col] === val)
      );
    }

    function resolveSelect() {
      let rows = matchRows();
      for (const col of [...state.orders].reverse()) {
        rows = [...rows].sort((a, b) => {
          const av = a[col];
          const bv = b[col];
          if (typeof av === 'number' && typeof bv === 'number') return av - bv;
          return String(av).localeCompare(String(bv));
        });
      }
      return { data: rows, error: null };
    }

    function resolveInsert() {
      if (!store) return { data: null, error: null };
      const bodies = Array.isArray(state.insertBody)
        ? state.insertBody
        : state.insertBody
          ? [state.insertBody]
          : [];
      const rows = bodies.map((body, i) => ({
        id: `pol-${store.length + i + 1}`,
        active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...body,
      }));
      store.push(...rows);
      return { data: rows, error: null };
    }

    function resolveUpdate() {
      if (!store) return { data: null, error: null };
      const rows = matchRows();
      for (const row of rows) Object.assign(row, state.updateBody);
      return { data: rows[0] ?? null, error: null };
    }

    function resolveDelete() {
      if (!store) return { data: null, error: null };
      const toDelete = matchRows();
      for (const row of toDelete) {
        const idx = store.indexOf(row);
        if (idx >= 0) store.splice(idx, 1);
      }
      return { data: null, error: null };
    }

    function clone<T>(value: T): T {
      if (Array.isArray(value)) return value.map((v) => ({ ...(v as object) })) as T;
      if (value && typeof value === 'object') return { ...(value as object) } as T;
      return value;
    }

    const chain: Record<string, unknown> = {
      select: () => chain,
      insert: (body: Record<string, unknown> | Record<string, unknown>[]) => {
        state.insertBody = body;
        return chain;
      },
      update: (body: Record<string, unknown>) => {
        state.updateBody = body;
        return chain;
      },
      delete: () => {
        state.isDelete = true;
        return chain;
      },
      eq: (col: string, val: unknown) => {
        state.filters[col] = val;
        return chain;
      },
      order: (col: string) => {
        state.orders.push(col);
        return chain;
      },
      single: () => {
        const result = state.updateBody ? resolveUpdate() : resolveInsert();
        return Promise.resolve({ ...result, data: clone(result.data) });
      },
      maybeSingle: () => {
        const { data } = resolveSelect();
        const rows = data as Array<Record<string, unknown>>;
        return Promise.resolve({ data: clone(rows[0] ?? null), error: null });
      },
      then: (resolve: (v: unknown) => void) => {
        const result = state.isDelete
          ? resolveDelete()
          : state.insertBody
            ? resolveInsert()
            : state.updateBody
              ? resolveUpdate()
              : resolveSelect();
        resolve({ ...result, data: clone(result.data) });
      },
    };
    return chain;
  }

  return {
    supabase: {
      from: (table: string) => makeChain(table),
    },
  };
});

const { renderPolicies } = await import('../services/policyRender.service.js');

const svc = vi.hoisted(() => ({
  writeAuditLog: vi.fn(async () => undefined),
  withAudit: vi.fn(async (opts: { mutate: () => Promise<unknown> }) => opts.mutate()),
  requestSync: vi.fn(async () => undefined),
}));

vi.mock('../services/index.js', async () => {
  const { renderPolicies: real } = await import('../services/policyRender.service.js');
  return {
    agentSyncService: { requestSync: svc.requestSync },
    writeAuditLog: svc.writeAuditLog,
    withAudit: svc.withAudit,
    renderPolicies: vi.fn((clientId: string) => real(clientId)),
  };
});

vi.mock('../services/permission.service.js', async () => {
  const { permissionServiceMock } = await import('./helpers/rbac.js');
  return permissionServiceMock();
});

const { knowledgeRoutes } = await import('../dashboard-api/knowledge.route.js');

const CLIENT = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

async function buildApp() {
  const app = Fastify();
  // Mirror app.ts's global handler: ZodError → 400 validation response. This
  // bare test instance does not register app.ts, so without this a bad PUT
  // payload would 500 here even though the real deployed app answers 400.
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: 'Validation failed', details: error.flatten().fieldErrors });
    }
    reply.code(500).send({ error: 'Internal server error' });
  });
  await app.register(jwt, { secret: env.JWT_SECRET });
  await app.register(knowledgeRoutes);
  await app.ready();
  return app;
}

function tokenFor(app: Awaited<ReturnType<typeof buildApp>>, role: string, clientId: string | null) {
  return app.jwt.sign({ sub: 'u-' + role, email: 'x@y.com', role, clientId });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.policies = [];
  db.settings = [
    { client_id: CLIENT, business_policies: [] },
    { client_id: OTHER, business_policies: [] },
  ];
});

describe('renderPolicies()', () => {
  it('renders "Title: Body" per active policy, ordered by sort_order (not insertion order)', async () => {
    db.policies = [
      { id: 'p1', client_id: CLIENT, title: 'Parking', body: 'Free lot behind the building.', sort_order: 1, active: true },
      { id: 'p2', client_id: CLIENT, title: 'Deposits', body: 'Non-refundable.', sort_order: 0, active: true },
    ];

    const rendered = await renderPolicies(CLIENT);

    expect(rendered).toEqual([
      'Deposits: Non-refundable.',
      'Parking: Free lot behind the building.',
    ]);
  });

  it('excludes inactive policies', async () => {
    db.policies = [
      { id: 'p1', client_id: CLIENT, title: 'Active One', body: 'Kept.', sort_order: 0, active: true },
      { id: 'p2', client_id: CLIENT, title: 'Retired', body: 'Dropped.', sort_order: 1, active: false },
    ];

    const rendered = await renderPolicies(CLIENT);

    expect(rendered).toEqual(['Active One: Kept.']);
  });

  it('a policy with an empty body renders as just the title, with no trailing ": "', async () => {
    db.policies = [
      { id: 'p1', client_id: CLIENT, title: 'Walk-ins Welcome', body: '', sort_order: 0, active: true },
    ];

    const rendered = await renderPolicies(CLIENT);

    expect(rendered).toEqual(['Walk-ins Welcome']);
    expect(rendered[0]).not.toContain(':');
  });

  it('writes the rendered array to client_settings.business_policies for that client only', async () => {
    db.policies = [
      { id: 'p1', client_id: CLIENT, title: 'A', body: 'a', sort_order: 0, active: true },
    ];

    await renderPolicies(CLIENT);

    expect(db.settings.find((s) => s.client_id === CLIENT)).toMatchObject({
      business_policies: ['A: a'],
    });
    // OTHER's settings untouched.
    expect(db.settings.find((s) => s.client_id === OTHER)).toMatchObject({
      business_policies: [],
    });
  });

  it('an empty policy set renders to an empty array', async () => {
    const rendered = await renderPolicies(CLIENT);
    expect(rendered).toEqual([]);
    expect(db.settings.find((s) => s.client_id === CLIENT)).toMatchObject({ business_policies: [] });
  });
});

describe('GET /knowledge/policies', () => {
  it('returns active policies ordered by sort_order, with id/title/body/sort_order', async () => {
    db.policies = [
      { id: 'p1', client_id: CLIENT, title: 'Second', body: 'b', sort_order: 1, active: true },
      { id: 'p2', client_id: CLIENT, title: 'First', body: 'a', sort_order: 0, active: true },
      { id: 'p3', client_id: CLIENT, title: 'Hidden', body: 'c', sort_order: 2, active: false },
    ];
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/knowledge/policies?clientId=${CLIENT}`,
      headers: { authorization: `Bearer ${tokenFor(app, 'client_owner', CLIENT)}` },
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data as Array<{ id: string; title: string; body: string; sort_order: number }>;
    // Ordered by sort_order (First=0 before Second=1); inactive 'Hidden' excluded.
    expect(data.map((p) => p.id)).toEqual(['p2', 'p1']);
    expect(data).toMatchObject([
      { id: 'p2', title: 'First', body: 'a', sort_order: 0 },
      { id: 'p1', title: 'Second', body: 'b', sort_order: 1 },
    ]);
    await app.close();
  });

  it("a client-scoped user cannot read another tenant's policies", async () => {
    db.policies = [
      { id: 'p1', client_id: OTHER, title: 'Not Yours', body: '', sort_order: 0, active: true },
    ];
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/knowledge/policies?clientId=${OTHER}`,
      headers: { authorization: `Bearer ${tokenFor(app, 'client_owner', CLIENT)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
    await app.close();
  });
});

describe('PUT /knowledge/policies', () => {
  it('replaces the whole set, assigns sort_order from array order, and re-renders business_policies', async () => {
    db.policies = [
      { id: 'old', client_id: CLIENT, title: 'Stale', body: 'gone', sort_order: 0, active: true },
    ];
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/knowledge/policies?clientId=${CLIENT}`,
      headers: { authorization: `Bearer ${tokenFor(app, 'client_owner', CLIENT)}` },
      payload: {
        policies: [
          { title: 'Cancellations', body: '24 hours notice required.' },
          { title: 'Walk-ins Welcome', body: '' },
        ],
      },
    });
    expect(res.statusCode).toBe(200);

    // Old row gone, new rows present with sort_order following payload order.
    expect(db.policies.find((p) => p.id === 'old')).toBeUndefined();
    const titles = db.policies
      .filter((p) => p.client_id === CLIENT)
      .sort((a, b) => (a.sort_order as number) - (b.sort_order as number))
      .map((p) => p.title);
    expect(titles).toEqual(['Cancellations', 'Walk-ins Welcome']);

    // renderPolicies ran: business_policies reflects the exact agent-facing string.
    expect(db.settings.find((s) => s.client_id === CLIENT)).toMatchObject({
      business_policies: ['Cancellations: 24 hours notice required.', 'Walk-ins Welcome'],
    });

    // Sync requested for the live agent.
    expect(svc.requestSync).toHaveBeenCalledWith(CLIENT, { userId: 'u-client_owner' });

    await app.close();
  });

  it('an empty policies array clears the set and renders an empty business_policies array', async () => {
    db.policies = [
      { id: 'old', client_id: CLIENT, title: 'Stale', body: '', sort_order: 0, active: true },
    ];
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/knowledge/policies?clientId=${CLIENT}`,
      headers: { authorization: `Bearer ${tokenFor(app, 'client_owner', CLIENT)}` },
      payload: { policies: [] },
    });
    expect(res.statusCode).toBe(200);
    expect(db.policies.filter((p) => p.client_id === CLIENT)).toEqual([]);
    expect(db.settings.find((s) => s.client_id === CLIENT)).toMatchObject({ business_policies: [] });
    await app.close();
  });

  it("does not touch another tenant's policies", async () => {
    db.policies = [
      { id: 'other-1', client_id: OTHER, title: "Other's Policy", body: 'x', sort_order: 0, active: true },
    ];
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/knowledge/policies?clientId=${CLIENT}`,
      headers: { authorization: `Bearer ${tokenFor(app, 'client_owner', CLIENT)}` },
      payload: { policies: [{ title: 'Mine', body: '' }] },
    });
    expect(res.statusCode).toBe(200);
    expect(db.policies.find((p) => p.id === 'other-1')).toMatchObject({ title: "Other's Policy" });
    expect(db.settings.find((s) => s.client_id === OTHER)).toMatchObject({ business_policies: [] });
    await app.close();
  });

  it('rejects a policy with an empty title (400)', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/knowledge/policies?clientId=${CLIENT}`,
      headers: { authorization: `Bearer ${tokenFor(app, 'client_owner', CLIENT)}` },
      payload: { policies: [{ title: '', body: 'x' }] },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('rejects more than 50 policies (400)', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/knowledge/policies?clientId=${CLIENT}`,
      headers: { authorization: `Bearer ${tokenFor(app, 'client_owner', CLIENT)}` },
      payload: { policies: Array.from({ length: 51 }, (_, i) => ({ title: `P${i}`, body: '' })) },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('routes the mutation through withAudit', async () => {
    const app = await buildApp();
    await app.inject({
      method: 'PUT',
      url: `/knowledge/policies?clientId=${CLIENT}`,
      headers: { authorization: `Bearer ${tokenFor(app, 'client_owner', CLIENT)}` },
      payload: { policies: [{ title: 'Audited', body: '' }] },
    });
    expect(svc.withAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'knowledge.policies.updated' })
    );
    await app.close();
  });
});
