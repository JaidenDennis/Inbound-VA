import type { FastifyInstance } from 'fastify';
import { env } from '../../config/index.js';
import { validateClaySecret } from '../../middleware/index.js';
import {
  clayLeadSchema,
  clayLeadService,
  ClayIngestError,
} from '../../services/clay-lead.service.js';

/**
 * Clay pushes an enriched lead here (HTTP API column, one request per row) and
 * the backend owns the CRM write from that point on — see clay-lead.service.
 */
export async function clayLeadRoute(app: FastifyInstance): Promise<void> {
  app.post('/webhooks/clay/lead', {
    preHandler: validateClaySecret,
    // A Clay table run fires hundreds of rows in a burst; the global limit is
    // sized for browser traffic, so this endpoint carries its own.
    config: {
      rateLimit: {
        max: env.CLAY_RATE_LIMIT_MAX,
        timeWindow: env.RATE_LIMIT_WINDOW_MS,
      },
    },
    handler: async (request, reply) => {
      const lead = clayLeadSchema.parse(request.body);
      try {
        const result = await clayLeadService.ingest(lead);
        return reply.code(202).send(result);
      } catch (err) {
        if (err instanceof ClayIngestError) {
          // Answer 4xx with a readable reason: Clay surfaces the response body
          // in the row's cell, so this is what the operator actually sees.
          request.log.warn({ err: err.message }, 'Clay lead ingest rejected');
          return reply.code(err.statusCode).send({ error: err.message });
        }
        throw err;
      }
    },
  });
}
