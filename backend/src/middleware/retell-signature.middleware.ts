import type { FastifyRequest, FastifyReply } from 'fastify';
import { validateRetellSignature } from '../providers/retell/index.js';
import { systemErrorService } from '../services/systemError.service.js';

export async function validateRetellWebhook(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const signature = request.headers['x-retell-signature'] as string | undefined;

  // Use the exact raw bytes captured by the content-type parser (app.ts),
  // NOT a re-serialization of the parsed body — HMAC must match byte-for-byte.
  const rawBody = (request as unknown as { rawBody?: string }).rawBody ?? '';

  if (!validateRetellSignature(rawBody, signature)) {
    request.log.warn('Retell webhook signature validation failed');

    // A rejected webhook is invisible otherwise: the caller gets a 401 and the
    // route never runs, so nothing downstream records it. Left unrecorded, a
    // rotated Retell secret looks like "calls just stopped arriving".
    //
    // Severity is `warn`, not `error`: a single mismatch may be an internet
    // scanner. Repetition is what matters, and the fingerprint makes that
    // visible in the console.
    void systemErrorService.record({
      source: 'webhook',
      severity: 'warn',
      route: request.routeOptions?.url ?? request.url,
      method: request.method,
      statusCode: 401,
      error: {
        name: 'WebhookSignatureError',
        message: signature
          ? 'Retell webhook signature did not match the request body'
          : 'Retell webhook arrived with no x-retell-signature header',
      },
      // Deliberately no body: an unverified payload is untrusted input and
      // storing it would let anyone able to POST here write to our error store.
      context: { hasSignature: !!signature, bodyBytes: rawBody.length, ip: request.ip },
    });

    reply.code(401).send({ error: 'Invalid webhook signature' });
    return; // stop the request lifecycle so the handler does not run
  }
}
