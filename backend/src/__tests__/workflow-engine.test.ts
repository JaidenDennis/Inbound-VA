import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CallSessionState, NormalizedEvent, WorkflowDefinition } from '../types/index.js';

// The engine is pure state manipulation + event emission; mock the bus (which
// persists to Supabase) and the db client the session-store pulls in.
const published: Array<Pick<NormalizedEvent, 'type' | 'payload'>> = [];
vi.mock('../events/index.js', () => ({
  eventBus: {
    publish: vi.fn((e: NormalizedEvent) => {
      published.push({ type: e.type, payload: e.payload });
      return Promise.resolve(e);
    }),
  },
}));
vi.mock('../db/index.js', () => ({ supabase: { from: vi.fn() } }));

const {
  registerWorkflow,
  routeIntent,
  collectSlots,
  transition,
  completeActive,
  cancelActive,
  flagEmergency,
  emptySessionState,
  FALLBACK_SCOPES,
} = await import('../workflows/index.js');

const testWorkflow: WorkflowDefinition = {
  id: 'test_booking',
  capability: 'appointments',
  intents: ['test_book'],
  scopes: ['booking'],
  slots: [
    {
      name: 'service',
      description: 'Which service',
      required: true,
      validate: (v, ctx) =>
        ctx.settings?.services?.some((s) => s.name === v) ? null : 'That service does not exist for this client',
    },
    {
      name: 'date',
      description: 'Preferred date',
      required: true,
      validate: (v, ctx) => (new Date(String(v)) > ctx.now ? null : 'Date must be in the future'),
    },
  ],
  states: ['gather', 'confirm', 'complete'],
  transitions: { gather: ['confirm'], confirm: ['complete', 'gather'], complete: [] },
  guards: [
    {
      name: 'identity_verified',
      states: ['complete'],
      check: (s) => s.identityVerified,
      failureGuidance: 'Verify the caller identity before finalizing.',
    },
  ],
  outcomes: ['booked', 'no_availability'],
  guidance: { gather: 'Collect the service and date.', confirm: 'Confirm the details.', complete: 'All done.' },
};
registerWorkflow(testWorkflow);

const ref = { clientId: 'c1', retellCallId: 'rc1', callId: 'call1' };
const slotCtx = {
  settings: { services: [{ name: 'Botox', duration_minutes: 30 }] } as never,
  timezone: 'America/New_York',
  now: new Date('2026-07-21T12:00:00Z'),
};

function types(): string[] {
  return published.map((e) => e.type);
}

describe('workflow registry validation', () => {
  it('rejects a definition whose transitions reference unknown states', () => {
    expect(() =>
      registerWorkflow({
        ...testWorkflow,
        id: 'broken',
        intents: ['broken_intent'],
        transitions: { gather: ['nope'], confirm: [], complete: [] },
      })
    ).toThrow(/unknown state/);
  });

  it('rejects two workflows claiming the same intent', () => {
    expect(() =>
      registerWorkflow({ ...testWorkflow, id: 'other_wf', intents: ['test_book'] })
    ).toThrow(/already routes/);
  });
});

