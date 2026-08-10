import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { validateRetellWebhook } from '../../middleware/index.js';
import { clientService, callService, contactService, callRecordService } from '../../services/index.js';
import type { RetellAnalyzedCall } from '../../services/callRecord.service.js';
import { transcriptProcessingQueue, crmSyncQueue } from '../../queues/index.js';
import { eventBus } from '../../events/index.js';
import {
  normalizeCallStarted,
  normalizeCallEnded,
  normalizeSummary,
} from '../../providers/retell/index.js';
import { buildIdempotencyKey } from '../../utils/index.js';
import { supabase } from '../../db/index.js';
import { createSession } from '../../workflows/index.js';
import type {
  RetellCallStartedPayload,
  RetellCallEndedPayload,
  RetellSummaryPayload,
} from '../../providers/retell/index.js';

// Retell posts ALL call events to ONE webhook_url (by `event`). This dispatcher
// routes them, reusing the same services as the granular routes (which remain
// available). Provisioning points each agent's webhook_url here.
interface RetellEnvelope {
  event: string;
  call: {
    call_id: string;
    agent_id?: string;
    from_number?: string;
    to_number?: string;
    transcript_object?: Array<{ role: 'agent' | 'user'; content: string }>;
    [k: string]: unknown;
  };
}

async function onCallStarted(body: RetellCallStartedPayload, req: FastifyRequest, reply: FastifyReply) {
  const { call } = body;
  const client =
    (await clientService.findByPhoneNumber(call.to_number)) ??
    (await clientService.findByAgentId(call.agent_id));
  if (!client) {
    req.log.warn({ agentId: call.agent_id, toNumber: call.to_number }, 'No client for call');
    return reply.code(404).send({ error: 'Client not found' });
  }
  const contact = await contactService.upsertByPhone(client.id, call.from_number, {
    phone: call.from_number,
  });
  // Be defensive about the payload: a missing/invalid start_timestamp or an
  // unexpected direction must NOT throw and lose the whole call row (which
  // silently breaks the entire calls/conversations/appointments chain for that
  // call). Default sensibly instead.
  const startMs = new Date(call.start_timestamp as unknown as number).getTime();
  const startedAt = Number.isNaN(startMs) ? new Date().toISOString() : new Date(startMs).toISOString();
  const direction = call.direction === 'outbound' ? 'outbound' : 'inbound';
  const created = await callService.createCall({
    client_id: client.id,
    contact_id: contact.id,
    retell_call_id: call.call_id,
    direction,
    from_number: call.from_number,
    to_number: call.to_number,
    status: 'in_progress',
    started_at: startedAt,
  });
  // Routing-enabled clients get their workflow session opened at call start so
  // scope enforcement is active from the first tool invocation (best-effort —
  // route_intent also self-heals a missing session).
  try {
    const settings = await clientService.getSettings(client.id);
    if (settings?.agent_config?.workflow_routing) {
      await createSession({
        clientId: client.id,
        retellCallId: call.call_id,
        callId: created?.id ?? null,
        routingEnabled: true,
      });
    }
  } catch (err) {
    req.log.warn({ err, callId: call.call_id }, 'Failed to open workflow session at call start');
  }
  await eventBus.publish(normalizeCallStarted(body, client.id));
  return reply.code(200).send({ ok: true });
}

async function onCallEnded(body: RetellCallEndedPayload, req: FastifyRequest, reply: FastifyReply) {
  const { call } = body;
  const existing = await callService.findByRetellId(call.call_id);
  if (!existing) return reply.code(404).send({ error: 'Call not found' });

  await callService.endCall(existing.id, {
    status: 'completed',
    ended_at: new Date(call.end_timestamp).toISOString(),
    duration_seconds: Math.round(call.duration_ms / 1000),
    recording_url: call.recording_url ?? null,
  });
  if (call.call_analysis) {
    await callService.upsertConversation({
      call_id: existing.id,
      client_id: existing.client_id,
      contact_id: existing.contact_id,
      summary: call.call_analysis.call_summary ?? null,
      sentiment: call.call_analysis.user_sentiment ?? null,
      metadata: call.call_analysis as Record<string, unknown>,
    });
  }
  await eventBus.publish(normalizeCallEnded(body, existing.client_id));
  return reply.code(200).send({ ok: true });
}

/**
 * Rebuild the `calls` row for a call whose `call_started` never landed.
 *
 * Returns null only when the tenant cannot be resolved at all.
 *
 * call_started is the one webhook with no second chance: miss it (cold start,
 * deploy, a transient throw in the handler) and every later stage keyed on the
 * calls row is lost with it. That was 24 of 41 analyzed calls in production —
 * real inbound calls on the same numbers as the ones that worked, so this is
 * intermittent delivery, not misconfiguration, and it will happen again.
 *
 * The call_analyzed payload carries everything the row needs, so a miss is
 * recoverable rather than terminal. recordFromAnalyzed already self-heals the
 * tenant from agent_id, and route_intent already self-heals a missing workflow
 * session; this closes the same gap for the call itself.
 */
