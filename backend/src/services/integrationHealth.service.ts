import { supabase } from '../db/index.js';

/**
 * Is each integration actually working?
 *
 * `crm_connections.is_active` answers "did someone connect this", which is a
 * different question and the one that misleads: a credential stored in January
 * still reads as connected in August after the token silently stopped working.
 *
 * The honest evidence is the event stream. Every integration that does something
 * writes a normalised event when it succeeds and another when it fails, and those
 * rows are already there — so health is a read, not a new subsystem. Nothing here
 * writes anything.
 *
 * WHAT "NEVER" MEANS IS PART OF THE ANSWER
 * An integration with no success events is not necessarily broken; it may simply
 * never have been used. Those two are reported differently, because "we have not
 * seen this work yet" and "this stopped working" call for different actions.
 */

export type HealthStatus =
  /** Succeeded, and no failure since. */
  | 'ok'
  /** Failed more recently than it last succeeded. */
  | 'failing'
  /** Work is arriving but nothing completes — requests with no confirmations. */
  | 'stalled'
  /** No evidence either way. Not an error. */
  | 'never';

export interface ChannelHealth {
  id: string;
  label: string;
  status: HealthStatus;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  /** Plain-language reading of the status. Always present. */
  note: string;
}

interface ChannelSpec {
  id: string;
  label: string;
  success: string[];
  failure: string[];
  /**
   * Events that mean work was requested. A channel with these and no successes
   * is stalled rather than unused — the distinction the booking pipeline needs.
   */
  pending?: string[];
  neverNote: string;
}

const CHANNELS: ChannelSpec[] = [
  {
    id: 'telephony',
    label: 'Inbound calls',
    success: ['call.started'],
    failure: [],
    neverNote: 'No call has reached this agent yet.',
  },
  {
    id: 'webhooks',
    label: 'Call webhooks',
    success: ['call.ended'],
    failure: [],
    // Deliberately separate from telephony. Calls that start but never end mean
    // Retell is reaching us and our webhook is not completing — which looks
    // completely healthy from the call side while every transcript goes missing.
    pending: ['call.started'],
    neverNote: 'No completed call has been received yet.',
  },
  {
    id: 'crm',
    label: 'CRM sync',
    success: ['crm.sync.completed', 'crm.provision.completed'],
    failure: ['crm.sync.failed', 'crm.provision.failed'],
    pending: ['crm.sync.started', 'crm.provision.started'],
    neverNote: 'Nothing has been pushed to a CRM yet.',
  },
  {
    id: 'calendar',
    label: 'Calendar booking',
    success: ['booking.confirmed'],
    failure: [],
    pending: ['booking.requested'],
    neverNote: 'No appointment has been booked through the agent yet.',
  },
];

/** Most recent occurrence of any of these event types, or null. */
async function latestOf(clientId: string, types: string[]): Promise<string | null> {
  if (types.length === 0) return null;

  const { data } = await supabase
    .from('events')
    .select('created_at')
    .eq('client_id', clientId)
    .in('event_type', types)
    .order('created_at', { ascending: false })
    .limit(1);

  return ((data ?? [])[0] as { created_at: string } | undefined)?.created_at ?? null;
}

/**
 * How long work may sit unfinished before it counts as stalled.
 *
 * Without a grace period every call in progress reports its channel as broken,
 * and an alert that cries wolf during normal operation is worse than no alert.
 * An hour is well past any legitimate call or sync and well short of a working
 * day, so a genuine break is caught the same morning.
 */
const STALL_GRACE_MS = 60 * 60 * 1000;

function statusFor(
  spec: ChannelSpec,
  success: string | null,
  failure: string | null,
  pending: string | null
): { status: HealthStatus; note: string } {
  if (failure && (!success || failure > success)) {
    return {
      status: 'failing',
      note: success
        ? 'This failed more recently than it last succeeded.'
        : 'This has never succeeded — every attempt so far has failed.',
    };
  }

  // Work started well after the last completion. The channel is not erroring,
  // which is exactly why it goes unnoticed: nothing lands in the error console.
  if (pending && (!success || pending > success)) {
    const stalledFor = Date.now() - Date.parse(pending);
    if (!success || stalledFor > STALL_GRACE_MS) {
      return {
        status: 'stalled',
        note: success
          ? 'Work has been requested since the last completion and has not finished.'
          : 'Requests are being made but none has ever completed. Work is arriving and going nowhere.',
      };
    }
  }

  if (success) return { status: 'ok', note: 'Working — this has completed successfully.' };

  return { status: 'never', note: spec.neverNote };
}

/** Health for every channel, for one tenant. */
export async function integrationHealth(clientId: string): Promise<ChannelHealth[]> {
  return Promise.all(
    CHANNELS.map(async (spec) => {
      const [success, failure, pending] = await Promise.all([
        latestOf(clientId, spec.success),
        latestOf(clientId, spec.failure),
        latestOf(clientId, spec.pending ?? []),
      ]);

      const { status, note } = statusFor(spec, success, failure, pending);
      return {
        id: spec.id,
        label: spec.label,
        status,
        lastSuccessAt: success,
        lastFailureAt: failure,
        note,
      };
    })
  );
}

export const integrationHealthService = { integrationHealth, CHANNELS };
