import { supabase } from '../db/index.js';
import { logger } from '../utils/index.js';
import { clientService } from './client.service.js';

// Spec-canonical custom_analysis_data keys → call_records boolean columns.
// If a Retell agent uses different field names, change these three constants.
const CAD_APPOINTMENT_BOOKED = 'appointment_booked';
const CAD_LEAD_RECAPTURED = 'lead_recaptured';
const CAD_MISSED_CALL_RECOVERED = 'missed_call_recovered';

function asBool(v: unknown): boolean {
  return v === true || v === 'true' || v === 1;
}
function asNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// The call_analyzed payload carries more than our trimmed RetellSummaryPayload
// type declares, so we read defensively from a loose shape.
export interface RetellAnalyzedCall {
  call_id?: string;
  agent_id?: string;
  start_timestamp?: number;
  end_timestamp?: number;
  duration_ms?: number;
  disconnection_reason?: string;
  call_cost?: { total_duration_seconds?: number };
  call_analysis?: {
    user_sentiment?: string;
    call_successful?: boolean;
    in_voicemail?: boolean;
    custom_analysis_data?: Record<string, unknown>;
  };
  [k: string]: unknown;
}

export interface CallStats {
  callsAnswered: number;
  missedCallsRecovered: number;
  leadsRecaptured: number;
  appointmentsBooked: number;
  avgCallDurationSeconds: number;
}

export class CallRecordService {
  /**
   * Write one call_record per completed call. Idempotent on retell_call_id
   * (safe to receive duplicate webhooks). Resolves the tenant from agent_id; an
   * unknown agent_id is logged and skipped — never writes an orphan row. Any
   * custom field that isn't present defaults to false so stats read 0.
   */
  async recordFromAnalyzed(call: RetellAnalyzedCall): Promise<void> {
    const retellCallId = call.call_id;
    const agentId = call.agent_id;
    if (!retellCallId || !agentId) {
      logger.warn({ retellCallId, agentId }, 'call_analyzed missing call_id/agent_id — skipping call_record');
      return;
    }

    const client = await clientService.findByAgentId(agentId);
    if (!client) {
      logger.warn({ agentId, retellCallId }, 'Unknown Retell agent_id — skipping call_record (no orphan)');
      return;
    }

    const cad = call.call_analysis?.custom_analysis_data ?? {};
    const durationSeconds =
      asNum(call.call_cost?.total_duration_seconds) ??
      (typeof call.duration_ms === 'number' ? Math.round(call.duration_ms / 1000) : null) ??
      (typeof call.start_timestamp === 'number' && typeof call.end_timestamp === 'number'
        ? Math.round((call.end_timestamp - call.start_timestamp) / 1000)
        : null);

    const row = {
      client_id: client.id,
      retell_call_id: retellCallId,
      agent_id: agentId,
      started_at: typeof call.start_timestamp === 'number' ? new Date(call.start_timestamp).toISOString() : null,
      ended_at: typeof call.end_timestamp === 'number' ? new Date(call.end_timestamp).toISOString() : null,
      duration_seconds: durationSeconds,
      in_voicemail: asBool(call.call_analysis?.in_voicemail),
      disconnection_reason: typeof call.disconnection_reason === 'string' ? call.disconnection_reason : null,
      user_sentiment: call.call_analysis?.user_sentiment ?? null,
      call_successful:
        typeof call.call_analysis?.call_successful === 'boolean' ? call.call_analysis.call_successful : null,
      appointment_booked: asBool(cad[CAD_APPOINTMENT_BOOKED]),
      lead_recaptured: asBool(cad[CAD_LEAD_RECAPTURED]),
      missed_call_recovered: asBool(cad[CAD_MISSED_CALL_RECOVERED]),
      raw_analysis: cad as Record<string, unknown>,
    };

    const { error } = await supabase.from('call_records').upsert(row, { onConflict: 'retell_call_id' });
    if (error) logger.error({ err: error, retellCallId }, 'Failed to upsert call_record');
  }

  /** Aggregate stats for a client over [from, to] (by started_at). */
  async getStats(clientId: string, from: string, to: string): Promise<CallStats> {
    const { data } = await supabase
      .from('call_records')
      .select('in_voicemail, missed_call_recovered, lead_recaptured, appointment_booked, duration_seconds')
      .eq('client_id', clientId)
      .gte('started_at', from)
      .lte('started_at', to);

    const rows = (data ?? []) as Array<{
      in_voicemail: boolean;
      missed_call_recovered: boolean;
      lead_recaptured: boolean;
      appointment_booked: boolean;
      duration_seconds: number | null;
    }>;

    const answered = rows.filter((r) => !r.in_voicemail);
    const avgCallDurationSeconds = answered.length
      ? Math.round(answered.reduce((acc, r) => acc + (r.duration_seconds ?? 0), 0) / answered.length)
      : 0;

    return {
      callsAnswered: answered.length,
      missedCallsRecovered: rows.filter((r) => r.missed_call_recovered).length,
      leadsRecaptured: rows.filter((r) => r.lead_recaptured).length,
      appointmentsBooked: rows.filter((r) => r.appointment_booked).length,
      avgCallDurationSeconds,
    };
  }
}

export const callRecordService = new CallRecordService();