async function ensureCallRow(analyzed: RetellAnalyzedCall, req: FastifyRequest) {
  const retellCallId = analyzed.call_id!;
  const existing = await callService.findByRetellId(retellCallId);
  if (existing) return existing;

  const toNumber = typeof analyzed.to_number === 'string' ? analyzed.to_number : '';
  const fromNumber = typeof analyzed.from_number === 'string' ? analyzed.from_number : '';
  const client =
    (toNumber ? await clientService.findByPhoneNumber(toNumber) : null) ??
    (analyzed.agent_id ? await clientService.findByAgentId(analyzed.agent_id) : null);
  if (!client) {
    req.log.warn(
      { retellCallId, agentId: analyzed.agent_id, toNumber },
      'call_analyzed for an unknown tenant — cannot rebuild calls row'
    );
    return null;
  }

  // Web calls (Retell dashboard tests) have no numbers at all, and
  // contacts.phone / calls.from_number are both NOT NULL. An empty string is
  // how this codebase already stores a phoneless party (see contactService's
  // upsertByIdentity), so reuse that rather than inventing a sentinel.
  const contact = fromNumber
    ? await contactService.upsertByPhone(client.id, fromNumber, { phone: fromNumber })
    : null;

  const startMs = Number(analyzed.start_timestamp);
  const endMs = Number(analyzed.end_timestamp);
  await callService.upsertCallByRetellId({
    client_id: client.id,
    contact_id: contact?.id ?? null,
    retell_call_id: retellCallId,
    direction: analyzed.direction === 'outbound' ? 'outbound' : 'inbound',
    from_number: fromNumber,
    to_number: toNumber,
    status: 'completed',
    started_at: new Date(Number.isFinite(startMs) ? startMs : Date.now()).toISOString(),
    ended_at: Number.isFinite(endMs) ? new Date(endMs).toISOString() : null,
    duration_seconds:
      typeof analyzed.duration_ms === 'number' ? Math.round(analyzed.duration_ms / 1000) : null,
    recording_url: typeof analyzed.recording_url === 'string' ? analyzed.recording_url : null,
  });

  req.log.info({ retellCallId, clientId: client.id }, 'Rebuilt calls row from call_analyzed');
  // Re-read rather than trusting the upsert's return: on a race with a late
  // call_started the insert is ignored, and the winning row is the one to use.
  return callService.findByRetellId(retellCallId);
}

async function onCallAnalyzed(body: RetellSummaryPayload, envelope: RetellEnvelope, req: FastifyRequest, reply: FastifyReply) {
  const { call } = body;
  const analyzed = envelope.call as unknown as RetellAnalyzedCall;

  // Client-dashboard call_record (idempotent on retell_call_id). Resolves the
  // tenant from agent_id itself, so it runs independently of the calls row and
  // is safe even if call_started was missed.
  await callRecordService.recordFromAnalyzed(analyzed);

  const existing = await ensureCallRow(analyzed, req);
  if (!existing) return reply.code(404).send({ error: 'Client not found' });

  const analysis = call.call_analysis;
  await callService.upsertSummary({
    call_id: existing.id,
    client_id: existing.client_id,
    summary: analysis.call_summary,
    sentiment: (analysis.user_sentiment?.toLowerCase() ?? 'neutral') as 'positive' | 'neutral' | 'negative',
    action_items: [],
    key_topics: [],
    follow_up_required: false,
  });

  // Transcript arrives inside call_analyzed; process it if present.
  const transcriptObj = envelope.call.transcript_object;
  if (Array.isArray(transcriptObj) && transcriptObj.length) {
    await transcriptProcessingQueue.add(
      'process-transcript',
      {
        clientId: existing.client_id,
        callId: existing.id,
        transcript: transcriptObj.map((t, i) => ({ role: t.role, content: t.content, timestamp_ms: i * 1000 })),
        idempotencyKey: buildIdempotencyKey('transcript-proc', existing.id),
      },
      { jobId: buildIdempotencyKey('transcript-proc', existing.id) }
    );
  }

  // Push the summary to CRM (mirrors the granular summary route).
  const { data: conn } = await supabase
    .from('crm_connections')
    .select('id')
    .eq('client_id', existing.client_id)
    .eq('is_active', true)
    .maybeSingle();
  if (conn && existing.contact_id) {
    await crmSyncQueue.add(
      'push-summary',
      {
        clientId: existing.client_id,
        crmConnectionId: conn.id,
        entityType: 'summary',
        entityId: existing.id,
        operation: 'create',
        payload: { contactId: existing.contact_id, summary: analysis.call_summary, callId: existing.id },
        idempotencyKey: buildIdempotencyKey('summary', existing.id),
      },
      { jobId: buildIdempotencyKey('crm-summary', existing.id) }
    );
  }

  // Publishing this triggers post-call automation (lead recovery / missed-call).
  await eventBus.publish(normalizeSummary(body, existing.client_id));
  return reply.code(200).send({ ok: true });
}

export async function retellWebhookDispatcher(app: FastifyInstance): Promise<void> {
  app.post<{ Body: RetellEnvelope }>(
    '/webhooks/retell',
    { preHandler: validateRetellWebhook },
    async (request, reply) => {
      const envelope = request.body;
      switch (envelope.event) {
        case 'call_started':
          return onCallStarted(envelope as unknown as RetellCallStartedPayload, request, reply);
        case 'call_ended':
          return onCallEnded(envelope as unknown as RetellCallEndedPayload, request, reply);
        case 'call_analyzed':
          return onCallAnalyzed(envelope as unknown as RetellSummaryPayload, envelope, request, reply);
        default:
          request.log.info({ event: envelope.event }, 'Unhandled Retell webhook event');
          return reply.code(200).send({ ok: true, ignored: envelope.event });
      }
    }
  );
}
