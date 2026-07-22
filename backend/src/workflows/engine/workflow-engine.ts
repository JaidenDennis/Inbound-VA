import { eventBus } from '../../events/index.js';
import { buildIdempotencyKey, logger } from '../../utils/index.js';
import { getWorkflow, resolveWorkflowByIntent } from './workflow-registry.js';
import type {
  ActiveWorkflowFrame,
  CallSessionState,
  CapabilityScope,
  EventType,
  SlotValidationContext,
  WorkflowContract,
  WorkflowDefinition,
} from '../../types/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Generic workflow state-machine engine. Owns: transition validation, slot
// collection tracking, guard evaluation, stack management (topic switches), and
// event emission. It never talks to Retell and never contains a workflow's
// business rules — those live in declarative definitions. Callers (the
// route_intent tool and action handlers) load/persist the session around these
// pure state operations.
// ─────────────────────────────────────────────────────────────────────────────

/** Identifies the call a session belongs to, for event attribution. */
export interface WorkflowCallRef {
  clientId: string;
  retellCallId: string;
  callId?: string | null;
  contactId?: string | null;
}

/**
 * Scopes granted when an intent has no registered workflow yet. Matches the
 * pre-routing tool surface so agents keep working while workflow definitions
 * land phase by phase; tighten as capabilities become workflow-owned.
 */
export const FALLBACK_SCOPES: CapabilityScope[] = ['booking', 'knowledge', 'crm', 'support'];

async function publish(
  type: EventType,
  ref: WorkflowCallRef,
  session: CallSessionState,
  payload: Record<string, unknown>
): Promise<void> {
  session.eventSeq += 1;
  await eventBus.publish({
    type,
    clientId: ref.clientId,
    callId: ref.callId ?? undefined,
    contactId: ref.contactId ?? undefined,
    payload: { retell_call_id: ref.retellCallId, ...payload },
    source: 'internal',
    idempotencyKey: buildIdempotencyKey('wf', ref.retellCallId, session.eventSeq),
  });
}

function newFrame(def: WorkflowDefinition): ActiveWorkflowFrame {
  return { workflowId: def.id, state: def.states[0], slots: {}, startedAt: new Date().toISOString() };
}

function missingSlots(def: WorkflowDefinition, frame: ActiveWorkflowFrame) {
  return def.slots
    .filter((s) => s.required && !(s.name in frame.slots))
    .map((s) => ({ name: s.name, description: s.description }));
}

/** The guard (if any) blocking the given state, or null when entry is allowed. */
function blockingGuard(def: WorkflowDefinition, state: string, session: CallSessionState) {
  return (def.guards ?? []).find((g) => g.states.includes(state) && !g.check(session)) ?? null;
}

export function buildContract(
  def: WorkflowDefinition,
  frame: ActiveWorkflowFrame,
  session: CallSessionState
): WorkflowContract {
  const guard = blockingGuard(def, frame.state, session);
  return {
    workflow_id: def.id,
    capability: def.capability,
    state: frame.state,
    missing_slots: missingSlots(def, frame),
    granted_scopes: session.grantedScopes,
    guidance: guard ? guard.failureGuidance : (def.guidance[frame.state] ?? ''),
  };
}

function fallbackContract(session: CallSessionState, intent: string): WorkflowContract {
  return {
    workflow_id: null,
    capability: null,
    state: null,
    missing_slots: [],
    granted_scopes: session.grantedScopes,
    guidance:
      `No structured workflow exists for "${intent}" yet. Answer from the knowledge in your ` +
      'instructions, use your available tools, and offer a callback or staff message if you cannot resolve it.',
  };
}

/**
 * Map an intent to its workflow and make it the active one. A different active
 * workflow is paused and pushed onto the stack (topic switch); the same
 * workflow returns its current contract unchanged. Mutates `session`; caller
 * persists.
 */
export async function routeIntent(
  ref: WorkflowCallRef,
  session: CallSessionState,
  intent: string
): Promise<WorkflowContract> {
  const def = resolveWorkflowByIntent(intent);

  if (!def) {
    if (!session.grantedScopes.length) session.grantedScopes = [...FALLBACK_SCOPES];
    logger.info({ intent, retellCallId: ref.retellCallId }, 'route_intent: no workflow for intent (fallback)');
    return fallbackContract(session, intent);
  }

  // Re-invoking the active workflow's intent → report current position.
  if (session.active?.workflowId === def.id) {
    return buildContract(def, session.active, session);
  }

  // Topic switch: pause the current workflow and stack it for resumption.
  if (session.active) {
    session.stack.push(session.active);
    await publish('workflow.paused', ref, session, {
      workflow_id: session.active.workflowId,
      state: session.active.state,
    });
    await publish('workflow.switched', ref, session, {
      from_workflow: session.active.workflowId,
      to_workflow: def.id,
      intent,
    });
  }

  session.active = newFrame(def);
  session.grantedScopes = [...def.scopes];
  session.context.previousTopics.push(intent);
  await publish('workflow.started', ref, session, {
    workflow_id: def.id,
    intent,
    state: session.active.state,
  });

  return buildContract(def, session.active, session);
}

