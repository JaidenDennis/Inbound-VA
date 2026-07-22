import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import CryptoJS from 'crypto-js';
import type { CallSessionRecord, CallSessionState } from '../types/index.js';

// Phase 5 — Account & Ops: identity verification gate, membership/payment/docs
// (identity-required), caller complaint ticket, callback lifecycle, language +
// location context.

const clientObj = { id: 'c1', name: 'Glow', timezone: 'America/New_York' };
let settingsObj: Record<string, unknown>;
let contactRow: Record<string, unknown> | null;

vi.mock('../services/index.js', () => ({
  clientService: {
    findByPhoneNumber: vi.fn(() => Promise.resolve(clientObj)),
    findByAgentId: vi.fn(() => Promise.resolve(clientObj)),
    getSettings: vi.fn(() => Promise.resolve(settingsObj)),
  },
  contactService: {
    findByPhone: vi.fn(() => Promise.resolve(contactRow)),
    upsertByPhone: vi.fn(() => Promise.resolve({ id: 'ct1', first_name: 'Jane', last_name: 'Doe' })),
  },
  callService: {
    findByRetellId: vi.fn(() => Promise.resolve({ id: 'call1', client_id: 'c1', contact_id: 'ct1' })),
    upsertConversation: vi.fn(() => Promise.resolve({})),
  },
  knowledgeService: { settingsWithKnowledge: vi.fn((_id: string, s: unknown) => Promise.resolve(s)) },
  ticketService: {
    createFromCaller: vi.fn(() => Promise.resolve({ id: 'ticket1' })),
  },
}));

const notifAdd = vi.fn(() => Promise.resolve(undefined));
vi.mock('../queues/index.js', () => ({ notificationsQueue: { add: notifAdd }, crmSyncQueue: { add: vi.fn() } }));
vi.mock('../booking/index.js', () => ({ bookingService: {} }));

const inserts: Record<string, Array<Record<string, unknown>>> = { staff_notifications: [], callback_requests: [] };
let apptRow: Record<string, unknown> | null = null;
vi.mock('../db/index.js', () => ({
  supabase: {
    from: vi.fn((table: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({ maybeSingle: vi.fn(() => Promise.resolve({ data: apptRow, error: null })) })),
            maybeSingle: vi.fn(() => Promise.resolve({ data: apptRow, error: null })),
          })),
          maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
        })),
      })),
      insert: vi.fn((row: Record<string, unknown>) => {
        (inserts[table] ??= []).push(row);
        return Promise.resolve({ error: null });
      }),
    })),
  },
}));

// In-memory session store shared by scope guard + workflow tools.
const sessions = new Map<string, CallSessionRecord>();
const blank = (): CallSessionState => ({
  routingEnabled: true,
  active: null,
  stack: [],
  grantedScopes: ['crm', 'payments', 'support'],
  identityVerified: false,
  emergencyFlagged: false,
  context: { previousTopics: [], summaryNotes: [] },
  eventSeq: 0,
});
vi.mock('../workflows/engine/session-store.js', () => ({
  emptySessionState: blank,
  findSession: vi.fn((id: string) => Promise.resolve(sessions.get(id) ?? null)),
  createSession: vi.fn((input: { clientId: string; retellCallId: string; callId?: string | null }) => {
    const existing = sessions.get(input.retellCallId);
    if (existing) return Promise.resolve(existing);
    const rec: CallSessionRecord = {
      id: `cs-${input.retellCallId}`,
      client_id: input.clientId,
      call_id: input.callId ?? null,
      retell_call_id: input.retellCallId,
      state: blank(),
      created_at: '',
      updated_at: '',
    };
    sessions.set(input.retellCallId, rec);
    return Promise.resolve(rec);
  }),
  saveSessionState: vi.fn((id: string, state: CallSessionState) => {
    const rec = sessions.get(id);
    if (rec) rec.state = state;
    return Promise.resolve();
  }),
}));

const { retellFunctionRoutes } = await import('../routes/functions/retell-functions.route.js');
const { workflowFunctionRoutes } = await import('../routes/functions/workflow-functions.route.js');
const { resolveWorkflowByIntent } = await import('../workflows/index.js');

