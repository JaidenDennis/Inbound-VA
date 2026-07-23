import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import CryptoJS from 'crypto-js';
import type {
  CallSessionRecord,
  CallSessionState,
  NormalizedEvent,
  WorkflowDefinition,
} from '../types/index.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────
const clientObj = { id: 'c1', name: 'Glow', timezone: 'America/New_York' };
const settingsObj = {
  booking_enabled: true,
  notification_emails: ['mgr@glow.com'],
  services: [{ name: 'Botox', duration_minutes: 30 }],
  agent_config: { workflow_routing: true },
};

vi.mock('../services/index.js', () => ({
  clientService: {
    findByPhoneNumber: vi.fn(() => Promise.resolve(clientObj)),
    findByAgentId: vi.fn(() => Promise.resolve(clientObj)),
    getSettings: vi.fn(() => Promise.resolve(settingsObj)),
  },
  contactService: {
    findByPhone: vi.fn(() => Promise.resolve(null)),
    upsertByPhone: vi.fn(() => Promise.resolve({ id: 'ct1', first_name: 'Jane', last_name: 'Doe' })),
  },
  callService: {
    findByRetellId: vi.fn(() => Promise.resolve({ id: 'call1', client_id: 'c1', contact_id: 'ct1' })),
    upsertConversation: vi.fn(() => Promise.resolve({})),
  },
  // Knowledge overlay is identity — slot validators see the settings above.
  knowledgeService: {
    settingsWithKnowledge: vi.fn((_id: string, s: unknown) => Promise.resolve(s)),
    search: vi.fn(() =>
      Promise.resolve({ faqs: [], services: [], pricing: [], promotions: [], activePromotions: [], found: false })
    ),
  },
}));

const auditWrites: unknown[] = [];
vi.mock('../services/audit.service.js', () => ({
  writeAuditLog: vi.fn((entry: unknown) => {
    auditWrites.push(entry);
    return Promise.resolve();
  }),
}));

vi.mock('../booking/index.js', () => ({
  bookingService: {
    createAppointment: vi.fn(() => Promise.resolve({ id: 'appt1' })),
    getAvailability: vi.fn(() => Promise.resolve([])),
  },
}));

const notifAdd = vi.fn(() => Promise.resolve(undefined));
vi.mock('../queues/index.js', () => ({ notificationsQueue: { add: notifAdd } }));

const published: Array<Pick<NormalizedEvent, 'type' | 'payload'>> = [];
vi.mock('../events/index.js', () => ({
  eventBus: {
    publish: vi.fn((e: NormalizedEvent) => {
      published.push({ type: e.type, payload: e.payload });
      return Promise.resolve(e);
    }),
  },
}));

const staffInserts: unknown[] = [];
vi.mock('../db/index.js', () => ({
  supabase: {
    from: vi.fn((table: string) => ({
      insert: vi.fn((row: unknown) => {
        if (table === 'staff_notifications') staffInserts.push(row);
        return Promise.resolve({ error: null });
      }),
    })),
  },
}));

