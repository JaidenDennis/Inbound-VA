import type { FastifyRequest, FastifyReply } from 'fastify';
import { validateRetellSignature } from '../providers/retell/index.js';

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
    reply.code(401).send({ error: 'Invalid webhook signature' });
    return; // stop the request lifecycle so the handler does not run
  }
}
