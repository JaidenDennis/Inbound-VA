import { supabase } from '../db/index.js';
import { logger } from '../utils/index.js';

interface AuditEntry {
  userId?: string;
  clientId?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  oldValue?: unknown;
  newValue?: unknown;
  ipAddress?: string;
  userAgent?: string;
}

export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  await supabase.from('audit_logs').insert({
    user_id: entry.userId ?? null,
    client_id: entry.clientId ?? null,
    action: entry.action,
    entity_type: entry.entityType ?? null,
    entity_id: entry.entityId ?? null,
    old_value: entry.oldValue ? JSON.parse(JSON.stringify(entry.oldValue)) : null,
    new_value: entry.newValue ? JSON.parse(JSON.stringify(entry.newValue)) : null,
    ip_address: entry.ipAddress ?? null,
    user_agent: entry.userAgent ?? null,
  });
}

export interface AuditActor {
  userId: string;
  clientId?: string | null;
  ipAddress?: string;
  userAgent?: string;
}

interface WithAuditOptions<T> {
  actor: AuditActor;
  action: string;
  entityType: string;
  entityId?: string;
  /** Reads the state that is about to change. Runs BEFORE the mutation. */
  before: () => Promise<T | null>;
  /** Performs the change and returns the new state. */
  mutate: () => Promise<T>;
}

/**
 * Run a configure-axis mutation and record it, in that order, in one place.
 *
 * Every `configure` action must land in `audit_logs` with actor, timestamp,
 * resource, and before/after state — it backs both the "Recent changes" UI and
 * the compliance answer during an enterprise security review.
 *
 * The wrapper exists so a route cannot forget: auditing is HOW it mutates, not
 * a second call it makes afterwards and might drop during a refactor.
 * `audit-coverage.test.ts` walks the configure-axis route table and fails on any
 * route that mutates without going through here.
 *
 * The audit write is deliberately NOT inside the caller's transaction — there
 * isn't one, since Supabase's client is per-statement. If the log write fails
 * after a successful mutation the change stands and the failure is logged loudly
 * rather than rolled back: silently reverting a config change the operator
 * watched succeed is worse than a gap in the log, and the gap is detectable.
 */
export async function withAudit<T>(options: WithAuditOptions<T>): Promise<T> {
  const { actor, action, entityType, entityId, before, mutate } = options;

  const oldValue = await before();
  const newValue = await mutate();

  try {
    await writeAuditLog({
      userId: actor.userId,
      clientId: actor.clientId ?? undefined,
      action,
      entityType,
      entityId,
      oldValue,
      newValue,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
  } catch (err) {
    logger.error(
      { err, action, entityType, entityId, userId: actor.userId },
      'AUDIT WRITE FAILED — mutation succeeded but was not recorded'
    );
  }

  return newValue;
}

/**
 * Record a transcript view.
 *
 * Separate from `withAudit` because there is no before/after state — the value
 * is the access record itself, so `new_value` stays null and the row is the
 * proof that this user saw this transcript at this time.
 *
 * Scoped to individual transcript reads, never list views. One row per opened
 * transcript is affordable at these volumes; one row per call-log page render
 * would not be, and would bury the reads that matter.
 */
export async function auditTranscriptView(
  actor: AuditActor,
  transcriptId: string,
  callId?: string
): Promise<void> {
  await writeAuditLog({
    userId: actor.userId,
    clientId: actor.clientId ?? undefined,
    action: 'transcript.view',
    entityType: 'call_transcripts',
    entityId: transcriptId,
    oldValue: null,
    newValue: callId ? { call_id: callId } : null,
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });
}
