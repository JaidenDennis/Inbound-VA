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
  // F1 coverage: when true, the NEXT insert into `client_policies` fails
  // (and does not push any rows into the store), simulating a Supabase
  // insert error mid-write so the "insert-first" ordering can be proven —
  // the previous rows must survive that failure untouched.
  failNextPolicyInsert: false,
  // F5 coverage: when true, the NEXT delete against `client_policies` fails
  // (and removes nothing), simulating the cleanup delete failing AFTER a
  // successful insert — the case where old and new rows end up coexisting.
  failNextPolicyDelete: false,
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
      inFilters: Record<string, unknown[]>;
      orders: string[];
      insertBody?: Record<string, unknown> | Record<string, unknown>[];
      updateBody?: Record<string, unknown>;
      isDelete?: boolean;
    } = { filters: {}, inFilters: {}, orders: [] };

    function matchRows() {
      if (!store) return [];
      return store.filter(
        (row) =>
          Object.entries(state.filters).every(([col, val]) => row[col] === val) &&
          Object.entries(state.inFilters).every(([col, vals]) => vals.includes(row[col]))
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
      if (table === 'client_policies' && db.failNextPolicyInsert) {
        db.failNextPolicyInsert = false;
        return { data: null, error: { message: 'simulated insert failure' } };
      }
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

    // Returns the FULL set of matched/updated rows as `data` — real
    // supabase-js does the same when `.select()` is chained after
    // `.update()`. `.single()` below narrows to one row for callers that
    // asked for that.
    function resolveUpdate() {
      if (!store) return { data: null, error: null };
      const rows = matchRows();
      for (const row of rows) Object.assign(row, state.updateBody);
      return { data: rows, error: null };
    }

    function resolveDelete() {
      if (!store) return { data: null, error: null };
      if (table === 'client_policies' && db.failNextPolicyDelete) {
        db.failNextPolicyDelete = false;
        return { data: null, error: { message: 'simulated delete failure' } };
      }
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
      in: (col: string, vals: unknown[]) => {
        state.inFilters[col] = vals;
        return chain;
      },
      order: (col: string) => {
        state.orders.push(col);
        return chain;
      },
      single: () => {
        const result = state.updateBody ? resolveUpdate() : resolveInsert();
        const rows = result.data as unknown;
        const one = Array.isArray(rows) ? (rows[0] ?? null) : rows;
        return Promise.resolve({ ...result, data: clone(one) });
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
  // Must run `before()` THEN `mutate()`, in that order, same as the real
  // withAudit (audit.service.ts) — the PUT route's `mutate()` reads
  // `previousIds`, which is only populated by `before()` via closure. A mock
  // that skipped `before()` (as an earlier version of this file's mock did)
  // would silently leave `previousIds` empty and hide the very delete-target
  // bug F1's fix depends on.
  withAudit: vi.fn(async (opts: { before: () => Promise<unknown>; mutate: () => Promise<unknown> }) => {
    await opts.before();
    return opts.mutate();
  }),
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
  db.failNextPolicyInsert = false;
  db.failNextPolicyDelete = false;
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

  // F4: an update matched on client_id against a MISSING client_settings row
  // succeeds with zero rows affected and no error — a silent no-op. Without a
  // guard, renderPolicies would return normally as if it had rendered
  // something, and the caller would have no way to know the agent's text was
  // never actually updated.
  it('F4: throws when the client_settings row is missing, instead of silently doing nothing', async () => {
    db.policies = [{ id: 'p1', client_id: CLIENT, title: 'A', body: 'a', sort_order: 0, active: true }];
    db.settings = db.settings.filter((s) => s.client_id !== CLIENT);

    await expect(renderPolicies(CLIENT)).rejects.toThrow(/client_settings/i);
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

  // F3: z.string().min(1) alone accepts "   " — three spaces pass length
  // validation, then render into the agent's prompt array as a blank
  // heading. Trimming before the length check makes a whitespace-only title
  // behave the same as an empty one.
  it('F3: rejects a whitespace-only title (400) rather than storing a blank heading', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/knowledge/policies?clientId=${CLIENT}`,
      headers: { authorization: `Bearer ${tokenFor(app, 'client_owner', CLIENT)}` },
      payload: { policies: [{ title: '   ', body: 'x' }] },
    });
    expect(res.statusCode).toBe(400);
    expect(db.policies).toEqual([]);
    await app.close();
  });

  it('F3: trims surrounding whitespace off an otherwise-valid title before storing it', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/knowledge/policies?clientId=${CLIENT}`,
      headers: { authorization: `Bearer ${tokenFor(app, 'client_owner', CLIENT)}` },
      payload: { policies: [{ title: '  Deposits  ', body: 'x' }] },
    });
    expect(res.statusCode).toBe(200);
    expect(db.policies.find((p) => p.client_id === CLIENT)).toMatchObject({ title: 'Deposits' });
    await app.close();
  });

  // F1: the core regression test. A delete-then-insert would have already
  // deleted the client's existing rows by the time the insert fails, leaving
  // NOTHING — an unrecoverable loss, since a throwing mutate() also skips
  // withAudit's own log write (audit.service.ts), so not even the `before`
  // snapshot survives. The fix inserts first: proves that when the insert
  // fails, the original row, and the business_policies text rendered from
  // it, are both still exactly what they were before the request.
  it('F1: an insert failure during PUT leaves the existing policies and business_policies completely intact', async () => {
    db.policies = [
      { id: 'keep-1', client_id: CLIENT, title: 'Original', body: 'Do not lose me.', sort_order: 0, active: true },
    ];
    db.settings = db.settings.map((s) =>
      s.client_id === CLIENT ? { ...s, business_policies: ['Original: Do not lose me.'] } : s
    );
    db.failNextPolicyInsert = true;

    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/knowledge/policies?clientId=${CLIENT}`,
      headers: { authorization: `Bearer ${tokenFor(app, 'client_owner', CLIENT)}` },
      payload: { policies: [{ title: 'New', body: 'Should never land.' }] },
    });

    expect(res.statusCode).toBe(400);

    // The original row is untouched — insert-first means a failed insert
    // never reaches the delete of the previous rows.
    expect(db.policies).toEqual([
      { id: 'keep-1', client_id: CLIENT, title: 'Original', body: 'Do not lose me.', sort_order: 0, active: true },
    ]);
    expect(db.policies.some((p) => p.title === 'New')).toBe(false);

    // renderPolicies never ran (mutate threw first) — the agent-facing text
    // is exactly what it was before the failed request, not empty.
    expect(db.settings.find((s) => s.client_id === CLIENT)).toMatchObject({
      business_policies: ['Original: Do not lose me.'],
    });

    await app.close();
  });

  // F2: if the write itself succeeds but renderPolicies then fails, the new
  // rows are real and saved — the response must not read as a plain failure
  // (a 400 here would wrongly suggest nothing happened), and it must not
  // read as a plain success either (a bare 200 would hide that the agent is
  // about to keep saying the old policies). Forcing this via a missing
  // client_settings row also doubles as route-level coverage for F4's guard.
  it('F2: a renderPolicies failure after a successful write responds 200 with an explicit warning, and the new rows are really saved', async () => {
    db.policies = [];
    db.settings = db.settings.filter((s) => s.client_id !== CLIENT); // no settings row → renderPolicies throws (F4 guard)

    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/knowledge/policies?clientId=${CLIENT}`,
      headers: { authorization: `Bearer ${tokenFor(app, 'client_owner', CLIENT)}` },
      payload: { policies: [{ title: 'Fresh Policy', body: 'Just written.' }] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().warning).toBeTruthy();
    expect(res.json().warning).toMatch(/refresh|stale|previous/i);

    // The write really happened, even though rendering failed.
    expect(db.policies.find((p) => p.client_id === CLIENT && p.title === 'Fresh Policy')).toBeTruthy();

    // No sync was requested off the back of a text that was never refreshed.
    expect(svc.requestSync).not.toHaveBeenCalled();

    await app.close();
  });

  // F5: F1's fix moved the cleanup delete to run AFTER the audited insert
  // instead of inside mutate() — so a failure in THAT delete can no longer
  // produce "mutate() threw -> withAudit skips writeAuditLog entirely ->
  // no trail of a change that actually happened" (audit.service.ts only
  // logs once mutate() returns). Prove the new shape: the insert really
  // landed (so a real withAudit would have logged it — mutate() returned
  // normally, it did not throw), the response is not a 400 that would deny
  // the insert happened, the failure is reported rather than swallowed, and
  // — the ordering half of this fix — business_policies is NOT rendered
  // from the transient old+new set, which would have duplicated every
  // policy in the agent's prompt.
  it('F5: a failed cleanup delete after a successful insert is not misreported as a 400, and does not duplicate the agent-facing text', async () => {
    db.policies = [
      { id: 'keep-1', client_id: CLIENT, title: 'Original', body: 'Stays until cleanup runs.', sort_order: 0, active: true },
    ];
    db.settings = db.settings.map((s) =>
      s.client_id === CLIENT ? { ...s, business_policies: ['Original: Stays until cleanup runs.'] } : s
    );
    db.failNextPolicyDelete = true;

    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/knowledge/policies?clientId=${CLIENT}`,
      headers: { authorization: `Bearer ${tokenFor(app, 'client_owner', CLIENT)}` },
      payload: { policies: [{ title: 'New', body: 'Just written.' }] },
    });

    // Not a 400 — a 400 here would flatly contradict what happened: the
    // insert is real and already committed.
    expect(res.statusCode).toBe(200);
    expect(res.json().warning).toBeTruthy();
    expect(res.json().warning).toMatch(/duplicat|previous|removed/i);

    // Both rows are present — the insert (the audited change) really landed,
    // and the old row could not be cleaned up. mutate() returned normally
    // (it did not throw), so a real withAudit would have recorded this write.
    const titles = db.policies.filter((p) => p.client_id === CLIENT).map((p) => p.title);
    expect(titles).toContain('Original');
    expect(titles).toContain('New');
    expect(svc.withAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'knowledge.policies.updated' })
    );

    // renderPolicies was NOT run against the transient duplicate set —
    // business_policies still holds exactly the pre-write text, not a
    // duplicated old+new array (e.g. NOT ['Original: ...', 'New: ...']).
    expect(db.settings.find((s) => s.client_id === CLIENT)).toMatchObject({
      business_policies: ['Original: Stays until cleanup runs.'],
    });

    // No sync was requested against text that was deliberately left stale.
    expect(svc.requestSync).not.toHaveBeenCalled();

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
