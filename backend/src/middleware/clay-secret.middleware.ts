import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../config/index.js';

/**
 * Shared-secret auth for the Clay ingest endpoint. Clay's HTTP API column can
 * set static headers but cannot compute a per-body HMAC, so this is a bearer
 * secret rather than a signature like the Retell webhooks.
 *
 * Accepts `Authorization: Bearer <secret>` or `X-Clay-Secret: <secret>`.
 * With CLAY_INGEST_SECRET unset the endpoint is disabled (503) — an unset
 * secret must never mean "no auth required".
 */
export async function validateClaySecret(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const expected = env.CLAY_INGEST_SECRET;
  if (!expected) {
    request.log.warn('Clay ingest called but CLAY_INGEST_SECRET is not configured');
    reply.code(503).send({ error: 'Clay ingest is not configured' });
    return;
  }

  const header = request.headers.authorization;
  const presented =
    (header?.startsWith('Bearer ') ? header.slice(7) : undefined) ??
    (request.headers['x-clay-secret'] as string | undefined);

  if (!presented || !secretsMatch(presented, expected)) {
    request.log.warn('Clay ingest secret validation failed');
    reply.code(401).send({ error: 'Invalid Clay ingest secret' });
    return; // stop the request lifecycle so the handler does not run
  }
}

/** Constant-time compare over SHA-256 digests so lengths are always equal. */
function secretsMatch(presented: string, expected: string): boolean {
  const a = createHash('sha256').update(presented).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}