describe('workflow engine', () => {
  let session: CallSessionState;
  beforeEach(() => {
    published.length = 0;
    session = emptySessionState(true);
  });

  it('starts a workflow from an intent and grants its scopes', async () => {
    const contract = await routeIntent(ref, session, 'test_book');
    expect(contract.workflow_id).toBe('test_booking');
    expect(contract.state).toBe('gather');
    expect(contract.missing_slots.map((s) => s.name)).toEqual(['service', 'date']);
    expect(session.grantedScopes).toEqual(['booking']);
    expect(types()).toEqual(['workflow.started']);
  });

  it('re-routing the same intent returns the current position without new events', async () => {
    await routeIntent(ref, session, 'test_book');
    published.length = 0;
    const contract = await routeIntent(ref, session, 'test_book');
    expect(contract.workflow_id).toBe('test_booking');
    expect(published).toHaveLength(0);
  });

  it('falls back gracefully for an unknown intent, granting fallback scopes', async () => {
    const contract = await routeIntent(ref, session, 'ask_about_weather');
    expect(contract.workflow_id).toBeNull();
    expect(session.grantedScopes).toEqual(FALLBACK_SCOPES);
    expect(contract.guidance).toMatch(/No structured workflow/);
  });

  it('validates and stores slots via the workflow-owned validators', async () => {
    await routeIntent(ref, session, 'test_book');
    const good = collectSlots(session, { service: 'Botox', date: '2026-08-01' }, slotCtx);
    expect(good.errors).toEqual({});
    expect(session.active?.slots).toEqual({ service: 'Botox', date: '2026-08-01' });
    expect(good.contract?.missing_slots).toHaveLength(0);

    const bad = collectSlots(session, { service: 'Unicorn Facial', date: '2020-01-01' }, slotCtx);
    expect(bad.errors.service).toMatch(/does not exist/);
    expect(bad.errors.date).toMatch(/future/);
    // Invalid values must not overwrite previously collected ones.
    expect(session.active?.slots.service).toBe('Botox');
  });

  it('rejects undeclared transitions and enforces guards on state entry', async () => {
    await routeIntent(ref, session, 'test_book');

    const skip = await transition(ref, session, 'complete');
    expect(skip.ok).toBe(false);
    expect(skip.reason).toMatch(/not allowed/);

    const ok = await transition(ref, session, 'confirm');
    expect(ok.ok).toBe(true);
    expect(session.active?.state).toBe('confirm');

    const blocked = await transition(ref, session, 'complete');
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toMatch(/Verify the caller identity/);

    session.identityVerified = true;
    const allowed = await transition(ref, session, 'complete');
    expect(allowed.ok).toBe(true);
    expect(types()).toEqual(['workflow.started', 'workflow.transitioned', 'workflow.transitioned']);
  });

  it('pauses on topic switch, stacks the workflow, and resumes it after completion', async () => {
    await routeIntent(ref, session, 'test_book');
    const switched = await routeIntent(ref, session, 'end_call');
    expect(switched.workflow_id).toBe('end_call');
    expect(session.stack.map((f) => f.workflowId)).toEqual(['test_booking']);
    expect(session.grantedScopes).toEqual(['system']);

    const resumed = await completeActive(ref, session, 'continued');
    expect(resumed?.workflow_id).toBe('test_booking');
    expect(session.active?.workflowId).toBe('test_booking');
    expect(session.grantedScopes).toEqual(['booking']);
    expect(types()).toEqual([
      'workflow.started',
      'workflow.paused',
      'workflow.switched',
      'workflow.started',
      'workflow.completed',
      'workflow.resumed',
    ]);
  });

  it('normalizes an undeclared outcome to "completed" and records a summary note', async () => {
    await routeIntent(ref, session, 'test_book');
    await completeActive(ref, session, 'made_up_outcome');
    const completed = published.find((e) => e.type === 'workflow.completed');
    expect(completed?.payload.outcome).toBe('completed');
    expect(session.context.summaryNotes).toEqual(['test_booking: completed']);
  });

  it('cancelActive abandons the workflow and clears scopes when the stack is empty', async () => {
    await routeIntent(ref, session, 'test_book');
    const resumed = await cancelActive(ref, session, 'changed mind');
    expect(resumed).toBeNull();
    expect(session.active).toBeNull();
    expect(session.grantedScopes).toEqual([]);
    expect(types()).toContain('workflow.cancelled');
  });

  it('flagEmergency marks the session and emits emergency.flagged', async () => {
    await flagEmergency(ref, session, 'caller reports chest pain');
    expect(session.emergencyFlagged).toBe(true);
    expect(types()).toEqual(['emergency.flagged']);
  });
});
