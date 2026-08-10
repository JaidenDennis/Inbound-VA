import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The call_analyzed path is where transcripts enter the system, and it broke in
 * two places at once:
 *
 *   1. upsertSummary threw 42P10 (no unique index on call_summaries.call_id),
 *      aborting the handler BEFORE the transcript was ever enqueued. Fixed in
 *      migration 028; guarded statically by supabase-upsert-conflicts.test.ts.
 *
 *   2. A missing `calls` row — call_started never delivered — returned 404 and
 *      discarded the transcript, for 24 of 41 real calls.
 *
 * These tests pin the resulting behaviour: the transcript is enqueued for a
 * known call, AND for a call whose row has to be rebuilt from the payload.
 */

const queues = vi.hoisted(() => ({
  transcriptAdd: vi.fn().mockResolvedValue(undefined),
  crmAdd: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../queues/index.js', () => ({
  transcriptProcessingQueue: { add: queues.transcriptAdd },
  crmSyncQueue: { add: queues.crmAdd },
  callProcessingQueue: { add: vi.fn() },
  callAnalysisQueue: { add: vi.fn() },
  redis: {},
}));

const db = vi.hoisted(() => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }),
        }),
      }),
    }),
  },
}));
vi.mock('../db/index.js', () => ({ supabase: db.supabase }));

const svc = vi.hoisted(() => ({
  findByRetellId: vi.fn(),
  upsertCallByRetellId: vi.fn().mockResolvedValue(undefined),
  upsertSummary: vi.fn().mockResolvedValue({}),
  findByPhoneNumber: vi.fn(),
  findByAgentId: vi.fn(),
  upsertByPhone: vi.fn(),
  recordFromAnalyzed: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../services/index.js', () => ({
  callService: {
    findByRetellId: svc.findByRetellId,
    upsertCallByRetellId: svc.upsertCallByRetellId,
    upsertSummary: svc.upsertSummary,
    endCall: vi.fn(),
    upsertConversation: vi.fn(),
    createCall: vi.fn(),
  },
  clientService: {
    findByPhoneNumber: svc.findByPhoneNumber,
    findByAgentId: svc.findByAgentId,
    getSettings: vi.fn().mockResolvedValue(null),
  },
  contactService: { upsertByPhone: svc.upsertByPhone },
  callRecordService: { recordFromAnalyzed: svc.recordFromAnalyzed },
}));

