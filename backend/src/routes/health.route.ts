import type { FastifyInstance } from 'fastify';
import { supabase } from '../db/index.js';
import { redis } from '../queues/index.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_req, reply) => {
    const checks: Record<string, string> = {};

    try {
      await supabase.from('clients').select('id').limit(1);
      checks['database'] = 'ok';
    } catch {
      checks['database'] = 'error';
    }

    try {
      await redis.ping();
      checks['redis'] = 'ok';
    } catch {
      checks['redis'] = 'error';
    }

    const allOk = Object.values(checks).every((v) => v === 'ok');
    reply.code(allOk ? 200 : 503).send({
      status: allOk ? 'ok' : 'degraded',
      checks,
      timestamp: new Date().toISOString(),
    });
  });
}
