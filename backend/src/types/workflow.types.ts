import type { ClientSettings } from './client.types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Inbound workflow engine — canonical types.
//
// The engine is generic; workflows are declarative (src/workflows/definitions).
// Definitions are CODE (may hold validator/guard functions); session state is
// DATA (persisted as JSONB in call_sessions) and must stay JSON-serializable.
// ─────────────────────────────────────────────────────────────────────────────

/** Capability scopes granted to the agent while a workflow is active. */
export type CapabilityScope =
  | 'booking'
  | 'knowledge'
  | 'crm'
  | 'payments'
  | 'support'
  | 'system';

/** Owning capability — groups workflows so intent classification stays simple. */
export type Capability =
  | 'appointments'
  | 'knowledge'
  | 'leads'
  | 'account'
  | 'support'
  | 'system';

export interface SlotValidationContext {
  settings: ClientSettings | null;
  timezone: string;
  now: Date;
}

export interface SlotDefinition {
  name: string;
  /** Conversational hint for the agent when asking for this slot. */
  description: string;
  required: boolean;
  /** Deterministic validation owned by the workflow. Error message, or null when valid. */
  validate?: (value: unknown, ctx: SlotValidationContext) => string | null;
}

/** A condition gating entry into specific states (e.g. identity before account data). */
export interface WorkflowGuard {
  name: string;
  /** States that cannot be entered unless check() passes. */
  states: string[];
  check: (session: CallSessionState) => boolean;
  /** What the agent should do when the guard blocks (spoken guidance). */
  failureGuidance: string;
}

export interface WorkflowDefinition {
  /** Stable id, e.g. 'book_appointment'. */
  id: string;
  capability: Capability;
  /** Intent labels that route to this workflow (many-to-one allowed). */
  intents: string[];
  /** Scopes granted while this workflow is active. */
  scopes: CapabilityScope[];
  slots: SlotDefinition[];
  /** First entry is the initial state. */
  states: string[];
  /** state → states it may transition to. Terminal states map to []. */
  transitions: Record<string, string[]>;
  guards?: WorkflowGuard[];
  /** Allowed completion outcomes, e.g. 'booked', 'no_availability'. */
  outcomes: string[];
  /** Per-state conversational guidance returned to the agent via route_intent. */
  guidance: Record<string, string>;
}

/** One workflow's position — the active frame or a stacked (paused) one. */
export interface ActiveWorkflowFrame {
  workflowId: string;
  state: string;
  slots: Record<string, unknown>;
  startedAt: string;
}

/** Global conversation context shared across workflows (never duplicated per-frame). */
export interface ConversationContext {
  contactId?: string;
  language?: string;
  location?: string;
  previousTopics: string[];
  summaryNotes: string[];
  sentiment?: string;
}

/** JSON-serializable session state persisted in call_sessions.state. */
export interface CallSessionState {
  /** True when this call runs under workflow routing (scope enforcement active). */
  routingEnabled: boolean;
  active: ActiveWorkflowFrame | null;
  /** Paused workflows, most recent last (topic-switch stack). */
  stack: ActiveWorkflowFrame[];
  grantedScopes: CapabilityScope[];
  identityVerified: boolean;
  emergencyFlagged: boolean;
  context: ConversationContext;
  /** Monotonic counter uniquifying per-transition event idempotency keys. */
  eventSeq: number;
}

export interface CallSessionRecord {
  id: string;
  client_id: string;
  call_id: string | null;
  retell_call_id: string;
  state: CallSessionState;
  created_at: string;
  updated_at: string;
}

/** What route_intent returns to the agent: the workflow contract. */
export interface WorkflowContract {
  workflow_id: string | null;
  capability: Capability | null;
  state: string | null;
  missing_slots: Array<{ name: string; description: string }>;
  granted_scopes: CapabilityScope[];
  /** Brief conversational guidance for the agent's next step. */
  guidance: string;
}

/** Metadata every backend action declares; enforced by the scope guard + retry policy. */
export interface ActionMetadata {
  /** Canonical dotted id, e.g. 'booking.create'. */
  action: string;
  scope: CapabilityScope;
  requiresVerifiedIdentity: boolean;
  idempotent: boolean;
  retrySafe: boolean;
  /** Workflow ids that primarily own this action (informational). */
  workflows?: string[];
}