// In-memory session store — exercises the real engine + scope guard against
// deterministic persistence without Supabase chain mocking.
const sessions = new Map<string, CallSessionRecord>();
vi.mock('../workflows/engine/session-store.js', () => {
  const blank = (routingEnabled: boolean): CallSessionState => ({
    routingEnabled,
    active: null,
    stack: [],
    grantedScopes: [],
    identityVerified: false,
    emergencyFlagged: false,
    context: { previousTopics: [], summaryNotes: [] },
    eventSeq: 0,
  });
  return {
    emptySessionState: blank,
    findSession: vi.fn((id: string) => Promise.resolve(sessions.get(id) ?? null)),
    createSession: vi.fn(
      (input: { clientId: string; retellCallId: string; callId?: string | null; routingEnabled: boolean }) => {
        const existing = sessions.get(input.retellCallId);
        if (existing) return Promise.resolve(existing);
        const rec: CallSessionRecord = {
          id: `cs-${input.retellCallId}`,
          client_id: input.clientId,
          call_id: input.callId ?? null,
          retell_call_id: input.retellCallId,
          state: blank(input.routingEnabled),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        sessions.set(input.retellCallId, rec);
        return Promise.resolve(rec);
      }
    ),
    saveSessionState: vi.fn((id: string, state: CallSessionState) => {
      const rec = sessions.get(id);
      if (rec) rec.state = state;
      return Promise.resolve();
    }),
  };
});

const { registerWorkflow, ACTION_METADATA, enforceScope } = await import('../workflows/index.js');
const { retellFunctionRoutes } = await import('../routes/functions/retell-functions.route.js');
const { workflowFunctionRoutes } = await import('../routes/functions/workflow-functions.route.js');

// A booking-scoped test workflow with a slot validated against client settings.
const bookBotox: WorkflowDefinition = {
  id: 'test_book_flow',
  capability: 'appointments',
  intents: ['book_botox'],
  scopes: ['booking'],
  slots: [
    {
      name: 'service',
      description: 'Which service to book',
      required: true,
      validate: (v, ctx) =>
        ctx.settings?.services?.some((s) => s.name === v) ? null : 'Service not offered by this client',
    },
  ],
  states: ['gather', 'complete'],
  transitions: { gather: ['complete'], complete: [] },
  outcomes: ['booked'],
  guidance: { gather: 'Ask which service they want.', complete: 'Wrap up.' },
};
registerWorkflow(bookBotox);

// A workflow with a BACKEND-EXECUTED action: entering "execute" runs
// booking.create from the collected slots (no separate booking tool).
const bookWithAction: WorkflowDefinition = {
  id: 'test_book_action',
  capability: 'appointments',
  intents: ['book_with_action'],
  scopes: ['booking'],
  slots: [
    { name: 'name', description: 'Full name', required: true },
    { name: 'phone', description: 'Phone', required: true },
    { name: 'service', description: 'Service', required: true },
    { name: 'preferred_time', description: 'Time', required: true },
  ],
  states: ['gather', 'execute', 'complete'],
  transitions: { gather: ['execute'], execute: ['complete'], complete: [] },
  action: { state: 'execute', name: 'booking.create', outcomeOnSuccess: 'booked', outcomeOnFailure: 'no_availability', completeOnSuccess: true },
  outcomes: ['booked', 'no_availability'],
  guidance: { gather: 'Collect details.', execute: 'Backend is booking.', complete: 'Done.' },
};
registerWorkflow(bookWithAction);

// ─── Harness ─────────────────────────────────────────────────────────────────
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

async function callFn(app: FastifyInstance, name: string, args: Record<string, unknown>, callId = 'rc-wf-1') {
  const raw = JSON.stringify({
    name,
    call: { call_id: callId, agent_id: 'ag1', from_number: '+19998887777', to_number: '+15551112222' },
    args,
  });
  return app.inject({
    method: 'POST',
    url: `/functions/retell/${name}`,
    headers: { 'content-type': 'application/json', 'x-retell-signature': sign(raw) },
    payload: raw,
  });
}

describe('inbound workflow routing (Phase 1 exit test)', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    vi.clearAllMocks();
    sessions.clear();
    published.length = 0;
    staffInserts.length = 0;
    auditWrites.length = 0;
    app = await buildApp();
  });

  it('routes an intent, enforces scopes, collects a slot, switches topics, and leaves a full event trail', async () => {
    // 1. route_intent starts the booking workflow and grants only `booking`.
    const routed = await callFn(app, 'route_intent', { intent: 'book_botox' });
    expect(routed.statusCode).toBe(200);
    expect(routed.json().workflow_id).toBe('test_book_flow');
    expect(routed.json().state).toBe('gather');
    expect(routed.json().missing_slots).toEqual([{ name: 'service', description: 'Which service to book' }]);
    expect(routed.json().granted_scopes).toEqual(['booking']);

    // 2. A support-scoped tool is DENIED — outside the workflow's grant.
    const denied = await callFn(app, 'schedule_callback', { caller_name: 'Jane', phone: '+19998887777' });
    expect(denied.statusCode).toBe(200);
    expect(denied.json().denied).toBe(true);
    expect(staffInserts).toHaveLength(0); // the handler never ran
    expect(auditWrites).toHaveLength(1); // denial is audited

    // 3. A booking-scoped tool passes the guard and executes normally.
    const avail = await callFn(app, 'check_availability', { date: '2026-08-01' });
    expect(avail.json().denied).toBeUndefined();
    expect(avail.json()).toHaveProperty('available');

    // 4. Slot collection: invalid value rejected with the workflow's message…
    const badSlot = await callFn(app, 'update_workflow', { slots: { service: 'Unicorn Facial' } });
    expect(badSlot.json().ok).toBe(false);
    expect(badSlot.json().slot_errors.service).toMatch(/not offered/);
    // …valid value recorded and no longer missing.
    const goodSlot = await callFn(app, 'update_workflow', { slots: { service: 'Botox' } });
    expect(goodSlot.json().ok).toBe(true);
    expect(goodSlot.json().contract.missing_slots).toHaveLength(0);

    // 5. Topic switch: end_call pauses the booking flow (stack push)…
    const switched = await callFn(app, 'route_intent', { intent: 'end_call' });
    expect(switched.json().workflow_id).toBe('end_call');
    expect(sessions.get('rc-wf-1')?.state.stack.map((f) => f.workflowId)).toEqual(['test_book_flow']);

    // …and completing it resumes the stacked workflow (stack pop).
    const completed = await callFn(app, 'update_workflow', { complete_outcome: 'continued' });
    expect(completed.json().resumed.workflow_id).toBe('test_book_flow');
    expect(sessions.get('rc-wf-1')?.state.active?.workflowId).toBe('test_book_flow');
    expect(sessions.get('rc-wf-1')?.state.active?.slots.service).toBe('Botox'); // slots survived the pause

    // 6. Every transition was written to the audit event stream.
    expect(published.map((e) => e.type)).toEqual([
      'workflow.started',
      'workflow.paused',
      'workflow.switched',
      'workflow.started',
      'workflow.completed',
      'workflow.resumed',
    ]);
  });

  it('backend EXECUTES the booking action on transition — no separate tool call (the live-call bug)', async () => {
    const booking = await import('../booking/index.js');
    await callFn(app, 'route_intent', { intent: 'book_with_action' }, 'rc-act');
    await callFn(
      app,
      'update_workflow',
      { slots: { name: 'Jaden Dennis', phone: '+12242431108', service: 'Consultation', preferred_time: '2026-09-01T14:00:00.000Z' } },
      'rc-act'
    );
    // Transition to "execute" — the backend must book automatically, NOT wait
    // for the agent to call a booking tool.
    const res = await callFn(app, 'update_workflow', { transition_to: 'execute' }, 'rc-act');
    expect(res.json().action.ok).toBe(true);
    expect(res.json().action.data.appointmentId).toBe('appt1');
    expect(vi.mocked(booking.bookingService.createAppointment)).toHaveBeenCalledOnce();
    // Workflow auto-completed (terminal action) → active cleared.
    expect(sessions.get('rc-act')?.state.active).toBeNull();
    expect(published.map((e) => e.type)).toContain('workflow.completed');
  });

  it('booking action failure keeps the workflow active for a retry (no false success)', async () => {
    const booking = await import('../booking/index.js');
    vi.mocked(booking.bookingService.createAppointment).mockRejectedValueOnce(new Error('Time slot is not available'));
    await callFn(app, 'route_intent', { intent: 'book_with_action' }, 'rc-fail');
    await callFn(
      app,
      'update_workflow',
      { slots: { name: 'Jane Doe', phone: '+12242431108', service: 'Consultation', preferred_time: '2026-09-01T14:00:00.000Z' } },
      'rc-fail'
    );
    const res = await callFn(app, 'update_workflow', { transition_to: 'execute' }, 'rc-fail');
    expect(res.json().ok).toBe(false);
    expect(res.json().action.ok).toBe(false);
    expect(res.json().message).toMatch(/available/i);
    // Still on the workflow (not completed) so the agent can offer another slot.
    expect(sessions.get('rc-fail')?.state.active?.workflowId).toBe('test_book_action');
  });

  it('hands the agent break-tagged name/phone readback strings (Emily readback fix)', async () => {
    await callFn(app, 'route_intent', { intent: 'book_with_action' }, 'rc-rb');
    const res = await callFn(app, 'update_workflow', { slots: { name: 'Jaden Dennis', phone: '+12242431108' } }, 'rc-rb');
    const rb = res.json().readback;
    expect(rb.phone).toContain('<break time="0.3s" />'); // hard pause between digits
    expect(rb.phone).toContain('two'); // digits as words, not "one billion…"
    expect(rb.name).toContain('J <break time="0.3s" /> A'); // spelled letter by letter
    expect(res.json().readback_instruction).toMatch(/Did I get that right/);
  });

  it('legacy calls without a routing session pass the scope guard untouched', async () => {
    const res = await callFn(app, 'schedule_callback', { caller_name: 'Jane', phone: '+19998887777' }, 'rc-legacy');
    expect(res.json().scheduled).toBe(true);
    expect(staffInserts).toHaveLength(1);
  });

  it('emergency_flag notifies management, flags the session, and returns the predefined response', async () => {
    const res = await callFn(app, 'emergency_flag', { details: 'caller reports chest pain' });
    expect(res.json().flagged).toBe(true);
    expect(res.json().message).toContain('9-1-1');
    expect(staffInserts).toHaveLength(1);
    expect(notifAdd).toHaveBeenCalledWith(
      'emergency',
      expect.objectContaining({ subject: expect.stringContaining('URGENT') }),
      expect.anything()
    );
    expect(sessions.get('rc-wf-1')?.state.emergencyFlagged).toBe(true);
    expect(published.map((e) => e.type)).toContain('emergency.flagged');
  });

  it('identity-required actions are rejected until the session is verified', async () => {
    ACTION_METADATA.test_secure_tool = {
      action: 'test.secure',
      scope: 'crm',
      requiresVerifiedIdentity: true,
      idempotent: true,
      retrySafe: true,
    };
    const guard = enforceScope('test_secure_tool');
    sessions.set('rc-sec', {
      id: 'cs-rc-sec',
      client_id: 'c1',
      call_id: null,
      retell_call_id: 'rc-sec',
      state: {
        routingEnabled: true,
        active: null,
        stack: [],
        grantedScopes: ['crm'],
        identityVerified: false,
        emergencyFlagged: false,
        context: { previousTopics: [], summaryNotes: [] },
        eventSeq: 0,
      },
      created_at: '',
      updated_at: '',
    });

    const send = vi.fn();
    const request = { body: { call: { call_id: 'rc-sec' } } } as never;
    await guard(request, { send } as never);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ denied: true }));

    send.mockClear();
    sessions.get('rc-sec')!.state.identityVerified = true;
    await guard(request, { send } as never);
    expect(send).not.toHaveBeenCalled();
    delete ACTION_METADATA.test_secure_tool;
  });
});