function sign(rawBody: string, now = Date.now()): string {
  const d = CryptoJS.HmacSHA256(rawBody + now, process.env.RETELL_API_KEY as string).toString(CryptoJS.enc.Hex);
  return `v=${now},d=${d}`;
}
async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    (req as unknown as { rawBody: string }).rawBody = body as string;
    done(null, body ? JSON.parse(body as string) : {});
  });
  await app.register(retellFunctionRoutes);
  await app.register(workflowFunctionRoutes);
  return app;
}
async function callFn(app: FastifyInstance, name: string, args: Record<string, unknown>, callId = 'rc-a1') {
  const raw = JSON.stringify({
    name,
    call: { call_id: callId, from_number: '+19998887777', to_number: '+15551112222' },
    args,
  });
  return app.inject({
    method: 'POST',
    url: `/functions/retell/${name}`,
    headers: { 'content-type': 'application/json', 'x-retell-signature': sign(raw) },
    payload: raw,
  });
}

describe('identity verification gate', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    vi.clearAllMocks();
    sessions.clear();
    inserts.staff_notifications = [];
    inserts.callback_requests = [];
    settingsObj = { notification_emails: ['owner@glow.com'], agent_config: {}, business_policies: [] };
    contactRow = { id: 'ct1', first_name: 'Jane', last_name: 'Doe', email: 'jane@x.com', tags: [], custom_fields: {} };
    apptRow = null;
    app = await buildApp();
  });

  it('membership_lookup is DENIED before identity is verified', async () => {
    sessions.set('rc-a1', { id: 'cs', client_id: 'c1', call_id: null, retell_call_id: 'rc-a1', state: blank(), created_at: '', updated_at: '' });
    const res = await callFn(app, 'membership_lookup', { phone: '+19998887777' });
    expect(res.json().denied).toBe(true);
  });

  it('verify_identity confirms on a matching email and flips the session', async () => {
    sessions.set('rc-a1', { id: 'cs', client_id: 'c1', call_id: null, retell_call_id: 'rc-a1', state: blank(), created_at: '', updated_at: '' });
    const res = await callFn(app, 'verify_identity', { phone: '+19998887777', email: 'jane@x.com' });
    expect(res.json().verified).toBe(true);
    expect(sessions.get('rc-a1')?.state.identityVerified).toBe(true);
    expect(sessions.get('rc-a1')?.state.context.contactId).toBe('ct1');
  });

  it('verify_identity fails when no corroborating factor matches', async () => {
    const res = await callFn(app, 'verify_identity', { phone: '+19998887777', email: 'wrong@x.com' });
    expect(res.json().verified).toBe(false);
    expect(res.json().factors.email).toBe(false);
  });

  it('membership_lookup is ALLOWED once the session is verified', async () => {
    settingsObj.agent_config = { membership_program: { name: 'Glow Club', description: 'monthly perks' } };
    const s = blank();
    s.identityVerified = true;
    sessions.set('rc-a1', { id: 'cs', client_id: 'c1', call_id: null, retell_call_id: 'rc-a1', state: s, created_at: '', updated_at: '' });
    const res = await callFn(app, 'membership_lookup', { phone: '+19998887777' });
    expect(res.json().denied).toBeUndefined();
    expect(res.json().program.name).toBe('Glow Club');
  });
});

describe('account tools degrade gracefully', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    vi.clearAllMocks();
    sessions.clear();
    inserts.staff_notifications = [];
    settingsObj = { notification_emails: ['owner@glow.com'], agent_config: {}, business_policies: ['Deposits are non-refundable.'] };
    contactRow = { id: 'ct1', first_name: 'Jane', email: 'jane@x.com', tags: [], custom_fields: {} };
    // Verified session so identity-gated tools run.
    const s = blank();
    s.identityVerified = true;
    sessions.set('rc-a1', { id: 'cs', client_id: 'c1', call_id: null, retell_call_id: 'rc-a1', state: s, created_at: '', updated_at: '' });
    app = await buildApp();
  });

  it('payment_lookup routes an account balance question to staff without quoting a figure', async () => {
    const res = await callFn(app, 'payment_lookup', { phone: '+19998887777', topic: 'what is my outstanding balance' });
    expect(res.json().deferred).toBe(true);
    expect(inserts.staff_notifications.some((r) => (r.metadata as { kind?: string }).kind === 'payment_request')).toBe(true);
  });

  it('payment_lookup shares configured payment policy for general questions', async () => {
    const res = await callFn(app, 'payment_lookup', { phone: '+19998887777', topic: 'do you offer financing' });
    expect(res.json().deferred).toBe(false);
    expect(res.json().payment_policies).toContain('Deposits are non-refundable.');
  });

  it('documentation_request marks medical records request-only', async () => {
    const res = await callFn(app, 'documentation_request', { phone: '+19998887777', document_type: 'medical records' });
    expect(res.json().requested).toBe(true);
    expect(res.json().medical).toBe(true);
    expect(res.json().message).toMatch(/NEVER read/i);
  });
});

