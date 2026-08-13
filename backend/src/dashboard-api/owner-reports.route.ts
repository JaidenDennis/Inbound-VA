import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../db/index.js';
import { requirePermission, assertClientAccess, resolveClientScope } from '../middleware/index.js';
import { logger } from '../utils/index.js';
import { buildExport, EXPORT_KINDS, type ExportKind } from '../services/export.service.js';
import { periodInsights } from '../ai/insights.service.js';
import { exportFilename } from '../utils/exportFilename.js';
import type { JwtPayload } from '../types/index.js';

/**
 * Owner analytics (migration 024).
 *
 * Clusters in the design's order: money, then candid failure data, then insight.
 *
 * TWO RULES THIS FILE ENFORCES, because they are the difference between a
 * dashboard a client trusts and one they catch out:
 *
 *   1. NULL SURVIVES. Every figure that is not measured reaches the client as
 *      `null`, never 0. The UI renders "not configured" / "not measured" for
 *      null and a number for a number. Coalescing here would turn "we don't
 *      know" into a claim.
 *   2. COVERAGE TRAVELS WITH THE FIGURE. Anything derived from migration-023
 *      signals ships `analyzed_calls` / `total_calls` beside it, because those
 *      signals start at re-provision and there is no backfill. A trend without
 *      its coverage reads as a collapse.
 */

const rangeSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  clientId: z.string().uuid().optional(),
});

const DEFAULT_WINDOW_DAYS = 30;

interface Range {
  clientId: string;
  from: string;
  to: string;
}

/**
 * Resolve tenant + window, or reply and return null.
 *
 * Owner analytics is always about ONE tenant: "revenue attributed to the agent"
 * summed across every client is not a figure anyone has a use for, and the
 * per-client timezone and hours make it meaningless anyway. Platform staff must
 * therefore name a client rather than getting the cross-tenant view they get
 * elsewhere.
 */
function resolveRange(
  request: { user: unknown; query: unknown },
  reply: { code: (n: number) => { send: (b: unknown) => void } }
): Range | null {
  const user = request.user as JwtPayload;
  const parsed = rangeSchema.safeParse(request.query);
  if (!parsed.success) {
    reply.code(400).send({ error: 'from/to must be ISO timestamps' });
    return null;
  }

  const clientId = resolveClientScope(user, parsed.data.clientId);
  if (!clientId) {
    reply.code(400).send({ error: 'clientId is required — owner analytics is per tenant' });
    return null;
  }
  if (!assertClientAccess(user, clientId)) {
    reply.code(403).send({ error: 'Forbidden' });
    return null;
  }

  const to = parsed.data.to ?? new Date().toISOString();
  const from =
    parsed.data.from ??
    new Date(Date.parse(to) - DEFAULT_WINDOW_DAYS * 86_400_000).toISOString();

  return { clientId, from, to };
}

/** Call a reporting function, returning [] on failure rather than a 500 cascade. */
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T[]> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    logger.error({ err: error, fn }, 'owner analytics rpc failed');
    throw new Error(`${fn} failed: ${error.message}`);
  }
  return (data ?? []) as T[];
}

const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

/**
 * Read a scalar-returning RPC.
 *
 * PostgREST returns a bare value for `RETURNS timestamptz`, but an array for
 * set-returning functions, and an empty array is TRUTHY — so a plain falsy check
 * silently treats "no go-live date" as "has one". That misreads a pre-launch
 * tenant as launched and sends it down the snapshot path.
 */
function scalar<T>(data: unknown): T | null {
  if (Array.isArray(data)) {
    const first = data[0];
    if (first === undefined) return null;
    // A set-returning function wrapping a single column yields [{col: value}].
    if (first !== null && typeof first === 'object') {
      const values = Object.values(first as Record<string, unknown>);
      return (values[0] ?? null) as T | null;
    }
    return (first ?? null) as T | null;
  }
  return (data ?? null) as T | null;
}

