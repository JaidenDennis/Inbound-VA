import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { buildCorsOptions, CORS_METHODS } from '../config/cors.js';

/**
 * The dashboard could not save anything that used PUT, PATCH or DELETE.
 *
 * `@fastify/cors` defaults `methods` to `GET,HEAD,POST` when the option is
 * omitted, and app.ts registered it with only `origin` and `credentials`. So
 * the browser's preflight for a PUT came back
 *
 *     access-control-allow-methods: GET,HEAD,POST
 *
 * and the real request was never sent. Reads worked, creates worked, and every
 * update and delete failed with a generic toast — no server log, no
 * system_errors row, because nothing reached a route handler.
 *
 * These tests drive a real preflight through the real plugin rather than
 * asserting on the options object, because the bug was precisely that the
 * options object looked fine and the PLUGIN's default filled the gap.
 */

const ORIGIN = 'https://inbound-va-dashboard.onrender.com';

async function preflight(method: string) {
  const app = Fastify();
  await app.register(cors, buildCorsOptions([ORIGIN]));
  // A route must exist for the verb, or the preflight answer is moot.
  app.route({ method: method as 'PUT', url: '/thing', handler: async () => ({ ok: true }) });
  await app.ready();

  const res = await app.inject({
    method: 'OPTIONS',
    url: '/thing',
    headers: {
      origin: ORIGIN,
      'access-control-request-method': method,
      'access-control-request-headers': 'authorization,content-type',
    },
  });
  await app.close();
  return res;
}

describe('CORS allows the methods the dashboard actually uses', () => {
  it.each(['PUT', 'PATCH', 'DELETE'])(
    'permits %s at the preflight — the regression that blocked every save',
    async (method) => {
      const res = await preflight(method);
      const allowed = String(res.headers['access-control-allow-methods'] ?? '');

      expect(res.statusCode).toBeLessThan(300);
      expect(allowed).toContain(method);
      expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    }
  );

  it('still permits the reads and creates that always worked', async () => {
    const res = await preflight('POST');
    expect(String(res.headers['access-control-allow-methods'])).toContain('POST');
  });

  it('does not reflect an origin that is not on the allow-list', async () => {
    const app = Fastify();
    await app.register(cors, buildCorsOptions([ORIGIN]));
    app.route({ method: 'PATCH', url: '/thing', handler: async () => ({ ok: true }) });
    await app.ready();

    const res = await app.inject({
      method: 'OPTIONS',
      url: '/thing',
      headers: { origin: 'https://evil.example.com', 'access-control-request-method': 'PATCH' },
    });
    await app.close();

    // Widening the method list must not have widened WHO may use it.
    expect(res.headers['access-control-allow-origin']).not.toBe('https://evil.example.com');
  });

  it('lists every verb the dashboard can issue', () => {
    // Named explicitly so dropping one is a deliberate, visible act.
    for (const verb of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      expect(CORS_METHODS).toContain(verb);
    }
  });
});

/**
 * The same failure one layer over: a response header the browser will not hand
 * to JavaScript unless it is named in `access-control-expose-headers`.
 *
 * Only a short safelist (content-type, cache-control and a few others) is
 * readable by default. `x-row-count` was added to the export route "so a client
 * can tell an empty export from a failed one", and `content-disposition`
 * carries the filename — both were invisible to the dashboard, silently, with
 * the server logging a perfectly good response.
 */
describe('CORS exposes the response headers the dashboard has to read', () => {
  async function actual() {
    const app = Fastify();
    await app.register(cors, buildCorsOptions([ORIGIN]));
    app.get('/export', async (_req, reply) =>
      reply
        .header('content-disposition', 'attachment; filename="acme-money-2026-08-13.csv"')
        .header('x-row-count', '42')
        .send('a,b\n1,2\n')
    );
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/export', headers: { origin: ORIGIN } });
    await app.close();
    return res;
  }

  it.each(['content-disposition', 'x-row-count'])('exposes %s', async (header) => {
    const res = await actual();
    const exposed = String(res.headers['access-control-expose-headers'] ?? '').toLowerCase();
    expect(exposed).toContain(header);
  });

  it('names them on the options object too, so the list is greppable', () => {
    const opts = buildCorsOptions([ORIGIN]);
    expect(opts.exposedHeaders).toContain('content-disposition');
    expect(opts.exposedHeaders).toContain('x-row-count');
  });
});
