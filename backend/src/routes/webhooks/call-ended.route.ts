import type { FastifyInstance } from 'fastify';
import { validateRetellWebhook } from '../../middleware/index.js';
import { callService, clientService } from '../../services/index.js';
import { notificationsQueue } from '../../queues/index.js';
import { eventBus } from '../../events/index.js';
import { normalizeCallEnded } from '../../providers/retell/index.js';
import type { RetellCallEndedPayload } from '../../providers/retell/index.js';
import { buildIdempotencyKey } from '../../utils/index.js';

export async function callEndedRoute(app: FastifyInstance): Promise<void> {
  app.post<{ Body: RetellCallEndedPayload }>(
    '/webhooks/retell/call-ended',
    { preHandler: validateRetellWebhook },
    async (request, reply) => {
      const { call } = request.body;

      const existingCall = await callService.findByRetellId(call.call_id);
      if (!existingCall) {
        request.log.warn({ retellCallId: call.call_id }, 'Call not found on ended event');
        return reply.code(404).send({ error: 'Call not found' });
      }

      // Update call
      await callService.endCall(existingCall.id, {
        status: 'completed',
        ended_at: new Date(call.end_timestamp).toISOString(),
        duration_seconds: Math.round(call.duration_ms / 1000),
        recording_url: call.recording_url ?? null,
      });

      // Update conversation flags from Retell analysis
      if (call.call_analysis) {
        await callService.upsertConversation({
          call_id: existingCall.id,
          client_id: existingCall.client_id,
          contact_id: existingCall.contact_id,
          summary: call.call_analysis.call_summary ?? null,
          sentiment: call.call_analysis.user_sentiment ?? null,
          metadata: call.call_analysis as Record<string, unknown>,
        });
      }

      // Notify staff if handoff was requested (check metadata)
      const settings = await clientService.getSettings(existingCall.client_id);
      if (settings?.notification_emails?.length) {
        await notificationsQueue.add(
          'call-ended-notification',
          {
            clientId: existingCall.client_id,
            type: 'lead',
            recipients: settings.notification_emails,
            subject: `Call Ended – ${call.from_number}`,
            body: `A call just ended.\nFrom: ${call.from_number}\nDuration: ${Math.round(call.duration_ms / 1000)}s\n\n${call.call_analysis?.call_summary ?? ''}`,
            callId: existingCall.id,
          },
          { jobId: buildIdempotencyKey('notification-call-ended', existingCall.id) }
        );
      }

      await eventBus.publish(normalizeCallEnded(request.body, existingCall.client_id));
      reply.code(200).send({ ok: true });
    }
  );
}
