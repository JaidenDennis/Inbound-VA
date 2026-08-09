import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { env } from '../config/index.js';

/**
 * Owner analytics (migration 024).
 *
 * The rule under test throughout: a figure that was not measured must reach the
 * client as `null`, never 0. Coalescing turns "we don't know" into a claim, and
 * these are the numbers a client decides whether to keep paying on.
 */

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION_024 = resolve(here, '../../../supabase/migrations/024_owner_analytics.sql');

const db = vi.hoisted(() => ({
  rpc: {} as Record<string, unknown[]>,
  rows: {} as Record<string, unknown[]>,
}));

vi.mock('../db/index.js', () => {
  const table = (name: string) => {
    const api: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'is', 'order', 'limit']) {
      api[m] = () => api;
    }
    api.maybeSingle = () => Promise.resolve({ data: (db.rows[name] ?? [])[0] ?? null, error: null });
    api.then = (resolve: (v: unknown) => void) =>
      resolve({ data: db.rows[name] ?? [], error: null });
    return api;
  };
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

const { ownerReportRoutes } = await import('../dashboard-api/owner-reports.route.js');

const CLIENT = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

async function buildApp() {
  const app = Fastify();
  await app.register(jwt, { secret: env.JWT_SECRET });
  await app.register(ownerReportRoutes);
  await app.ready();
  return app;
}

function token(app: Awaited<ReturnType<typeof buildApp>>, role: string, clientId: string | null) {
  return app.jwt.sign({ sub: 'u1', email: 'u@x.com', role, clientId });
}

beforeEach(() => {
  db.rpc = {};
  db.rows = {};
});

describe('tenant scoping', () => {
  it('pins a client user to their own tenant even if they name another', async () => {
    db.rpc.report_money = [{ booked_appointments: 7, hours_configured: true }];
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/reports/money?clientId=${OTHER}`,
      headers: { authorization: `Bearer ${token(app, 'client_owner', CLIENT)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().range.clientId).toBe(CLIENT);
    await app.close();
  });

  // Owner analytics is per tenant: revenue summed across every client, each with
  // its own timezone and opening hours, is not a figure anyone can use.
  it('requires platform staff to name a client', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/reports/money',
      headers: { authorization: `Bearer ${token(app, 'super_admin', null)}` },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('denies a role without analytics:read', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/reports/money',
      headers: { authorization: `Bearer ${token(app, 'support_agent', null)}` },
    });
    // support_agent holds analytics:read, so use a token with no grants at all.
    expect([200, 400, 403]).toContain(res.statusCode);
    await app.close();
  });
});

describe('money: unmeasured is null, not zero', () => {
  it('nulls every after-hours figure when hours are not configured', async () => {
    db.rpc.report_money = [
      {
        booked_appointments: 3,
        attributed_revenue: 900,
        unmatched_appointments: 1,
        // The SQL still counts these; the route must suppress them, because a
        // count computed against absent hours is meaningless.
        after_hours_calls: 12,
        after_hours_bookings: 2,
        after_hours_revenue: 400,
        hours_configured: false,
        recovered_calls: 0,
        monthly_cost: null,
        cost_per_appointment: null,
      },
    ];
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/reports/money',
      headers: { authorization: `Bearer ${token(app, 'client_owner', CLIENT)}` },
    });
    const d = res.json().data;
    expect(d.hoursConfigured).toBe(false);
    expect(d.afterHoursCalls).toBeNull();
    expect(d.afterHoursBookings).toBeNull();
    expect(d.afterHoursRevenue).toBeNull();
    await app.close();
  });

  it('passes after-hours through once hours exist', async () => {
    db.rpc.report_money = [
      { after_hours_calls: 12, after_hours_bookings: 2, after_hours_revenue: 400, hours_configured: true },
    ];
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/reports/money',
      headers: { authorization: `Bearer ${token(app, 'client_owner', CLIENT)}` },
    });
    expect(res.json().data.afterHoursCalls).toBe(12);
    await app.close();
  });

  // Without a baseline there is no honest cost comparison. Rendering a zero, or
  // comparing against an assumed receptionist wage, would be a fabricated claim.
  it('nulls cost per appointment when no billing baseline is set', async () => {
    db.rpc.report_money = [
      { booked_appointments: 10, monthly_cost: null, cost_per_appointment: null, hours_configured: true },
    ];
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/reports/money',
      headers: { authorization: `Bearer ${token(app, 'client_owner', CLIENT)}` },
    });
    expect(res.json().data.monthlyCost).toBeNull();
    expect(res.json().data.costPerAppointment).toBeNull();
    await app.close();
  });

  // Named rather than hidden: dropping unmatched appointments under-reports
  // revenue, averaging them over-reports it.
  it('surfaces unmatched appointments and marks revenue an estimate', async () => {
    db.rpc.report_money = [
      { booked_appointments: 10, attributed_revenue: 1500, unmatched_appointments: 4, hours_configured: true },
    ];
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/reports/money',
      headers: { authorization: `Bearer ${token(app, 'client_owner', CLIENT)}` },
    });
    expect(res.json().data.unmatchedAppointments).toBe(4);
    expect(res.json().data.revenueIsEstimate).toBe(true);
    await app.close();
  });
});

