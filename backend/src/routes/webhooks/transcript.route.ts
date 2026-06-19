import type { FastifyInstance } from 'fastify';
import { validateRetellWebhook } from '../../middleware/index.js';
import { callService } from '../../services/index.js';
import { eventBus } from '../../events/index.js';
import { normalizeTranscript } from '../../providers/retell/index.js';
import type { RetellTranscriptPayload } from '../../providers/retell/index.js';

export async function transcriptRoute(app: FastifyInstance): Promise<void> {
  app.post<{ Body: RetellTranscriptPayload }>(
    '/webhooks/retell/transcript',
    { preHandler: validateRetellWebhook },
    async (request, reply) => {
      const { call, transcript } = request.body;

      const existingCall = await callService.findByRetellId(call.call_id);
      if (!existingCall) {
        return reply.code(404).send({ error: 'Call not found' });
      }

      await callService.processTranscript(
        existingCall.id,
        existingCall.client_id,
        transcript.map((t, i) => ({ role: t.role, content: t.content, timestamp_ms: i * 1000 }))
      );

      await eventBus.publish(normalizeTranscript(request.body, existingCall.client_id));
      reply.code(200).send({ ok: true });
    }
  );
}
