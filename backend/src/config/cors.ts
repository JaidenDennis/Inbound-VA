import type { FastifyCorsOptions } from '@fastify/cors';

/**
 * HTTP methods the browser is allowed to use against this API.
 *
 * This list is NOT decoration. `@fastify/cors` defaults `methods` to
 * `GET,HEAD,POST` when the option is omitted, and the API was registered
 * without it — so every PUT, PATCH and DELETE issued by the dashboard was
 * rejected at the CORS preflight and never reached a route handler.
 *
 * The failure mode was maximally confusing: reads worked (GET needs no
 * preflight), creates worked (POST is in the default list), and only
 * updates and deletes failed — with a generic "could not save" in the UI,
 * nothing in the server logs, and nothing in `system_errors`, because a
 * blocked preflight means the real request is never sent at all.
 *
 * Anything the dashboard can do must appear here.
 */
export const CORS_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;

/**
 * Response headers the browser will hand to JavaScript.
 *
 * The same trap as `methods`, one layer over. A cross-origin response only
 * exposes a short safelist (content-type, cache-control, expires, pragma,
 * last-modified) unless the server names more here. Everything else is
 * readable by the browser, present in devtools, and `undefined` in JS — so the
 * server logs a perfectly good response and the client behaves as though the
 * header were never sent.
 *
 * `content-disposition` carries the export filename, and the dashboard needs
 * it to name the file it saves. `x-row-count` was added to the export route so
 * a client could tell an empty export from a failed one — and could not,
 * because of this.
 *
 * Anything the dashboard has to READ off a response must appear here.
 */
export const CORS_EXPOSED_HEADERS = ['content-disposition', 'x-row-count'] as const;

/**
 * CORS options for the API.
 *
 * `origin` is the caller's decision: the allow-list in production, `true`
 * (reflect anything) in development.
 */
export function buildCorsOptions(origin: FastifyCorsOptions['origin']): FastifyCorsOptions {
  return {
    origin,
    credentials: true,
    methods: [...CORS_METHODS],
    exposedHeaders: [...CORS_EXPOSED_HEADERS],
  };
}
