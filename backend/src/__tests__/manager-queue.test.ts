import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { env } from '../config/index.js';

/**
 * The manager work queue (migration 025).
 *
 * The design's governing rule — every item must be closable — is the first
 * describe block, and it iterates the kind list rather than naming kinds, so a
 * sixth kind added to the view without a close path fails here.
 */

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION_025 = resolve(here, '../../../supabase/migrations/025_manager_queue.sql');

/**
 * The migration that currently defines `manager_queue`.
 *
 * 034 re-declares the view to add the `action_item` kind, reproducing 025's
 * five branches verbatim. Assertions about the view's *current* shape must read
 * the latest definition; assertions about 025's own history still read 025.
 */
const MIGRATION_034 = resolve(here, '../../../supabase/migrations/034_queue_action_items.sql');

const db = vi.hoisted(() => ({
  queue: [] as Record<string, unknown>[],
  writes: [] as { table: string; op: string; payload: unknown }[],
  audits: [] as Record<string, unknown>[],
  rpc: {} as Record<string, unknown[]>,
}));

vi.mock('../db/index.js', () => {
  function table(name: string) {
    const filters: Record<string, unknown> = {};
    const api: Record<string, unknown> = {};
    api.select = () => api;
    api.order = () => api;
    api.limit = () => Promise.resolve({ data: applyFilters(), error: null });
    api.eq = (col: string, val: unknown) => {
      filters[col] = val;
      return api;
    };
    api.update = (payload: unknown) => {
      db.writes.push({ table: name, op: 'update', payload });
      return api;
    };
    api.upsert = (payload: unknown) => {
      db.writes.push({ table: name, op: 'upsert', payload });
      return Promise.resolve({ data: null, error: null });
    };
    api.insert = (payload: Record<string, unknown>) => {
      if (name === 'audit_logs') db.audits.push(payload);
      return Promise.resolve({ data: null, error: null });
    };
    api.maybeSingle = () => Promise.resolve({ data: applyFilters()[0] ?? null, error: null });
    api.then = (res: (v: unknown) => void) => res({ data: applyFilters(), error: null });

    function applyFilters() {
      if (name !== 'manager_queue') return [];
      return db.queue.filter((r) =>
        Object.entries(filters).every(([k, v]) => r[k] === v)
      );
    }
    return api;
  }
  return {
    supabase: {
      from: table,
      rpc: (fn: string) => Promise.resolve({ data: db.rpc[fn] ?? [], error: null }),
    },
  };
});

vi.mock('../services/permission.service.js', async () => {
  const { permissionServiceMock } = await import('./helpers/rbac.js');
  return permissionServiceMock();
});

const { queueRoutes, QUEUE_KINDS } = await import('../dashboard-api/queue.route.js');

const CLIENT = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const ITEM = '33333333-3333-4333-8333-333333333333';

async function buildApp() {
  const app = Fastify();
  await app.register(jwt, { secret: env.JWT_SECRET });
  await app.register(queueRoutes);
  await app.ready();
  return app;
}

function token(app: Awaited<ReturnType<typeof buildApp>>, role: string, clientId: string | null) {
  return app.jwt.sign({ sub: 'u-1', email: 'u@x.com', role, clientId });
}

beforeEach(() => {
  db.queue = [];
  db.writes = [];
  db.audits = [];
  db.rpc = {};
});

