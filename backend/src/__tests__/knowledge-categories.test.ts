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
  // Added for Task 2 (rename cascade / FAQ validation): the mock now backs two
  // tables. `faqs` needs read/insert/update because the cascade rewrites rows
  // there and FAQ creation validates against `knowledge_categories` before
  // inserting into this array.
  faqs: [] as Array<Record<string, unknown>>,
}));

vi.mock('../db/index.js', () => {
  function tableStore(table: string): Array<Record<string, unknown>> | null {
    if (table === 'knowledge_categories') return db.categories;
    if (table === 'faqs') return db.faqs;
    return null;
  }

  function makeChain(table: string) {
    const store = tableStore(table);
    const state: {
      filters: Record<string, unknown>;
      orders: string[];
      insertBody?: Record<string, unknown>;
      updateBody?: Record<string, unknown>;
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
      const body = state.insertBody as Record<string, unknown>;
      if (table === 'knowledge_categories') {
        const dup = db.categories.find(
          (c) => c.client_id === body.client_id && c.name === body.name
        );
        if (dup) {
          return {
            data: null,
            error: { code: '23505', message: 'duplicate key value violates unique constraint' },
          };
        }
      }
      const prefix = table === 'faqs' ? 'faq' : 'cat';
      const row = {
        id: `${prefix}-${store.length + 1}`,
        sort_order: 0,
        active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...body,
      };
      store.push(row);
      return { data: row, error: null };
    }

    function resolveUpdate() {
      if (!store) return { data: null, error: null };
      const rows = matchRows();
      for (const row of rows) Object.assign(row, state.updateBody);
      return { data: rows[0] ?? null, error: null };
    }

    // Real supabase-js returns a fresh, disconnected JSON payload from every
    // call — reading a row and later updating the underlying table never
    // retroactively changes an object you already hold. Cloning at this
    // boundary reproduces that: without it, a handler that reads `existing`
    // once and updates the same table later (as the category PATCH route
    // does, before cascading to faqs) would see `existing` mutate out from
    // under it, because `matchRows()`/`resolveUpdate()` intentionally mutate
    // the live store in place so later queries observe the write.
    function clone<T>(value: T): T {
      if (Array.isArray(value)) return value.map((v) => ({ ...(v as object) })) as T;
      if (value && typeof value === 'object') return { ...(value as object) } as T;
      return value;
    }

    const chain: Record<string, unknown> = {
      select: () => chain,
      insert: (body: Record<string, unknown>) => {
        state.insertBody = body;
        return chain;
      },
      update: (body: Record<string, unknown>) => {
        state.updateBody = body;
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
        const result = state.updateBody ? resolveUpdate() : resolveSelect();
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
  db.faqs = [
    { id: 'faq-1', client_id: CLIENT, category: 'Billing', question: 'How much?', answer: '$100', active: true },
    // Same category NAME as faq-1, but a different tenant — a rename cascade
    // scoped only by category text (and not also by client_id) would corrupt
    // this row. It must survive every test in this file untouched.
    { id: 'faq-2', client_id: OTHER, category: 'Billing', question: 'Cost?', answer: '$200', active: true },
    { id: 'faq-3', client_id: CLIENT, category: 'Visit', question: 'Hours?', answer: '9-5', active: true },
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

describe('PATCH /knowledge/categories/:id (platform only, cascades a rename)', () => {
  it("renaming a category updates every faqs row for that client whose category equalled the old name — and does NOT touch other clients' rows", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/knowledge/categories/cat-1', // 'Billing', CLIENT
      headers: { authorization: `Bearer ${tokenFor(app, 'super_admin', null)}` },
      payload: { name: 'Payments' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: 'Payments' });

    // The category row itself renamed.
    expect(db.categories.find((c) => c.id === 'cat-1')).toMatchObject({ name: 'Payments' });

    // CLIENT's faq-1 ('Billing') cascaded to the new name.
    expect(db.faqs.find((f) => f.id === 'faq-1')).toMatchObject({ category: 'Payments' });

    // OTHER's faq-2 shared the OLD name 'Billing' but belongs to a different
    // tenant — a cascade scoped only by category text, not also by client_id,
    // would have rewritten it too. It must be untouched.
    expect(db.faqs.find((f) => f.id === 'faq-2')).toMatchObject({ category: 'Billing' });

    // An unrelated category ('Visit') on the SAME client is untouched too.
    expect(db.faqs.find((f) => f.id === 'faq-3')).toMatchObject({ category: 'Visit' });

    await app.close();
  });

  it('a client-scoped user is forbidden, even with knowledge:write', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/knowledge/categories/cat-1',
      headers: { authorization: `Bearer ${tokenFor(app, 'client_owner', CLIENT)}` },
      payload: { name: 'Payments' },
    });
    expect(res.statusCode).toBe(403);
    expect(db.categories.find((c) => c.id === 'cat-1')).toMatchObject({ name: 'Billing' });
    await app.close();
  });
});

describe('DELETE /knowledge/categories/:id (platform only, soft delete)', () => {
  it('deactivates the category without touching the text of FAQ rows that use it', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/knowledge/categories/cat-2', // 'Visit', CLIENT
      headers: { authorization: `Bearer ${tokenFor(app, 'super_admin', null)}` },
    });
    expect(res.statusCode).toBe(204);

    // Soft delete: the row still exists, just inactive.
    expect(db.categories.find((c) => c.id === 'cat-2')).toMatchObject({ active: false });

    // faq-3 used 'Visit' — its question/answer/category text is untouched.
    expect(db.faqs.find((f) => f.id === 'faq-3')).toMatchObject({
      category: 'Visit',
      question: 'Hours?',
      answer: '9-5',
    });

    await app.close();
  });

  it('a client-scoped user is forbidden, even with knowledge:write', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/knowledge/categories/cat-2',
      headers: { authorization: `Bearer ${tokenFor(app, 'client_owner', CLIENT)}` },
    });
    expect(res.statusCode).toBe(403);
    expect(db.categories.find((c) => c.id === 'cat-2')).toMatchObject({ active: true });
    await app.close();
  });
});

describe('POST /knowledge/faqs validates category against the client\'s active list', () => {
  it('rejects a category not on the list with 400', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/knowledge/faqs?clientId=${CLIENT}`,
      headers: { authorization: `Bearer ${tokenFor(app, 'client_owner', CLIENT)}` },
      payload: { question: 'Do you take insurance?', answer: 'Yes.', category: 'NotARealCategory' },
    });
    expect(res.statusCode).toBe(400);
    expect(db.faqs.find((f) => f.question === 'Do you take insurance?')).toBeUndefined();
    await app.close();
  });

  it('allows category: null (uncategorised)', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/knowledge/faqs?clientId=${CLIENT}`,
      headers: { authorization: `Bearer ${tokenFor(app, 'client_owner', CLIENT)}` },
      payload: { question: 'Where are you located?', answer: '123 Main St.', category: null },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ question: 'Where are you located?', category: null });
    await app.close();
  });

  it('allows a category that is on the active list', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/knowledge/faqs?clientId=${CLIENT}`,
      headers: { authorization: `Bearer ${tokenFor(app, 'client_owner', CLIENT)}` },
      payload: { question: 'What forms of payment?', answer: 'Card or cash.', category: 'Billing' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ question: 'What forms of payment?', category: 'Billing' });
    await app.close();
  });
});
