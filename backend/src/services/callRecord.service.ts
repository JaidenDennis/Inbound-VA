import { supabase } from '../db/index.js';
import { logger } from '../utils/index.js';
import { clientService } from './client.service.js';

// Spec-canonical custom_analysis_data keys → call_records boolean columns.
// If a Retell agent uses different field names, change these three constants.
const CAD_APPOINTMENT_BOOKED = 'appointment_booked';
const CAD_LEAD_RECAPTURED = 'lead_recaptured';
const CAD_MISSED_CALL_RECOVERED = 'missed_call_recovered';

/**
 * Demand-intelligence keys, added by migration 023.
 *
 * These are configured on the Retell agent by the provisioning template
 * (see RETELL_ANALYSIS_FIELDS in provisioning). An agent that has not been
 * re-provisioned simply omits them, and the columns stay NULL — which is the
 * honest answer, and distinguishable from a captured negative.
 */
const CAD_CALL_REASON = 'call_reason';
const CAD_REFERRAL_SOURCE = 'referral_source';
const CAD_REQUESTED_SERVICE = 'requested_service';
const CAD_SERVICE_AVAILABLE = 'service_available';
const CAD_ESCALATION_REASON = 'escalation_reason';

function asBool(v: unknown): boolean {
  return v === true || v === 'true' || v === 1;
}
function asNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Tri-state read: true / false / not-present.
 *
 * Deliberately NOT `asBool`. The five booleans that predate migration 023 default
 * a missing field to `false`, which is right for them — "no appointment was
 * booked" is true of a call where the field was never configured. It is wrong
 * for `service_available`: defaulting that to false would report every call at
 * an un-provisioned agent as demand the business could not serve, and that
 * number feeds a dollar figure on the owner's dashboard.
 */
function asNullableBool(v: unknown): boolean | null {
  if (v === true || v === 'true' || v === 1) return true;
  if (v === false || v === 'false' || v === 0) return false;
  return null;
}

/** Trimmed non-empty string, or null. Blank extractions are absences, not values. */
function asText(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  // Models asked for an extraction that is not present sometimes answer with a
  // word rather than omitting the field. Those are absences too.
  if (/^(n\/?a|none|unknown|not (specified|mentioned|provided|stated))$/i.test(t)) return null;
  return t.slice(0, 500);
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
  /** Every call in the period, including voicemails. */
  totalCalls: number;
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
      // Migration 023 signals. Null where the agent did not report them.
      call_reason: asText(cad[CAD_CALL_REASON]),
      referral_source: asText(cad[CAD_REFERRAL_SOURCE]),
      requested_service: asText(cad[CAD_REQUESTED_SERVICE]),
      service_available: asNullableBool(cad[CAD_SERVICE_AVAILABLE]),
      escalation_reason: asText(cad[CAD_ESCALATION_REASON]),
      raw_analysis: cad as Record<string, unknown>,
    };

    const { error } = await supabase.from('call_records').upsert(row, { onConflict: 'retell_call_id' });
    if (error) logger.error({ err: error, retellCallId }, 'Failed to upsert call_record');
  }

  /**
   * Aggregate stats for a client over [from, to] (by started_at).
   *
   * Aggregated in Postgres via report_kpis (migration 020). The previous
   * implementation pulled rows and counted them in JavaScript, which silently
   * under-reported past PostgREST's 1000-row response cap — so any client with
   * more than 1000 calls in the period was shown wrong numbers, with no error.
   */
  /** `clientId: null` aggregates every tenant — the platform-wide view. */
  async getStats(clientId: string | null, from: string, to: string): Promise<CallStats> {
    const { data, error } = await supabase.rpc('report_kpis', {
      p_client_id: clientId,
      p_from: from,
      p_to: to,
    });

    if (error) {
      logger.error({ err: error, clientId }, 'report_kpis failed');
      throw new Error(`Failed to load call stats: ${error.message}`);
    }

    const row = (data as Array<{
      calls_answered: number;
      missed_calls_recovered: number;
      leads_recaptured: number;
      appointments_booked: number;
      avg_call_duration_seconds: number;
      total_calls: number;
    }> | null)?.[0];

    return {
      callsAnswered: Number(row?.calls_answered ?? 0),
      missedCallsRecovered: Number(row?.missed_calls_recovered ?? 0),
      leadsRecaptured: Number(row?.leads_recaptured ?? 0),
      appointmentsBooked: Number(row?.appointments_booked ?? 0),
      avgCallDurationSeconds: Number(row?.avg_call_duration_seconds ?? 0),
      totalCalls: Number(row?.total_calls ?? 0),
    };
  }

  /** Calls per day or week, split answered vs voicemail, in the client's timezone. */
  async getVolume(
    clientId: string | null,
    from: string,
    to: string,
    bucket: 'day' | 'week'
  ): Promise<Array<{ bucket: string; answered: number; voicemail: number; total: number }>> {
    const { data, error } = await supabase.rpc('report_volume', {
      p_client_id: clientId,
      p_from: from,
      p_to: to,
      p_bucket: bucket,
    });
    if (error) {
      logger.error({ err: error, clientId }, 'report_volume failed');
      throw new Error(`Failed to load call volume: ${error.message}`);
    }
    return (data ?? []).map((r: { bucket: string; answered: number; voicemail: number; total: number }) => ({
      bucket: r.bucket,
      answered: Number(r.answered),
      voicemail: Number(r.voicemail),
      total: Number(r.total),
    }));
  }

  /** Where calls ended up. See call_outcome() in migration 020 for precedence. */
  async getOutcomes(
    clientId: string | null,
    from: string,
    to: string
  ): Promise<Array<{ outcome: string; count: number }>> {
    const { data, error } = await supabase.rpc('report_outcomes', {
      p_client_id: clientId,
      p_from: from,
      p_to: to,
    });
    if (error) {
      logger.error({ err: error, clientId }, 'report_outcomes failed');
      throw new Error(`Failed to load call outcomes: ${error.message}`);
    }
    return (data ?? []).map((r: { outcome: string; count: number }) => ({
      outcome: r.outcome,
      count: Number(r.count),
    }));
  }
}

export const callRecordService = new CallRecordService();
