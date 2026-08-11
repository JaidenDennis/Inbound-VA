import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { env } from '../config/index.js';

/**
 * `knowledge_categories` (migration 031): a staff-managed per-client FAQ
 * category list. Reading is open to anyone with `knowledge:read`, scoped to
 * their own tenant; writing is platform-only, because the point of the table
 * is that clients pick from a curated list rather than inventing one.
 *
 * The Supabase mock is purpose-built for this route's exact query shapes
 * (chained `.eq`/`.order` for GET, `.insert().select().single()` for POST)
 * rather than reusing knowledge.test.ts's per-table fixture map, because that
 * mock only supports a single `.eq().eq()` read path and this route also
 * writes. The duplicate-name (409) behaviour is derived from the same
 * in-memory rows the reads use, so it mirrors the real unique-index
 * constraint instead of a manually toggled flag.
 */

const db = vi.hoisted(() => ({
  categories: [] as Array<Record<string, unknown>>,
}));

vi.mock('../db/index.js', () => {
  function makeChain(table: string) {
    const state: {
      filters: Record<string, unknown>;
      orders: string[];
      insertBody?: Record<string, unknown>;
    } = { filters: {}, orders: [] };

    function resolveSelect() {
      if (table !== 'knowledge_categories') return { data: [], error: null };
      let rows = db.categories.filter((row) =>
        Object.entries(state.filters).every(([col, val]) => row[col] === val)
      );
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
      const body = state.insertBody as Record<string, unknown>;
      const dup = db.categories.find(
        (c) => c.client_id === body.client_id && c.name === body.name
      );
      if (dup) {
        return {
          data: null,
          error: { code: '23505', message: 'duplicate key value violates unique constraint' },
        };
      }
      const row = {
        id: `cat-${db.categories.length + 1}`,
        sort_order: 0,
        active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...body,
      };
      db.categories.push(row);
      return { data: row, error: null };
    }

    const chain: Record<string, unknown> = {
      select: () => chain,
      insert: (body: Record<string, unknown>) => {
        state.insertBody = body;
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
      single: () => Promise.resolve(resolveInsert()),
      then: (resolve: (v: unknown) => void) => resolve(resolveSelect()),
    };
    return chain;
  }

  return {
    supabase: {
      from: (table: string) => makeChain(table),
    },
  };
});

const svc = vi.hoisted(() => ({
  writeAuditLog: vi.fn(async () => undefined),
  withAudit: vi.fn(async (opts: { mutate: () => Promise<unknown> }) => opts.mutate()),
  requestSync: vi.fn(async () => undefined),
}));

vi.mock('../services/index.js', () => ({
  agentSyncService: { requestSync: svc.requestSync },
  writeAuditLog: svc.writeAuditLog,
  withAudit: svc.withAudit,
}));

// requirePermission/requirePlatform resolve grants from the database; serve
// them from the migration instead so this route test stays offline and stays
// true to the real grant table rather than a hand-maintained duplicate.
vi.mock('../services/permission.service.js', async () => {
  const { permissionServiceMock } = await import('./helpers/rbac.js');
  return permissionServiceMock();
});

const { knowledgeRoutes } = await import('../dashboard-api/knowledge.route.js');

const CLIENT = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

async function buildApp() {
  const app = Fastify();
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
  db.categories = [
    { id: 'cat-1', client_id: CLIENT, name: 'Billing', sort_order: 1, active: true },
    { id: 'cat-2', client_id: CLIENT, name: 'Visit', sort_order: 0, active: true },
    { id: 'cat-3', client_id: CLIENT, name: 'Retired', sort_order: 2, active: false },
    { id: 'cat-4', client_id: OTHER, name: 'Other Tenant Category', sort_order: 0, active: true },
  ];
});

describe('GET /knowledge/categories', () => {
  it("returns the calling tenant's active categories, ordered by sort_order", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/knowledge/categories?clientId=${CLIENT}`,
      headers: { authorization: `Bearer ${tokenFor(app, 'client_owner', CLIENT)}` },
    });
    expect(res.statusCode).toBe(200);
    const names = res.json().data.map((c: { name: string }) => c.name);
    // 'Visit' (sort_order 0) before 'Billing' (sort_order 1); 'Retired' (inactive) excluded.
    expect(names).toEqual(['Visit', 'Billing']);
    await app.close();
  });

  // `scopeFor` pins a client-scoped user to their OWN clientId and ignores
  // whatever `?clientId=` they pass (same contract as owner-analytics.test.ts's
  // "pins a client user to their own tenant even if they name another" — see
  // scopeFor()/assertClientAccess() in knowledge.route.ts: for a client user,
  // `user.clientId ?? requested` always resolves to their own id, so the
  // request never reaches the 403 branch). That is a STRONGER isolation than a
  // 403 would be: the foreign tenant's data is never visible under any status
  // code. This test asserts that actual property — the response is 200 (their
  // own tenant, silently substituted) and never contains the other tenant's
  // category — rather than a 403 that this route's scoping rule cannot produce
  // for a GET. The 403 path IS exercised: see the POST tests below, which hit
  // it via the platform-only guard.
  it("a client-scoped user cannot read another tenant's categories — the query's clientId is ignored, not honoured", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/knowledge/categories?clientId=${OTHER}`,
      headers: { authorization: `Bearer ${tokenFor(app, 'client_owner', CLIENT)}` },
    });
    expect(res.statusCode).toBe(200);
    const names = res.json().data.map((c: { name: string }) => c.name);
    expect(names).not.toContain('Other Tenant Category');
    expect(names).toEqual(['Visit', 'Billing']); // CLIENT's own categories, not OTHER's
    await app.close();
  });
});

describe('POST /knowledge/categories (platform only)', () => {
  it('a client-scoped user is forbidden, even with knowledge:write', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/knowledge/categories?clientId=${CLIENT}`,
      headers: { authorization: `Bearer ${tokenFor(app, 'client_owner', CLIENT)}` },
      payload: { name: 'New Category' },
    });
    expect(res.statusCode).toBe(403);
    expect(db.categories.find((c) => c.name === 'New Category')).toBeUndefined();
    await app.close();
  });

  it('a platform user can create one', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/knowledge/categories?clientId=${CLIENT}`,
      headers: { authorization: `Bearer ${tokenFor(app, 'super_admin', null)}` },
      payload: { name: 'Insurance' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: 'Insurance', client_id: CLIENT });
    expect(db.categories.find((c) => c.name === 'Insurance' && c.client_id === CLIENT)).toBeTruthy();
    await app.close();
  });

  it('creating a duplicate name for the same client returns 409, not 500', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/knowledge/categories?clientId=${CLIENT}`,
      headers: { authorization: `Bearer ${tokenFor(app, 'super_admin', null)}` },
      payload: { name: 'Billing' }, // already exists for CLIENT (cat-1)
    });
    expect(res.statusCode).toBe(409);
    await app.close();
  });
});
