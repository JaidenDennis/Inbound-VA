import { supabase } from '../../db/index.js';
import { logger } from '../../utils/index.js';
import type { CallSessionRecord, CallSessionState } from '../../types/index.js';

// Persistence for call_sessions. Keyed by retell_call_id — the one identifier
// every stateless Retell tool webhook carries — so a session can be opened even
// when the call_started webhook was missed (same posture as call_records).

export function emptySessionState(routingEnabled: boolean): CallSessionState {
  return {
    routingEnabled,
    active: null,
    stack: [],
    grantedScopes: [],
    identityVerified: false,
    emergencyFlagged: false,
    context: { previousTopics: [], summaryNotes: [] },
    eventSeq: 0,
  };
}

export async function findSession(retellCallId: string): Promise<CallSessionRecord | null> {
  const { data, error } = await supabase
    .from('call_sessions')
    .select('*')
    .eq('retell_call_id', retellCallId)
    .maybeSingle();
  if (error) {
    logger.error({ error, retellCallId }, 'Failed to load call session');
    return null;
  }
  return (data as CallSessionRecord | null) ?? null;
}

export async function createSession(input: {
  clientId: string;
  retellCallId: string;
  callId?: string | null;
  routingEnabled: boolean;
}): Promise<CallSessionRecord | null> {
  const { data, error } = await supabase
    .from('call_sessions')
    .upsert(
      {
        client_id: input.clientId,
        retell_call_id: input.retellCallId,
        call_id: input.callId ?? null,
        state: emptySessionState(input.routingEnabled),
      },
      { onConflict: 'retell_call_id', ignoreDuplicates: true }
    )
    .select()
    .maybeSingle();
  if (error) {
    logger.error({ error, retellCallId: input.retellCallId }, 'Failed to create call session');
    return null;
  }
  // ignoreDuplicates returns no row when the session already existed — reload.
  return (data as CallSessionRecord | null) ?? findSession(input.retellCallId);
}

export async function saveSessionState(
  retellCallId: string,
  state: CallSessionState
): Promise<void> {
  const { error } = await supabase
    .from('call_sessions')
    .update({ state })
    .eq('retell_call_id', retellCallId);
  if (error) logger.error({ error, retellCallId }, 'Failed to save call session state');
}
