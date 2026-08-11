import type { FastifyError, FastifyRequest } from 'fastify';
import { systemErrorService, fingerprintFor } from '../services/systemError.service.js';
import { systemAlertService } from '../services/systemAlert.service.js';

/**
 * Record a 5xx in `system_errors`, tagged with the tenant when the request
 * carried one. The client is taken from the verified JWT first and only then
 * from the URL/body, so a caller cannot mislabel someone else's error.
 *
 * Pulled out of app.ts so it can be exercised directly in tests without
 * standing up the full Fastify app (every route, redis, rate-limit, etc.).
 */
export async function recordRequestError(
  request: FastifyRequest,
  error: FastifyError,
  status: number,
  sentryEventId: string | null
): Promise<void> {
  const jwtUser = (request as { jwtUser?: { clientId?: string | null } }).jwtUser;
  const params = (request.params ?? {}) as Record<string, string>;
  const query = (request.query ?? {}) as Record<string, string>;
  const clientId = jwtUser?.clientId ?? query.clientId ?? params.clientId ?? null;

  const fault = {
    source: 'api' as const,
    severity: status >= 500 ? ('error' as const) : ('warn' as const),
    clientId,
    requestId: request.id,
    // routerPath is the pattern ("/clients/:id"), so every id hits one
    // fingerprint instead of one per record.
    route: request.routeOptions?.url ?? request.url,
    method: request.method,
    statusCode: status,
    error,
    context: { query, params },
    sentryEventId,
  };

  await systemErrorService.record(fault);
  await systemAlertService.maybeOpenTicket({
    fingerprint: fingerprintFor({
      source: 'api',
      errorName: error.name || 'Error',
      route: fault.route,
      message: error.message ?? '',
    }),
    clientId,
    title: `${request.method} ${fault.route}`,
    detail: error.message ?? 'Request failed',
  });
}