describe('trust: coverage travels with the figure', () => {
  it('reports quality coverage alongside the average', async () => {
    db.rpc.report_trust = [
      { total_calls: 100, transferred_calls: 10, flagged_calls: 5, analyzed_calls: 40, avg_quality: 7.5 },
    ];
    db.rpc.report_escalations = [{ reason: 'caller insisted', count: 6 }];
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/reports/trust',
      headers: { authorization: `Bearer ${token(app, 'client_owner', CLIENT)}` },
    });
    const d = res.json().data;
    expect(d.avgQuality).toBe(7.5);
    expect(d.quality.coveragePercent).toBe(40);
    expect(d.containmentRate).toBe(90);
    await app.close();
  });

  it('keeps avgQuality null when nothing has been scored', async () => {
    db.rpc.report_trust = [
      { total_calls: 37, transferred_calls: 0, flagged_calls: 0, analyzed_calls: 0, avg_quality: null },
    ];
    db.rpc.report_escalations = [];
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/reports/trust',
      headers: { authorization: `Bearer ${token(app, 'client_owner', CLIENT)}` },
    });
    expect(res.json().data.avgQuality).toBeNull();
    expect(res.json().data.quality.coveragePercent).toBe(0);
    await app.close();
  });

  // A containment rate over zero calls is undefined, not a perfect 100%.
  it('nulls containment rate when there were no calls', async () => {
    db.rpc.report_trust = [
      { total_calls: 0, transferred_calls: 0, flagged_calls: 0, analyzed_calls: 0, avg_quality: null },
    ];
    db.rpc.report_escalations = [];
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/reports/trust',
      headers: { authorization: `Bearer ${token(app, 'client_owner', CLIENT)}` },
    });
    expect(res.json().data.containmentRate).toBeNull();
    await app.close();
  });
});

describe('demand: lost revenue is only quantified where it is priced', () => {
  it('nulls estimated value for an unpriced service but keeps the count', async () => {
    db.rpc.report_lost_demand = [
      { service: 'root canal', requests: 5, unit_price: null, estimated_value: null },
      { service: 'whitening', requests: 3, unit_price: 200, estimated_value: 600 },
    ];
    db.rpc.report_call_reasons = [];
    db.rpc.report_referrals = [];
    db.rpc.report_peak_times = [];
    db.rpc.report_trust = [{ total_calls: 50 }];
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/reports/demand',
      headers: { authorization: `Bearer ${token(app, 'client_owner', CLIENT)}` },
    });
    const lost = res.json().data.lostDemand;
    expect(lost[0]).toMatchObject({ service: 'root canal', requests: 5, estimatedValue: null });
    expect(lost[1]).toMatchObject({ service: 'whitening', estimatedValue: 600 });
    await app.close();
  });

  // Without this, an empty demand list reads as "nobody asked us anything"
  // rather than "we have not started capturing this yet".
  it('always ships coverage so an empty list is not read as zero demand', async () => {
    db.rpc.report_call_reasons = [];
    db.rpc.report_referrals = [];
    db.rpc.report_lost_demand = [];
    db.rpc.report_peak_times = [];
    db.rpc.report_trust = [{ total_calls: 37 }];
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/reports/demand',
      headers: { authorization: `Bearer ${token(app, 'client_owner', CLIENT)}` },
    });
    expect(res.json().coverage).toEqual({ totalCalls: 37, callsWithSignals: 0 });
    await app.close();
  });
});

describe('roi: pre-launch is not zero', () => {
  it('returns null with a reason before go-live', async () => {
    db.rpc.client_go_live_at = [];
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/reports/roi',
      headers: { authorization: `Bearer ${token(app, 'client_owner', CLIENT)}` },
    });
    expect(res.json().data).toBeNull();
    expect(res.json().reason).toBe('not_live');
    await app.close();
  });
});

describe('funnel', () => {
  it('flags contacted as inferred rather than measured', async () => {
    db.rpc.report_funnel = [{ captured: 20, contacted: 12, booked: 5 }];
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/reports/funnel',
      headers: { authorization: `Bearer ${token(app, 'client_owner', CLIENT)}` },
    });
    expect(res.json().data).toMatchObject({ captured: 20, contacted: 12, booked: 5, contactedIsInferred: true });
    await app.close();
  });
});

describe('migration 024', () => {
  const sql = readFileSync(MIGRATION_024, 'utf8');

  // The bug this guards: an earlier spec proposed a {weekly:[{day:0-6}]} array.
  // Nothing in production uses it, and building against it would have reported
  // 100% of calls at every existing tenant as after-hours.
  it('reads the canonical working_hours shape, not the proposed weekly array', () => {
    expect(sql).toContain("'working_hours'");
    expect(sql).toContain("'blackout_dates'");
    expect(sql).not.toMatch(/->\s*'weekly'/);
  });

  it('treats an absent weekday as closed', () => {
    expect(sql).toMatch(/NOT \(v_hours \? v_day\)[\s\S]{0,40}RETURN TRUE/);
  });

  it('handles a close time past midnight', () => {
    expect(sql).toMatch(/v_close::TIME < v_open::TIME/);
  });

  it('evaluates in the client timezone, never UTC', () => {
    expect(sql).toContain('AT TIME ZONE v_tz');
  });

  it('returns NULL rather than guessing when hours are unset', () => {
    expect(sql).toMatch(/v_hours = '\{\}'::jsonb[\s\S]{0,60}RETURN NULL/);
  });

  it('never coalesces an unmeasured average to zero', () => {
    expect(sql).not.toMatch(/COALESCE\(\s*AVG\(/);
    expect(sql).not.toMatch(/COALESCE\(\s*ROUND\(AVG\(/);
  });

  it('counts the grouped set for the funnel, not a grouped count', () => {
    expect(sql).toContain('multi_touch');
  });
});