describe('support tools', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    vi.clearAllMocks();
    sessions.clear();
    inserts.staff_notifications = [];
    inserts.callback_requests = [];
    settingsObj = { notification_emails: ['owner@glow.com'], agent_config: {}, business_policies: [] };
    contactRow = null;
    app = await buildApp();
  });

  it('create_complaint files a caller ticket and escalates', async () => {
    const services = await import('../services/index.js');
    const res = await callFn(app, 'create_complaint', {
      caller_name: 'Jane Doe',
      phone: '+19998887777',
      issue: 'Rude staff',
      urgency: 'high',
    });
    expect(res.json().created).toBe(true);
    expect(res.json().ticket_id).toBe('ticket1');
    expect(vi.mocked(services.ticketService.createFromCaller)).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'c1', priority: 'high' })
    );
    expect(notifAdd).toHaveBeenCalledWith('complaint', expect.objectContaining({ type: 'escalation' }), expect.anything());
  });

  it('schedule_callback persists a trackable callback_requests record', async () => {
    const res = await callFn(app, 'schedule_callback', {
      caller_name: 'Jane Doe',
      phone: '+19998887777',
      preferred_time: 'tomorrow AM',
      topic: 'pricing',
    });
    expect(res.json().scheduled).toBe(true);
    expect(inserts.callback_requests).toHaveLength(1);
    expect(inserts.callback_requests[0]).toMatchObject({ caller_name: 'Jane Doe', status: 'pending' });
  });
});

describe('system tools set conversation context', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    vi.clearAllMocks();
    sessions.clear();
    settingsObj = { agent_config: {} };
    sessions.set('rc-a1', { id: 'cs', client_id: 'c1', call_id: null, retell_call_id: 'rc-a1', state: blank(), created_at: '', updated_at: '' });
    app = await buildApp();
  });

  it('set_language records the preferred language', async () => {
    const res = await callFn(app, 'set_language', { language: 'Spanish' });
    expect(res.json().ok).toBe(true);
    expect(sessions.get('rc-a1')?.state.context.language).toBe('Spanish');
  });

  it('set_location records the chosen location', async () => {
    const res = await callFn(app, 'set_location', { location: 'Downtown' });
    expect(res.json().ok).toBe(true);
    expect(sessions.get('rc-a1')?.state.context.location).toBe('Downtown');
  });
});

describe('account & ops workflow definitions', () => {
  it('routes account/support/system intents to their workflows', () => {
    expect(resolveWorkflowByIntent('verify_identity')?.id).toBe('identity_verification');
    expect(resolveWorkflowByIntent('my_membership')?.id).toBe('membership');
    expect(resolveWorkflowByIntent('financing')?.id).toBe('payment_questions');
    expect(resolveWorkflowByIntent('medical_records')?.id).toBe('documentation_requests');
    expect(resolveWorkflowByIntent('speak_to_human')?.id).toBe('staff_transfer');
    expect(resolveWorkflowByIntent('call_me_back')?.id).toBe('callback_request');
    expect(resolveWorkflowByIntent('unhappy')?.id).toBe('complaint');
    expect(resolveWorkflowByIntent('which_location')?.id).toBe('multi_location_routing');
    expect(resolveWorkflowByIntent('espanol')?.id).toBe('language_selection');
  });

  it('account workflows guard data states behind verified identity', () => {
    const membership = resolveWorkflowByIntent('membership');
    const guard = membership?.guards?.find((g) => g.name === 'identity_verified');
    expect(guard?.states).toContain('lookup');
    expect(guard?.check({ identityVerified: false } as never)).toBe(false);
    expect(guard?.check({ identityVerified: true } as never)).toBe(true);
    expect(membership?.scopes).toEqual(expect.arrayContaining(['crm', 'payments']));
  });
});
