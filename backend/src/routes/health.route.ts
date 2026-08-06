import type { FastifyInstance } from 'fastify';
import { supabase } from '../db/index.js';
import { redis } from '../queues/index.js';

/** A dependency probe must never hang the health check — Render times out at 30s. */
const PROBE_TIMEOUT_MS = 5_000;

function withTimeout<T>(promise: PromiseLike<T>, label: string): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} probe timed out`)), PROBE_TIMEOUT_MS)
    ),
  ]);
}

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_req, reply) => {
    const checks: Record<string, string> = {};

    // supabase-js RESOLVES with { data, error } on a failed query — it does not
    // throw. Checking only for a thrown exception reported "ok" for a dead or
    // permission-denied database, so Render kept broken instances in rotation.
    // The `error` field is the actual signal; the catch is for transport faults.
    try {
      const { error } = await withTimeout(
        supabase.from('clients').select('id').limit(1),
        'database'
      );
      checks['database'] = error ? 'error' : 'ok';
      if (error) {
        app.log.error({ err: error }, 'Health check: database probe failed');
      }
    } catch (err) {
      app.log.error({ err }, 'Health check: database unreachable');
      checks['database'] = 'error';
    }

    try {
      const pong = await withTimeout(redis.ping(), 'redis');
      checks['redis'] = pong === 'PONG' ? 'ok' : 'error';
    } catch (err) {
      app.log.error({ err }, 'Health check: redis unreachable');
      checks['redis'] = 'error';
    }

    const allOk = Object.values(checks).every((v) => v === 'ok');
    reply.code(allOk ? 200 : 503).send({
      status: allOk ? 'ok' : 'degraded',
      checks,
      timestamp: new Date().toISOString(),
    });
  });

  // Liveness vs readiness. /health gates traffic (503 pulls the instance out of
  // rotation when a dependency is down); /health/live only says the process is
  // up. Point Render's health check at /health; use /health/live for uptime
  // monitors that should not page on a transient Redis blip.
  app.get('/health/live', async (_req, reply) => {
    reply.code(200).send({ status: 'ok', timestamp: new Date().toISOString() });
  });
}