vi.mock('../events/index.js', () => ({ eventBus: { publish: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('../workflows/index.js', () => ({ createSession: vi.fn() }));
// Must be a real arity-2 async function, NOT vi.fn(): Fastify inspects hook
// arity, reads a bare mock as callback-style (req, reply, done) and then waits
// forever for a `done()` that never comes, hanging every injected request.
vi.mock('../middleware/index.js', () => ({
  validateRetellWebhook: async (_req: unknown, _reply: unknown) => undefined,
}));
vi.mock('../providers/retell/index.js', () => ({
  normalizeCallStarted: vi.fn(),
  normalizeCallEnded: vi.fn(),
  normalizeSummary: vi.fn().mockReturnValue({ type: 'call.summary.completed' }),
}));

import Fastify from 'fastify';
import { retellWebhookDispatcher } from '../routes/webhooks/retell-dispatcher.route.js';

const TRANSCRIPT = [
  { role: 'agent' as const, content: 'Thanks for calling Bare Beauty, this is Emily.' },
  { role: 'user' as const, content: "Hi, I'd like to book a consultation." },
];

function payload(over: Record<string, unknown> = {}) {
  return {
    event: 'call_analyzed',
    call: {
      call_id: 'call_abc',
      agent_id: 'agent_x',
      from_number: '+12242431108',
      to_number: '+19047605971',
      start_timestamp: 1_700_000_000_000,
      end_timestamp: 1_700_000_060_000,
      duration_ms: 60_000,
      transcript_object: TRANSCRIPT,
      call_analysis: { call_summary: 'Caller booked a consultation.', user_sentiment: 'Positive' },
      ...over,
    },
  };
}

async function build() {
  const app = Fastify();
  await app.register(retellWebhookDispatcher);
  return app;
}

describe('call_analyzed → transcript lands', () => {
  beforeEach(() => vi.clearAllMocks());

  it('enqueues the transcript when the calls row exists', async () => {
    svc.findByRetellId.mockResolvedValue({ id: 'call-uuid', client_id: 'client-a', contact_id: 'contact-a' });

    const app = await build();
    const res = await app.inject({ method: 'POST', url: '/webhooks/retell', payload: payload() });

    expect(res.statusCode).toBe(200);
    expect(svc.upsertSummary).toHaveBeenCalledWith(
      expect.objectContaining({ call_id: 'call-uuid', summary: 'Caller booked a consultation.' })
    );
    expect(queues.transcriptAdd).toHaveBeenCalledTimes(1);
    expect(queues.transcriptAdd.mock.calls[0][1]).toMatchObject({
      callId: 'call-uuid',
      clientId: 'client-a',
      transcript: [
        { role: 'agent', content: TRANSCRIPT[0].content },
        { role: 'user', content: TRANSCRIPT[1].content },
      ],
    });
  });

  it('rebuilds a missing calls row and still enqueues the transcript', async () => {
    // call_started was never delivered: no row on first lookup, present after
    // the rebuild.
    svc.findByRetellId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'rebuilt-uuid', client_id: 'client-a', contact_id: 'contact-a' });
    svc.findByPhoneNumber.mockResolvedValue({ id: 'client-a' });
    svc.upsertByPhone.mockResolvedValue({ id: 'contact-a' });

    const app = await build();
    const res = await app.inject({ method: 'POST', url: '/webhooks/retell', payload: payload() });

    expect(res.statusCode).toBe(200);
    expect(svc.upsertCallByRetellId).toHaveBeenCalledWith(
      expect.objectContaining({
        retell_call_id: 'call_abc',
        client_id: 'client-a',
        contact_id: 'contact-a',
        from_number: '+12242431108',
        to_number: '+19047605971',
        status: 'completed',
        duration_seconds: 60,
      })
    );
    expect(queues.transcriptAdd).toHaveBeenCalledTimes(1);
    expect(queues.transcriptAdd.mock.calls[0][1]).toMatchObject({ callId: 'rebuilt-uuid' });
  });

  it('rebuilds a web call (no phone numbers) without inventing a contact', async () => {
    svc.findByRetellId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'web-uuid', client_id: 'client-a', contact_id: null });
    svc.findByAgentId.mockResolvedValue({ id: 'client-a' });

    const app = await build();
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/retell',
      payload: payload({ from_number: undefined, to_number: undefined }),
    });

    expect(res.statusCode).toBe(200);
    expect(svc.upsertByPhone).not.toHaveBeenCalled();
    expect(svc.upsertCallByRetellId).toHaveBeenCalledWith(
      expect.objectContaining({ contact_id: null, from_number: '', to_number: '' })
    );
    expect(queues.transcriptAdd).toHaveBeenCalledTimes(1);
  });

  it('404s only when the tenant itself cannot be resolved', async () => {
    svc.findByRetellId.mockResolvedValue(null);
    svc.findByPhoneNumber.mockResolvedValue(null);
    svc.findByAgentId.mockResolvedValue(null);

    const app = await build();
    const res = await app.inject({ method: 'POST', url: '/webhooks/retell', payload: payload() });

    expect(res.statusCode).toBe(404);
    expect(svc.upsertCallByRetellId).not.toHaveBeenCalled();
    expect(queues.transcriptAdd).not.toHaveBeenCalled();
  });

  it('still records the call_record even when the tenant lookup fails downstream', async () => {
    svc.findByRetellId.mockResolvedValue(null);
    svc.findByPhoneNumber.mockResolvedValue(null);
    svc.findByAgentId.mockResolvedValue(null);

    const app = await build();
    await app.inject({ method: 'POST', url: '/webhooks/retell', payload: payload() });

    // recordFromAnalyzed resolves its own tenant and must run regardless.
    expect(svc.recordFromAnalyzed).toHaveBeenCalledTimes(1);
  });
});
