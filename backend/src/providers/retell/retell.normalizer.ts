import type { NormalizedEvent } from '../../types/index.js';
import type {
  RetellCallStartedPayload,
  RetellCallEndedPayload,
  RetellTranscriptPayload,
  RetellSummaryPayload,
} from './retell.types.js';
import { buildIdempotencyKey } from '../../utils/index.js';
import { v4 as uuidv4 } from 'uuid';

export function normalizeCallStarted(
  payload: RetellCallStartedPayload,
  clientId: string
): NormalizedEvent {
  const callId = payload.call.call_id;
  return {
    id: uuidv4(),
    type: 'call.started',
    clientId,
    callId,
    payload: {
      retellCallId: callId,
      agentId: payload.call.agent_id,
      fromNumber: payload.call.from_number,
      toNumber: payload.call.to_number,
      direction: payload.call.direction,
      startedAt: new Date(payload.call.start_timestamp).toISOString(),
    },
    timestamp: new Date(),
    source: 'retell',
    idempotencyKey: buildIdempotencyKey('call.started', callId),
  };
}

export function normalizeCallEnded(
  payload: RetellCallEndedPayload,
  clientId: string
): NormalizedEvent {
  const callId = payload.call.call_id;
  return {
    id: uuidv4(),
    type: 'call.ended',
    clientId,
    callId,
    payload: {
      retellCallId: callId,
      agentId: payload.call.agent_id,
      fromNumber: payload.call.from_number,
      toNumber: payload.call.to_number,
      direction: payload.call.direction,
      durationMs: payload.call.duration_ms,
      startedAt: new Date(payload.call.start_timestamp).toISOString(),
      endedAt: new Date(payload.call.end_timestamp).toISOString(),
      recordingUrl: payload.call.recording_url ?? null,
      callAnalysis: payload.call.call_analysis ?? {},
    },
    timestamp: new Date(),
    source: 'retell',
    idempotencyKey: buildIdempotencyKey('call.ended', callId),
  };
}

export function normalizeTranscript(
  payload: RetellTranscriptPayload,
  clientId: string
): NormalizedEvent {
  const callId = payload.call.call_id;
  return {
    id: uuidv4(),
    type: 'call.transcript.completed',
    clientId,
    callId,
    payload: {
      retellCallId: callId,
      transcript: payload.transcript.map((t, i) => ({
        role: t.role,
        content: t.content,
        timestamp_ms: i * 1000,
      })),
    },
    timestamp: new Date(),
    source: 'retell',
    idempotencyKey: buildIdempotencyKey('call.transcript', callId),
  };
}

export function normalizeSummary(
  payload: RetellSummaryPayload,
  clientId: string
): NormalizedEvent {
  const callId = payload.call.call_id;
  return {
    id: uuidv4(),
    type: 'call.summary.completed',
    clientId,
    callId,
    payload: {
      retellCallId: callId,
      summary: payload.call.call_analysis.call_summary,
      sentiment: payload.call.call_analysis.user_sentiment,
      customData: payload.call.call_analysis.custom_analysis_data ?? {},
    },
    timestamp: new Date(),
    source: 'retell',
    idempotencyKey: buildIdempotencyKey('call.summary', callId),
  };
}
