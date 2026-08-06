import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { env } from '../config/index.js';

/**
 * Two things are being protected here.
 *
 * Transcripts carry caller PII — names, numbers, sometimes health or financial
 * detail — so they sit behind their own permission rather than riding along with
 * the call log. Recordings never reach a client at all: they exist for our
 * troubleshooting, and the client path must not be able to return one even by
 * accident.
 */

const CLIENT = '11111111-1111-1111-1111-111111111111';
const OTHER_CLIENT = '22222222-2222-2222-2222-222222222222';

const CALL_ROW = {
  id: 'call-log-1',
  client_id: CLIENT,
  call_id: 'calls-1',
  from_number: '+15551234567',
  started_at: '2026-08-01T10:00:00Z',
  duration_seconds: 184,
  outcome: 'appointment_booked',
  user_sentiment: 'positive',
  has_transcript: true,
};

const db = vi.hoisted(() => {
  const state = { callRow: null as Record<string, unknown> | null };
  const supabase = {
    from(table: string) {
      const result = (() => {
        if (table === 'client_call_log') return state.callRow;
        if (table === 'call_transcripts') return { transcript: [{ role: 'agent', content: 'Hello' }], word_count: 2 };
        if (table === 'call_summaries') return { summary: 'Booked a consultation' };
        if (table === 'calls') return { recording_url: 'https://recordings.example/abc.wav' };
        return null;
      })();

      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        gte: () => builder,
        lte: () => builder,
        lt: () => builder,
        ilike: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: () => Promise.resolve({ data: result, error: null }),
        then: (resolve_: (v: unknown) => unknown) =>
          Promise.resolve({ data: result ? [result] : [], error: null }).then(resolve_),
      };
      return builder;
    },
    rpc: () => Promise.resolve({ data: [], error: null }),
  };
  return { state, supabase };
});
vi.mock('../db/index.js', () => ({ supabase: db.supabase }));

vi.mock('../services/permission.service.js', async () => {
  const { permissionServiceMock } = await import('./helpers/rbac.js');
  return permissionServiceMock();
});

vi.mock('../services/index.js', () => ({
  callRecordService: {
    getStats: vi.fn().mockResolvedValue({
      callsAnswered: 10, missedCallsRecovered: 1, leadsRecaptured: 2,
      appointmentsBooked: 3, avgCallDurationSeconds: 120, totalCalls: 12,
    }),
    getVolume: vi.fn().mockResolvedValue([]),
    getOutcomes: vi.fn().mockResolvedValue([]),
  },
}));

const { reportRoutes } = await import('../dashboard-api/reports.route.js');

async function buildApp() {
  const app = Fastify();
  await app.register(jwt, { secret: env.JWT_SECRET });
  await app.register(reportRoutes);
  await app.ready();
  return app;
}

function token(app: Awaited<ReturnType<typeof buildApp>>, role: string, clientId: string | null) {
  return app.jwt.sign({ sub: `u-${role}`, email: `${role}@x.com`, role, clientId });
}

describe('transcript access', () => {
  beforeEach(() => {
    db.state.callRow = { ...CALL_ROW };
  });

  it('allows client_owner', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/reports/calls/call-log-1/transcript',
      headers: { authorization: `Bearer ${token(app, 'client_owner', CLIENT)}` },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('allows client_manager', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/reports/calls/call-log-1/transcript',
      headers: { authorization: `Bearer ${token(app, 'client_manager', CLIENT)}` },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('refuses client_viewer', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/reports/calls/call-log-1/transcript',
      headers: { authorization: `Bearer ${token(app, 'client_viewer', CLIENT)}` },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('refuses a client_owner from another tenant', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/reports/calls/call-log-1/transcript',
      headers: { authorization: `Bearer ${token(app, 'client_owner', OTHER_CLIENT)}` },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('still lets client_viewer see the call list — only the words are gated', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/reports/calls',
      headers: { authorization: `Bearer ${token(app, 'client_viewer', CLIENT)}` },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});

describe('recording access', () => {
  beforeEach(() => {
    db.state.callRow = { ...CALL_ROW };
  });

  it('is refused to every client role, including the owner', async () => {
    const app = await buildApp();
    for (const role of ['client_owner', 'client_manager', 'client_viewer']) {
      const res = await app.inject({
        method: 'GET',
        url: '/reports/calls/call-log-1/recording',
        headers: { authorization: `Bearer ${token(app, role, CLIENT)}` },
      });
      expect(res.statusCode).toBe(403);
    }
    await app.close();
  });

  it('is allowed for support staff, who need it to troubleshoot', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/reports/calls/call-log-1/recording',
      headers: { authorization: `Bearer ${token(app, 'support_agent', null)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().recordingUrl).toContain('https://');
    await app.close();
  });

  it('is refused to an analyst', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/reports/calls/call-log-1/recording',
      headers: { authorization: `Bearer ${token(app, 'analyst', null)}` },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('never appears in a client-facing call payload', async () => {
    const app = await buildApp();
    for (const url of ['/reports/calls', '/reports/calls/call-log-1']) {
      const res = await app.inject({
        method: 'GET',
        url,
        headers: { authorization: `Bearer ${token(app, 'client_owner', CLIENT)}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain('recording_url');
      expect(res.body).not.toContain('recordings.example');
    }
    await app.close();
  });
});

describe('client_call_log view', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const migration = readFileSync(
    resolve(here, '../../../supabase/migrations/020_reporting.sql'),
    'utf8'
  );
  const viewBody = migration.slice(migration.indexOf('CREATE OR REPLACE VIEW client_call_log'));

  // Structural guarantee, not just a route-level one: if the column is not in
  // the view, no client-path query can select it however it is written later.
  it('does not expose recording_url at all', () => {
    expect(viewBody).not.toContain('recording_url');
  });

  it('evaluates voicemail before "question answered"', () => {
    // Retell can mark a voicemail call_successful. The reverse order would file
    // voicemails as answered questions and inflate the headline outcome.
    const outcomeFn = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION call_outcome'),
      migration.indexOf('-- KPI cards')
    );
    expect(outcomeFn.indexOf('voicemail')).toBeLessThan(outcomeFn.indexOf('question_answered'));
  });

  it('buckets the volume trend in the client timezone, not UTC', () => {
    expect(migration).toContain('AT TIME ZONE v_tz');
  });
});
