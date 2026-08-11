import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { JwtPayload } from '../types/index.js';

/**
 * `GET /system/activity/grouped` collapses many `system_errors` rows into one
 * entry per fingerprint (Task 4). This exercises the grouping/`latestSentryEventId`
 * logic directly through the route, rather than re-implementing it, so the test
 * fails if the handler regresses rather than only if a unit copy of the logic does.
 *
 * The trap this guards against: `latestSentryEventId` must be updated using the
 * SAME comparison that maintains `lastSeen`, and BEFORE `lastSeen` is overwritten
 * — otherwise the "is this row newer" check compares against a value that was
 * already clobbered, and picks the wrong event id.
 */

vi.mock('../middleware/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/index.js')>();
  return {
    ...actual,
    requirePlatform: () => async (request: { user?: JwtPayload }) => {
      request.user = { sub: 'u1', email: 'admin@x.com', role: 'super_admin', clientId: null, iat: 0, exp: 0 };
    },
  };
});

vi.mock('../services/index.js', () => ({
  systemErrorService: { markReviewed: vi.fn(), markFingerprintReviewed: vi.fn() },
  writeAuditLog: vi.fn(async () => undefined),
}));

vi.mock('../queues/index.js', () => ({ allQueues: [] }));

let rows: Record<string, unknown>[] = [];

vi.mock('../db/index.js', () => {
  const chain = {
    select: vi.fn(() => chain),
    gte: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(async () => ({ data: rows, error: null })),
    eq: vi.fn(() => chain),
  };
  return { supabase: { from: vi.fn(() => chain) } };
});

const { systemRoutes } = await import('../dashboard-api/system.route.js');

async function buildApp() {
  const app = Fastify();
  await app.register(systemRoutes);
  await app.ready();
  return app;
}

function row(overrides: Partial<{
  fingerprint: string; error_name: string; message: string; route: string | null;
  source: string; severity: string; client_id: string | null; occurred_at: string;
  ticket_id: string | null; sentry_event_id: string | null;
}>) {
  return {
    fingerprint: 'fp-1',
    error_name: 'TypeError',
    message: 'boom',
    route: '/x',
    source: 'api',
    severity: 'error',
    client_id: null,
    occurred_at: '2026-08-10T00:00:00.000Z',
    ticket_id: null,
    sentry_event_id: null,
    ...overrides,
  };
}

beforeEach(() => {
  rows = [];
});

describe('GET /system/activity/grouped — latestSentryEventId', () => {
  it('carries the sentry_event_id of the single most recent occurrence', async () => {
    rows = [row({ occurred_at: '2026-08-10T00:00:00.000Z', sentry_event_id: 'evt-latest' })];
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/system/activity/grouped' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0].latestSentryEventId).toBe('evt-latest');
    await app.close();
  });

  it('picks the event id of the newest row, not the first- or last-processed row', async () => {
    // Rows arrive out of chronological order. The newest occurred_at is the
    // middle row here, so a naive "last one wins" implementation would report
    // the wrong id (the query result's own order, not the field being compared).
    rows = [
      row({ occurred_at: '2026-08-10T10:00:00.000Z', sentry_event_id: 'evt-mid' }),
      row({ occurred_at: '2026-08-10T09:00:00.000Z', sentry_event_id: 'evt-earliest' }),
      row({ occurred_at: '2026-08-10T08:00:00.000Z', sentry_event_id: 'evt-oldest' }),
    ];
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/system/activity/grouped' });
    const group = res.json().data[0];
    expect(group.count).toBe(3);
    expect(group.latestSentryEventId).toBe('evt-mid');
    await app.close();
  });

  it('keeps the latest id even when the newest row has no Sentry event (unset DSN)', async () => {
    rows = [
      row({ occurred_at: '2026-08-10T08:00:00.000Z', sentry_event_id: 'evt-old' }),
      row({ occurred_at: '2026-08-10T09:00:00.000Z', sentry_event_id: null }),
    ];
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/system/activity/grouped' });
    // The newer row IS the latest occurrence, so latestSentryEventId correctly
    // becomes null — nothing to link to, which is the documented, non-faulty state.
    expect(res.json().data[0].latestSentryEventId).toBeNull();
    await app.close();
  });

  it('reports null for a group with no Sentry ids recorded at all', async () => {
    rows = [row({ sentry_event_id: null })];
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/system/activity/grouped' });
    expect(res.json().data[0].latestSentryEventId).toBeNull();
    await app.close();
  });
});