/**
 * Validate and store slot values on the active workflow. Invalid values are
 * rejected with the workflow's own error messages; valid ones are recorded.
 */
export function collectSlots(
  session: CallSessionState,
  values: Record<string, unknown>,
  ctx: SlotValidationContext
): { errors: Record<string, string>; contract: WorkflowContract | null } {
  const frame = session.active;
  if (!frame) return { errors: {}, contract: null };
  const def = getWorkflow(frame.workflowId);
  if (!def) return { errors: {}, contract: null };

  const errors: Record<string, string> = {};
  for (const [name, value] of Object.entries(values)) {
    const slot = def.slots.find((s) => s.name === name);
    if (!slot) continue; // unknown slot names are ignored, never stored
    const error = slot.validate ? slot.validate(value, ctx) : null;
    if (error) errors[name] = error;
    else frame.slots[name] = value;
  }
  return { errors, contract: buildContract(def, frame, session) };
}

/**
 * Move the active workflow to a new state. Rejects transitions the definition
 * does not declare and states blocked by an unmet guard. Mutates `session`.
 */
export async function transition(
  ref: WorkflowCallRef,
  session: CallSessionState,
  toState: string
): Promise<{ ok: boolean; reason?: string; contract: WorkflowContract | null }> {
  const frame = session.active;
  if (!frame) return { ok: false, reason: 'No active workflow', contract: null };
  const def = getWorkflow(frame.workflowId);
  if (!def) return { ok: false, reason: `Unknown workflow ${frame.workflowId}`, contract: null };

  const allowed = def.transitions[frame.state] ?? [];
  if (!allowed.includes(toState)) {
    return {
      ok: false,
      reason: `Transition ${frame.state} → ${toState} is not allowed`,
      contract: buildContract(def, frame, session),
    };
  }
  const guard = blockingGuard(def, toState, session);
  if (guard) {
    return { ok: false, reason: guard.failureGuidance, contract: buildContract(def, frame, session) };
  }

  const fromState = frame.state;
  frame.state = toState;
  await publish('workflow.transitioned', ref, session, {
    workflow_id: def.id,
    from_state: fromState,
    to_state: toState,
  });
  return { ok: true, contract: buildContract(def, frame, session) };
}

async function popAndResume(
  ref: WorkflowCallRef,
  session: CallSessionState
): Promise<WorkflowContract | null> {
  const resumed = session.stack.pop() ?? null;
  session.active = resumed;
  if (!resumed) {
    session.grantedScopes = [];
    return null;
  }
  const def = getWorkflow(resumed.workflowId);
  session.grantedScopes = def ? [...def.scopes] : [];
  await publish('workflow.resumed', ref, session, {
    workflow_id: resumed.workflowId,
    state: resumed.state,
  });
  return def ? buildContract(def, resumed, session) : null;
}

/**
 * Finish the active workflow with an outcome, then resume the most recently
 * stacked workflow (if any). Returns the resumed workflow's contract or null.
 */
export async function completeActive(
  ref: WorkflowCallRef,
  session: CallSessionState,
  outcome: string
): Promise<WorkflowContract | null> {
  const frame = session.active;
  if (!frame) return null;
  const def = getWorkflow(frame.workflowId);
  const validOutcome = def?.outcomes.includes(outcome) ? outcome : 'completed';
  await publish('workflow.completed', ref, session, {
    workflow_id: frame.workflowId,
    outcome: validOutcome,
    slots: frame.slots,
  });
  session.context.summaryNotes.push(`${frame.workflowId}: ${validOutcome}`);
  return popAndResume(ref, session);
}

/** Abandon the active workflow (caller changed their mind / call ending). */
export async function cancelActive(
  ref: WorkflowCallRef,
  session: CallSessionState,
  reason?: string
): Promise<WorkflowContract | null> {
  const frame = session.active;
  if (!frame) return null;
  await publish('workflow.cancelled', ref, session, {
    workflow_id: frame.workflowId,
    state: frame.state,
    reason: reason ?? null,
  });
  return popAndResume(ref, session);
}

/** Record a failure on the active workflow (action error the agent cannot recover). */
export async function failActive(
  ref: WorkflowCallRef,
  session: CallSessionState,
  error: string
): Promise<WorkflowContract | null> {
  const frame = session.active;
  if (!frame) return null;
  await publish('workflow.failed', ref, session, {
    workflow_id: frame.workflowId,
    state: frame.state,
    error,
  });
  session.context.summaryNotes.push(`${frame.workflowId}: failed (${error})`);
  return popAndResume(ref, session);
}

/** Hard emergency path: flag the session and audit it. Never routes. */
export async function flagEmergency(
  ref: WorkflowCallRef,
  session: CallSessionState,
  details: string
): Promise<void> {
  session.emergencyFlagged = true;
  await publish('emergency.flagged', ref, session, { details });
}
