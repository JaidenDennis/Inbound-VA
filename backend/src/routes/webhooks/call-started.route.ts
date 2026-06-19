import type { FastifyInstance } from 'fastify';
import { validateRetellWebhook } from '../../middleware/index.js';
import { clientService, callService, contactService } from '../../services/index.js';
import { eventBus } from '../../events/index.js';
import { normalizeCallStarted } from '../../providers/retell/index.js';
import type { RetellCallStartedPayload } from '../../providers/retell/index.js';

export async function callStartedRoute(app: FastifyInstance): Promise<void> {
  app.post<{ Body: RetellCallStartedPayload }>(
    '/webhooks/retell/call-started',
    { preHandler: validateRetellWebhook },
    async (request, reply) => {
      const { call } = request.body;

      // Resolve client by phone number or agent ID
      const client =
        (await clientService.findByPhoneNumber(call.to_number)) ??
        (await clientService.findByAgentId(call.agent_id));

      if (!client) {
        request.log.warn({ agentId: call.agent_id, toNumber: call.to_number }, 'No client found');
        return reply.code(404).send({ error: 'Client not found' });
      }

      // Upsert contact
      const contact = await contactService.upsertByPhone(client.id, call.from_number, {
        first_name: '',
        last_name: '',
        phone: call.from_number,
      });

      // Create call record
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

      // Publish normalized event
      await eventBus.publish(normalizeCallStarted(request.body, client.id));

      reply.code(200).send({ ok: true });
    }
  );
}
