import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { env } from '../config/index.js';

/**
 * `/analytics/overview` is the cross-company roll-up (Task 6). It already
 * aggregates every tenant when no `clientId` is given, which is exactly why it
 * must be platform-only: a client-scoped user must never be able to reach a
 * handler that can return every tenant's figures. `requirePermission` alone is
 * not enough — `client_owner` already holds `analytics:read` (it always has,
 * for the Business tab), so swapping the guard back to `requirePermission`
 * would let a client through. `requirePlatform` adds the extra
 * `isPlatformUser` check that this file exists to pin down.
 */

const db = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
  appointments: [] as Array<Record<string, unknown>>,
  conversations: [] as Array<Record<string, unknown>>,
}));

vi.mock('../db/index.js', () => {
  function tableStore(table: string): Array<Record<string, unknown>> {
    if (table === 'calls') return db.calls;
    if (table === 'appointments') return db.appointments;
    if (table === 'conversations') return db.conversations;
    return [];
  }

  function makeChain(table: string) {
    const store = tableStore(table);
    const filters: Record<string, unknown> = {};

    const chain: Record<string, unknown> = {
      select: () => chain,
      gte: () => chain,
      lte: () => chain,
      eq: (col: string, val: unknown) => {
        filters[col] = val;
        return chain;
      },
      then: (resolve: (v: unknown) => void) => {
        const rows = store.filter((row) =>
          Object.entries(filters).every(([col, val]) => row[col] === val)
        );
        resolve({ data: rows, count: rows.length, error: null });
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

// requirePermission/requirePlatform resolve grants from the database; serve
// them from the migrations instead so this route test stays offline and stays
// true to the real grant table rather than a hand-maintained duplicate.
vi.mock('../services/permission.service.js', async () => {
  const { permissionServiceMock } = await import('./helpers/rbac.js');
  return permissionServiceMock();
});

const { analyticsRoutes } = await import('../dashboard-api/analytics.route.js');

const CLIENT = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

async function buildApp() {
  const app = Fastify();
  await app.register(jwt, { secret: env.JWT_SECRET });
  await app.register(analyticsRoutes);
  await app.ready();
  return app;
}

function tokenFor(app: Awaited<ReturnType<typeof buildApp>>, role: string, clientId: string | null) {
  return app.jwt.sign({ sub: 'u-' + role, email: 'x@y.com', role, clientId });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.calls = [
    { id: 'c-1', client_id: CLIENT, status: 'completed', duration_seconds: 60 },
    { id: 'c-2', client_id: CLIENT, status: 'completed', duration_seconds: 120 },
    { id: 'c-3', client_id: OTHER, status: 'completed', duration_seconds: 30 },
  ];
  db.appointments = [];
  db.conversations = [];
});

describe('GET /analytics/overview (platform only)', () => {
  it('a platform user with no clientId sees every tenant aggregated', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/analytics/overview',
      headers: { authorization: `Bearer ${tokenFor(app, 'super_admin', null)}` },
    });
    expect(res.statusCode).toBe(200);
    // All three calls, across both tenants, are counted — the all-companies view.
    expect(res.json().totalCalls).toBe(3);
    await app.close();
  });

  it('a platform user with a clientId filters to just that tenant', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/analytics/overview?clientId=${CLIENT}`,
      headers: { authorization: `Bearer ${tokenFor(app, 'super_admin', null)}` },
    });
    expect(res.statusCode).toBe(200);
    // Only CLIENT's two calls, not OTHER's.
    expect(res.json().totalCalls).toBe(2);
    await app.close();
  });

  // The whole point of this file: a client-scoped user must be turned away
  // before reaching a handler that can hand back every tenant's numbers, even
  // though `client_owner` holds `analytics:read` (it needs that grant for the
  // Business tab). This fails if the guard is reverted to bare
  // `requirePermission('analytics:read')` — a client_owner token would then
  // get 200 with `totalCalls: 2` instead of 403.
  it('a client-scoped user is forbidden, even with analytics:read', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/analytics/overview',
      headers: { authorization: `Bearer ${tokenFor(app, 'client_owner', CLIENT)}` },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
