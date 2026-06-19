import type { FastifyInstance } from 'fastify';
import { validateRetellWebhook } from '../../middleware/index.js';
import { callService } from '../../services/index.js';
import { crmSyncQueue } from '../../queues/index.js';
import { supabase } from '../../db/index.js';
import { eventBus } from '../../events/index.js';
import { normalizeSummary } from '../../providers/retell/index.js';
import { buildIdempotencyKey } from '../../utils/index.js';
import type { RetellSummaryPayload } from '../../providers/retell/index.js';

export async function summaryRoute(app: FastifyInstance): Promise<void> {
  app.post<{ Body: RetellSummaryPayload }>(
    '/webhooks/retell/summary',
    { preHandler: validateRetellWebhook },
    async (request, reply) => {
      const { call } = request.body;

      const existingCall = await callService.findByRetellId(call.call_id);
      if (!existingCall) {
        return reply.code(404).send({ error: 'Call not found' });
      }

      const { call_analysis } = call;
      await callService.upsertSummary({
        call_id: existingCall.id,
        client_id: existingCall.client_id,
        summary: call_analysis.call_summary,
        sentiment: (call_analysis.user_sentiment?.toLowerCase() ?? 'neutral') as 'positive' | 'neutral' | 'negative',
        action_items: [],
        key_topics: [],
        follow_up_required: false,
      });

      // Push summary to CRM
      const { data: conn } = await supabase
        .from('crm_connections')
        .select('id')
        .eq('client_id', existingCall.client_id)
        .eq('is_active', true)
        .single();

      if (conn && existingCall.contact_id) {
        await crmSyncQueue.add(
          'push-summary',
          {
            clientId: existingCall.client_id,
            crmConnectionId: conn.id,
            entityType: 'summary',
            entityId: existingCall.id,
            operation: 'create',
            payload: {
              contactId: existingCall.contact_id,
              summary: call_analysis.call_summary,
              callId: existingCall.id,
            },
            idempotencyKey: buildIdempotencyKey('summary', existingCall.id),
          },
          { jobId: buildIdempotencyKey('crm-summary', existingCall.id) }
        );
      }

      await eventBus.publish(normalizeSummary(request.body, existingCall.client_id));
      reply.code(200).send({ ok: true });
    }
  );
}