export async function ownerReportRoutes(app: FastifyInstance): Promise<void> {
  const rangeArgs = (r: Range) => ({
    p_client_id: r.clientId,
    p_from: r.from,
    p_to: r.to,
  });

  /** Money — the counterfactual. */
  app.get('/reports/money', {
    preHandler: requirePermission('analytics:read'),
    handler: async (request, reply) => {
      const range = resolveRange(request, reply);
      if (!range) return;

      const [row] = await rpc<Record<string, unknown>>('report_money', rangeArgs(range));
      if (!row) return reply.send({ range, data: null });

      const hoursConfigured = row.hours_configured === true;

      reply.send({
        range,
        data: {
          bookedAppointments: Number(row.booked_appointments ?? 0),
          // Labelled an estimate wherever it is shown: there are no invoices in
          // this system, so revenue is derived from service prices.
          attributedRevenue: numOrNull(row.attributed_revenue),
          revenueIsEstimate: true,
          // Named, not hidden. Dropping these under-reports revenue and
          // averaging them over-reports it; showing the count is what gets the
          // client to fix their service names.
          unmatchedAppointments: Number(row.unmatched_appointments ?? 0),
          // Null, not zero, when hours are unset — otherwise the headline
          // persuasion metric is invented for every tenant that never
          // configured them.
          afterHoursCalls: hoursConfigured ? Number(row.after_hours_calls ?? 0) : null,
          afterHoursBookings: hoursConfigured ? Number(row.after_hours_bookings ?? 0) : null,
          afterHoursRevenue: hoursConfigured ? numOrNull(row.after_hours_revenue) : null,
          hoursConfigured,
          recoveredCalls: Number(row.recovered_calls ?? 0),
          // Absent baseline ⇒ the cost card does not render, rather than
          // comparing against an assumed receptionist wage.
          monthlyCost: numOrNull(row.monthly_cost),
          costPerAppointment: numOrNull(row.cost_per_appointment),
        },
      });
    },
  });

  /** Trust — containment, escalation reasons, quality with its coverage. */
  app.get('/reports/trust', {
    preHandler: requirePermission('analytics:read'),
    handler: async (request, reply) => {
      const range = resolveRange(request, reply);
      if (!range) return;

      const [[row], escalations] = await Promise.all([
        rpc<Record<string, unknown>>('report_trust', rangeArgs(range)),
        rpc<{ reason: string; count: number }>('report_escalations', rangeArgs(range)),
      ]);

      const total = Number(row?.total_calls ?? 0);
      const transferred = Number(row?.transferred_calls ?? 0);

      reply.send({
        range,
        data: {
          totalCalls: total,
          transferredCalls: transferred,
          // A rate over zero calls is undefined, not 100%.
          containmentRate: total > 0 ? Math.round(((total - transferred) / total) * 1000) / 10 : null,
          flaggedCalls: Number(row?.flagged_calls ?? 0),
          avgQuality: numOrNull(row?.avg_quality),
          quality: {
            analyzedCalls: Number(row?.analyzed_calls ?? 0),
            totalCalls: total,
            // The claim is that every call is scored, unlike sampled human QA.
            // Shipping the percentage is what makes that claim checkable.
            coveragePercent: total > 0
              ? Math.round((Number(row?.analyzed_calls ?? 0) / total) * 1000) / 10
              : null,
          },
          escalationsByReason: escalations.map((e) => ({
            reason: e.reason,
            count: Number(e.count),
          })),
        },
      });
    },
  });

  /** Demand intelligence — the differentiator, and the most coverage-dependent. */
  app.get('/reports/demand', {
    preHandler: requirePermission('analytics:read'),
    handler: async (request, reply) => {
      const range = resolveRange(request, reply);
      if (!range) return;

      const [reasons, referrals, lost, peaks, [trust]] = await Promise.all([
        rpc<{ reason: string; count: number }>('report_call_reasons', rangeArgs(range)),
        rpc<{ source: string; count: number }>('report_referrals', rangeArgs(range)),
        rpc<Record<string, unknown>>('report_lost_demand', rangeArgs(range)),
        rpc<{ dow: number; hour: number; count: number }>('report_peak_times', rangeArgs(range)),
        rpc<Record<string, unknown>>('report_trust', rangeArgs(range)),
      ]);

      const { data: gaps } = await supabase
        .from('knowledge_gaps')
        .select('id, question, occurrences, last_seen_at')
        .eq('client_id', range.clientId)
        .is('resolved_at', null)
        .order('occurrences', { ascending: false })
        .limit(20);

      reply.send({
        range,
        // Every figure below comes from signals that start at the agent's next
        // re-provision. Without this block a client reads an empty demand list
        // as "nobody asked us anything".
        coverage: {
          totalCalls: Number(trust?.total_calls ?? 0),
          callsWithSignals: reasons.reduce((n, r) => n + Number(r.count), 0),
        },
        data: {
          callReasons: reasons.map((r) => ({ reason: r.reason, count: Number(r.count) })),
          referralSources: referrals.map((r) => ({ source: r.source, count: Number(r.count) })),
          lostDemand: lost.map((r) => ({
            service: r.service as string,
            requests: Number(r.requests),
            unitPrice: numOrNull(r.unit_price),
            // Null where the service is not priced. A dollar figure on a
            // service the business does not sell would be invented.
            estimatedValue: numOrNull(r.estimated_value),
          })),
          peakTimes: peaks.map((p) => ({
            dow: Number(p.dow),
            hour: Number(p.hour),
            count: Number(p.count),
          })),
          knowledgeGaps: (gaps ?? []).map((g: Record<string, unknown>) => ({
            id: g.id as string,
            question: g.question as string,
            occurrences: Number(g.occurrences),
            lastSeenAt: g.last_seen_at as string,
          })),
        },
      });
    },
  });

  /** Follow-through — captured → contacted → booked. */
  app.get('/reports/funnel', {
    preHandler: requirePermission('analytics:read'),
    handler: async (request, reply) => {
      const range = resolveRange(request, reply);
      if (!range) return;

      const [row] = await rpc<Record<string, unknown>>('report_funnel', rangeArgs(range));
      reply.send({
        range,
        data: {
          captured: Number(row?.captured ?? 0),
          contacted: Number(row?.contacted ?? 0),
          booked: Number(row?.booked ?? 0),
          // "Contacted" has no explicit state in the schema; it is inferred from
          // a contact having more than one conversation. Flagged so nobody later
          // mistakes it for a measured stage.
          contactedIsInferred: true,
        },
      });
    },
  });

  /**
   * Cumulative ROI since go-live. Never windowed.
   *
   * Returns null for a pre-go-live client rather than zeros: "the agent has not
   * launched" and "the agent earned nothing" are different statements.
   */
  app.get('/reports/roi', {
    preHandler: requirePermission('analytics:read'),
    handler: async (request, reply) => {
      const range = resolveRange(request, reply);
      if (!range) return;

      const { data: goLiveRaw } = await supabase.rpc('client_go_live_at', {
        p_client_id: range.clientId,
      });
      const goLive = scalar<string>(goLiveRaw);

      if (!goLive) {
        return reply.send({
          data: null,
          reason: 'not_live',
          detail: 'Cumulative ROI starts at go-live. Mark the go_live onboarding milestone complete to begin the series.',
        });
      }

      const { data: snapshot } = await supabase
        .from('client_roi_snapshots')
        .select('as_of, since, booked_appointments, attributed_revenue, after_hours_revenue, recovered_calls, total_cost')
        .eq('client_id', range.clientId)
        .order('as_of', { ascending: false })
        .limit(1)
        .maybeSingle();

      const row = snapshot as Record<string, unknown> | null;
      if (!row) {
        return reply.send({
          data: null,
          reason: 'no_snapshot',
          detail: 'The nightly ROI snapshot has not run yet for this client.',
        });
      }

      const revenue = Number(row.attributed_revenue ?? 0);
      const cost = numOrNull(row.total_cost);

      reply.send({
        data: {
          since: row.since as string,
          asOf: row.as_of as string,
          bookedAppointments: Number(row.booked_appointments ?? 0),
          attributedRevenue: revenue,
          afterHoursRevenue: Number(row.after_hours_revenue ?? 0),
          recoveredCalls: Number(row.recovered_calls ?? 0),
          totalCost: cost,
          // Null rather than infinity when no baseline is configured.
          netReturn: cost === null ? null : Math.round((revenue - cost) * 100) / 100,
          revenueIsEstimate: true,
        },
      });
    },
  });

  /** Onboarding readiness — shown while go_live is incomplete or recent. */
  app.get('/reports/readiness', {
    preHandler: requirePermission('analytics:read'),
    handler: async (request, reply) => {
      const range = resolveRange(request, reply);
      if (!range) return;

      const [items, { data: goLiveRaw }] = await Promise.all([
        rpc<{ item: string; done: boolean; detail: string }>('report_readiness', {
          p_client_id: range.clientId,
        }),
        supabase.rpc('client_go_live_at', { p_client_id: range.clientId }),
      ]);

      const goLive = scalar<string>(goLiveRaw);
      const done = items.filter((i) => i.done).length;
      const liveFor = goLive ? Date.now() - Date.parse(goLive) : null;

      reply.send({
        data: {
          items,
          done,
          total: items.length,
          // Retired from the owner view 30 days after launch, per the design.
          // Kept in the payload so staff can still see it.
          showToOwner: liveFor === null || liveFor < 30 * 86_400_000,
        },
      });
    },
  });

  /**
   * What changed, with the calls that prove it.
   *
   * Every insight carries the ids of calls that evidence it, and the service
   * drops any it cannot trace to a real call in the period — see
   * insights.service.ts. The UI renders no insight without a working
   * click-through, so an untraceable claim never reaches a screen.
   */
  app.get('/reports/insights', {
    preHandler: requirePermission('analytics:read'),
    handler: async (request, reply) => {
      const range = resolveRange(request, reply);
      if (!range) return;

      reply.send(await periodInsights(range.clientId, range.from, range.to));
    },
  });

  /**
   * CSV of one cluster, generated here rather than in the browser.
   *
   * `exports:read` rather than `analytics:read`: a file that leaves the building
   * is a different act from looking at a chart, and `client_viewer` holds the
   * export grant precisely so a compliance reader can take the numbers away
   * without being able to open a transcript.
   */
  app.get<{ Params: { kind: string } }>('/reports/export/:kind', {
    preHandler: requirePermission('exports:read'),
    handler: async (request, reply) => {
      const range = resolveRange(request, reply);
      if (!range) return;

      const kind = request.params.kind as ExportKind;
      if (!EXPORT_KINDS.includes(kind)) {
        return reply.code(400).send({ error: `Unknown export: ${request.params.kind}` });
      }

      try {
        const result = await buildExport(kind, range);
        const stamp = range.to.slice(0, 10);

        // Named for the business, not the vendor: the file lands beside
        // exports from every other tool, and "which of my clients is this?"
        // is the question the operator actually has. The dashboard sets
        // `link.download` from the same helper — the two must agree.
        const { data: client } = await supabase
          .from('clients')
          .select('name')
          .eq('id', range.clientId)
          .maybeSingle();
        const filename = exportFilename((client as { name?: string } | null)?.name, result.filename, stamp);

        reply
          .header('content-type', 'text/csv; charset=utf-8')
          .header('content-disposition', `attachment; filename="${filename}"`)
          // Surfaced so a client can tell an empty export from a failed one
          // without opening the file.
          .header('x-row-count', String(result.rowCount))
          .send(result.csv);
      } catch (err) {
        logger.error({ err, kind }, 'export failed');
        reply.code(500).send({ error: 'Could not build that export' });
      }
    },
  });
}
