import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { validateRetellWebhook } from '../../middleware/index.js';
import { clientService, callService, contactService } from '../../services/index.js';
import { notificationsQueue, transcriptProcessingQueue, crmSyncQueue } from '../../queues/index.js';
import { eventBus } from '../../events/index.js';
import {
  normalizeCallStarted,
  normalizeCallEnded,
  normalizeSummary,
} from '../../providers/retell/index.js';
import { buildIdempotencyKey } from '../../utils/index.js';
import { supabase } from '../../db/index.js';
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
  await callService.createCall({
    client_id: client.id,
    contact_id: contact.id,
    retell_call_id: call.call_id,
    direction: call.direction,
    from_number: call.from_number,
    to_number: call.to_number,
    status: 'in_progress',
    started_at: new Date(call.start_timestamp).toISOString(),
  });
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

async function onCallAnalyzed(body: RetellSummaryPayload, envelope: RetellEnvelope, req: FastifyRequest, reply: FastifyReply) {
  const { call } = body;
  const existing = await callService.findByRetellId(call.call_id);
  if (!existing) return reply.code(404).send({ error: 'Call not found' });

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