describe('the governing rule: every kind is closable', () => {
  // Iterates the kind list rather than naming kinds. A sixth kind added to the
  // view with no close path fails here rather than in production.
  for (const kind of QUEUE_KINDS) {
    it(`${kind} can be closed`, async () => {
      db.queue = [{ kind, id: ITEM, client_id: CLIENT, title: 't' }];
      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: `/queue/${kind}/${ITEM}/close`,
        headers: { authorization: `Bearer ${token(app, 'client_manager', CLIENT)}` },
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().closed).toBe(true);
      // ...and it actually wrote something, rather than reporting success.
      expect(db.writes.length).toBeGreaterThan(0);
      await app.close();
    });
  }

  it('rejects a kind the view does not produce', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/queue/made_up_kind/${ITEM}/close`,
      headers: { authorization: `Bearer ${token(app, 'client_manager', CLIENT)}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe('closing is idempotent', () => {
  // A double-submit from an impatient click must be a no-op, not a 404 the
  // operator has to interpret.
  it('reports success when the item is already gone', async () => {
    db.queue = [];
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/queue/flagged_call/${ITEM}/close`,
      headers: { authorization: `Bearer ${token(app, 'client_manager', CLIENT)}` },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ closed: true, alreadyClosed: true });
    expect(db.writes).toHaveLength(0);
    await app.close();
  });
});

describe('tenant isolation', () => {
  // The tenant is resolved from the queue row, never from the caller, so knowing
  // an id is not enough to close another tenant's item.
  it('refuses to close an item belonging to another tenant', async () => {
    db.queue = [{ kind: 'flagged_call', id: ITEM, client_id: OTHER, title: 't' }];
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/queue/flagged_call/${ITEM}/close`,
      headers: { authorization: `Bearer ${token(app, 'client_manager', CLIENT)}` },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect(db.writes).toHaveLength(0);
    await app.close();
  });

  it('lets platform staff close it', async () => {
    db.queue = [{ kind: 'flagged_call', id: ITEM, client_id: OTHER, title: 't' }];
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/queue/flagged_call/${ITEM}/close`,
      headers: { authorization: `Bearer ${token(app, 'support_agent', null)}` },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  // client_viewer is the read-only compliance role and holds no flags:write.
  it('denies client_viewer', async () => {
    db.queue = [{ kind: 'flagged_call', id: ITEM, client_id: CLIENT, title: 't' }];
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/queue/flagged_call/${ITEM}/close`,
      headers: { authorization: `Bearer ${token(app, 'client_viewer', CLIENT)}` },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

describe('audit', () => {
  it('records who closed what', async () => {
    db.queue = [{ kind: 'flagged_call', id: ITEM, client_id: CLIENT, title: 'Flagged call' }];
    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: `/queue/flagged_call/${ITEM}/close`,
      headers: { authorization: `Bearer ${token(app, 'client_manager', CLIENT)}` },
      payload: {},
    });
    expect(db.audits[0]).toMatchObject({
      action: 'queue.close',
      client_id: CLIENT,
      user_id: 'u-1',
    });
    await app.close();
  });

  it('distinguishes a dismissal from a close', async () => {
    db.queue = [{ kind: 'calendar_conflict', id: ITEM, client_id: CLIENT, title: 'Double-booked' }];
    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: `/queue/calendar_conflict/${ITEM}/close`,
      headers: { authorization: `Bearer ${token(app, 'client_manager', CLIENT)}` },
      payload: { note: 'resolved by phone' },
    });
    expect(db.audits[0]).toMatchObject({ action: 'queue.dismiss' });
    await app.close();
  });
});

describe('pulse', () => {
  it('nulls the change percent when last week was zero', async () => {
    db.rpc.report_pulse = [{ metric: 'calls', today: 5, same_day_last_week: 0 }];
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/queue/pulse',
      headers: { authorization: `Bearer ${token(app, 'client_manager', CLIENT)}` },
    });
    expect(res.json().data[0]).toMatchObject({ today: 5, sameDayLastWeek: 0, changePercent: null });
    await app.close();
  });

  it('computes the change when there is a baseline', async () => {
    db.rpc.report_pulse = [{ metric: 'calls', today: 15, same_day_last_week: 10 }];
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/queue/pulse',
      headers: { authorization: `Bearer ${token(app, 'client_manager', CLIENT)}` },
    });
    expect(res.json().data[0].changePercent).toBe(50);
    await app.close();
  });
});

describe('migration 025', () => {
  const sql = readFileSync(MIGRATION_025, 'utf8');
  // The live view, which 034 re-declares. The rule this enforces is about what
  // the queue currently emits, so it must read the current definition — not the
  // migration that happened to introduce the view first.
  const liveViewSql = readFileSync(MIGRATION_034, 'utf8');

  it('produces every kind the route knows how to close', () => {
    for (const kind of QUEUE_KINDS) {
      expect(liveViewSql).toContain(`'${kind}'`);
    }
  });

  /**
   * 034 must carry 025's branches forward unchanged. A `CREATE OR REPLACE VIEW`
   * restates the whole definition, so a paraphrase there silently rewrites
   * behaviour that four other tests in this file are asserting against 025 —
   * including the double-booking ordering rule below, which was a real bug.
   */
  it('carries the original branches into the replacement view verbatim', () => {
    // Line endings differ between the two files (025 is CRLF, 034 LF), and that
    // is not the thing under test — the SQL is.
    const lf = (s: string) => s.replace(/\r\n/g, '\n');
    const original = lf(sql);
    const branches = original.slice(
      original.indexOf('CREATE OR REPLACE VIEW manager_queue AS'),
      // Up to but not including the terminating semicolon: 034 continues the
      // statement with another UNION ALL where 025 ended it.
      original.lastIndexOf('    );') + '    )'.length
    );

    expect(branches).toContain('flagged_call');
    expect(lf(liveViewSql)).toContain(branches);
  });

  // The regression: two competing ordering conditions meant any conflict whose
  // earlier appointment held the higher random UUID matched neither and vanished
  // — silently missing about half of all double-bookings.
  it('deduplicates conflicts on one ordering rule, not two', () => {
    expect(sql).toContain('a.start_time < b.start_time OR (a.start_time = b.start_time AND a.id < b.id)');
    expect(sql).not.toMatch(/AND a\.start_time <= b\.start_time\s*\n\s*AND a\.id < b\.id/);
  });

  it('treats back-to-back appointments as non-overlapping', () => {
    expect(sql).toContain('b.start_time < a.end_time');
    expect(sql).toContain('b.end_time   > a.start_time');
  });

  // failed_jobs has no client_id; forgetting this leaks one tenant's failures
  // into another's queue.
  it('scopes failed bookings through job_data', () => {
    expect(sql).toContain("job_data ->> 'clientId'");
    expect(sql).toContain("fj.queue_name = 'booking'");
  });

  it('reads booking failures from failed_jobs, not a nonexistent event', () => {
    expect(sql).not.toContain("'booking.failed'");
  });

  it('excludes already-dismissed derived items', () => {
    expect(sql.match(/queue_dismissals/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});
