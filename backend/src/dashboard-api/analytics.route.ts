import type { FastifyInstance } from 'fastify';
import { supabase } from '../db/index.js';
import { requirePermission } from '../middleware/index.js';
import type { JwtPayload } from '../types/index.js';

export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { clientId?: string; from?: string; to?: string } }>(
    '/analytics/overview',
    {
      preHandler: requirePermission('analytics:read'),
      handler: async (request, reply) => {
        const { from, to } = request.query;
        const user = request.user as JwtPayload;

        // A client-scoped user can ONLY ever see their own tenant's metrics.
        // Platform users may optionally filter by clientId (or see all when omitted).
        const clientId = user.clientId ?? request.query.clientId;

        const fromDate = from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const toDate = to ?? new Date().toISOString();

        let callQuery = supabase.from('calls').select('id, status, duration_seconds, client_id', { count: 'exact' })
          .gte('started_at', fromDate).lte('started_at', toDate);
        if (clientId) callQuery = callQuery.eq('client_id', clientId);
        const { data: calls, count: totalCalls } = await callQuery;

        let apptQuery = supabase.from('appointments').select('id, status, client_id', { count: 'exact' })
          .gte('created_at', fromDate).lte('created_at', toDate).eq('status', 'confirmed');
        if (clientId) apptQuery = apptQuery.eq('client_id', clientId);
        const { count: bookedAppts } = await apptQuery;

        let convQuery = supabase.from('conversations').select('id, lead_captured, client_id', { count: 'exact' })
          .gte('created_at', fromDate).lte('created_at', toDate).eq('lead_captured', true);
        if (clientId) convQuery = convQuery.eq('client_id', clientId);
        const { count: leadsCapured } = await convQuery;

        const avgDuration = calls?.reduce((acc, c) => acc + (c.duration_seconds ?? 0), 0) ?? 0;

        reply.send({
          period: { from: fromDate, to: toDate },
          totalCalls: totalCalls ?? 0,
          leadsCapured: leadsCapured ?? 0,
          appointmentsBooked: bookedAppts ?? 0,
          avgCallDurationSeconds: totalCalls ? Math.round(avgDuration / totalCalls) : 0,
          conversionRate: totalCalls
            ? ((leadsCapured ?? 0) / totalCalls * 100).toFixed(1)
            : '0',
        });
      },
    }
  );
}
