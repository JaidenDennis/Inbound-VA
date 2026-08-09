import { getClaude, AI_MODEL, AI_EFFORT, isAiConfigured } from './claude.client.js';
import { supabase } from '../db/index.js';
import { logger } from '../utils/index.js';

/**
 * Period insight — what CHANGED, with the calls that prove it.
 *
 * Two rules from the spec are enforced here rather than asked for in a prompt,
 * because a prompt is a request and this needs to be a guarantee:
 *
 * 1. EVERY CLAIM IS TRACEABLE. Each insight carries `callIds`, and an insight
 *    whose ids do not resolve to real calls in the period is DROPPED by this
 *    service — not rendered without its link, and not rendered with a broken
 *    one. Untraceable insight is decoration, and decoration that looks like
 *    analysis is worse than nothing.
 *
 *    Note what the check is: not "the array is non-empty" but "these ids were in
 *    the candidate set we supplied". A model that invents a plausible UUID
 *    passes the first test and fails this one.
 *
 * 2. ANOMALY DETECTION, NOT SUMMARISATION. The model is given period-over-period
 *    deltas, never raw totals alone. An owner can read a chart; what they cannot
 *    do is notice that containment fell 14 points while volume held steady. Output
 *    that restates a figure already on screen is a prompt failure, and
 *    `insights.test.ts` asserts against it.
 */

const INSIGHT_SCHEMA = {
  type: 'object',
  properties: {
    insights: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          headline: { type: 'string' },
          detail: { type: 'string' },
          severity: { type: 'string', enum: ['watch', 'act'] },
          call_ids: { type: 'array', items: { type: 'string' } },
        },
        required: ['headline', 'detail', 'severity', 'call_ids'],
        additionalProperties: false,
      },
    },
  },
  required: ['insights'],
  additionalProperties: false,
} as const;

export interface Insight {
  headline: string;
  detail: string;
  severity: 'watch' | 'act';
  /** Calls that evidence the claim. Never empty — see `takeTraceable`. */
  callIds: string[];
}

export interface InsightResult {
  insights: Insight[];
  /** How many the model produced that could not be traced, and were dropped. */
  dropped: number;
  period: { from: string; to: string };
  /** Absent evidence is reported as such rather than as "nothing is wrong". */
  reason?: 'not_configured' | 'no_calls' | 'unavailable';
}

interface CandidateCall {
  id: string;
  booked: boolean;
  sentiment: string | null;
  escalation: string | null;
  flagged: boolean;
  reason: string | null;
  quality: number | null;
  startedAt: string;
}

/**
 * Compact per-call facts the model may cite. Bounded so the prompt stays small.
 *
 * `call_records.id` is deliberately the citation key: it is what
 * `client_call_log.id` exposes, so every id the model returns is one the UI can
 * link straight to `/reports/calls/:id` without a second lookup. A traceability
 * rule whose links need translating is one that breaks the first time the
 * translation is forgotten.
 */
async function candidates(clientId: string, from: string, to: string): Promise<CandidateCall[]> {
  const { data } = await supabase
    .from('call_records')
    .select(
      'id, appointment_booked, user_sentiment, escalation_reason, flagged, flag_reasons, call_reason, quality_score, started_at'
    )
    .eq('client_id', clientId)
    .gte('started_at', from)
    .lte('started_at', to)
    .order('started_at', { ascending: false })
    .limit(200);

  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    booked: r.appointment_booked === true,
    sentiment: (r.user_sentiment as string) ?? null,
    escalation: (r.escalation_reason as string) ?? null,
    flagged: r.flagged === true || (Array.isArray(r.flag_reasons) && r.flag_reasons.length > 0),
    reason: (r.call_reason as string) ?? null,
    quality: r.quality_score === null || r.quality_score === undefined ? null : Number(r.quality_score),
    startedAt: String(r.started_at),
  }));
}

interface Deltas {
  label: string;
  now: number | null;
  before: number | null;
}

/**
 * The same figures the owner view shows, for this period and the one before it.
 *
 * Both periods are the same length, so a 30-day window is compared against the
 * 30 days before it rather than against a calendar month of a different size.
 */
async function deltas(clientId: string, from: string, to: string): Promise<Deltas[]> {
  const span = Date.parse(to) - Date.parse(from);
  const prevFrom = new Date(Date.parse(from) - span).toISOString();

  const call = async (fn: string, f: string, t: string) => {
    const { data, error } = await supabase.rpc(fn, { p_client_id: clientId, p_from: f, p_to: t });
    if (error) throw new Error(`${fn}: ${error.message}`);
    return ((data ?? []) as Array<Record<string, unknown>>)[0] ?? {};
  };

  const [trustNow, trustBefore, moneyNow, moneyBefore] = await Promise.all([
    call('report_trust', from, to),
    call('report_trust', prevFrom, from),
    call('report_money', from, to),
    call('report_money', prevFrom, from),
  ]);

  const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
  const rate = (row: Record<string, unknown>): number | null => {
    const total = Number(row.total_calls ?? 0);
    if (total === 0) return null;
    return Math.round(((total - Number(row.transferred_calls ?? 0)) / total) * 1000) / 10;
  };

  return [
    { label: 'Calls', now: num(trustNow.total_calls), before: num(trustBefore.total_calls) },
    { label: 'Containment rate (%)', now: rate(trustNow), before: rate(trustBefore) },
    { label: 'Transferred to a person', now: num(trustNow.transferred_calls), before: num(trustBefore.transferred_calls) },
    { label: 'Flagged calls', now: num(trustNow.flagged_calls), before: num(trustBefore.flagged_calls) },
    { label: 'Average quality score', now: num(trustNow.avg_quality), before: num(trustBefore.avg_quality) },
    { label: 'Appointments booked', now: num(moneyNow.booked_appointments), before: num(moneyBefore.booked_appointments) },
    { label: 'Attributed revenue', now: num(moneyNow.attributed_revenue), before: num(moneyBefore.attributed_revenue) },
    { label: 'Missed calls recovered', now: num(moneyNow.recovered_calls), before: num(moneyBefore.recovered_calls) },
  ];
}

/**
 * Keep only insights whose citations resolve to calls in the candidate set.
 *
 * Exported because this is the rule, and a rule worth stating is worth testing
 * directly rather than through a live model call.
 */
export function takeTraceable(
  raw: Array<{ headline: string; detail: string; severity: string; call_ids: string[] }>,
  validIds: Set<string>
): { insights: Insight[]; dropped: number } {
  const insights: Insight[] = [];
  let dropped = 0;

  for (const item of raw) {
    // Intersect rather than reject-on-any-bad-id: an insight citing four real
    // calls and one hallucinated one is still a true observation about the four,
    // and the click-through must only ever offer the real ones.
    const callIds = [...new Set(item.call_ids)].filter((id) => validIds.has(id));

    if (callIds.length === 0) {
      dropped += 1;
      continue;
    }

    insights.push({
      headline: item.headline,
      detail: item.detail,
      severity: item.severity === 'act' ? 'act' : 'watch',
      callIds,
    });
  }

  return { insights, dropped };
}

export async function periodInsights(
  clientId: string,
  from: string,
  to: string
): Promise<InsightResult> {
  const period = { from, to };

  if (!isAiConfigured()) {
    return { insights: [], dropped: 0, period, reason: 'not_configured' };
  }

  const [calls, movement] = await Promise.all([
    candidates(clientId, from, to),
    deltas(clientId, from, to),
  ]);

  if (calls.length === 0) {
    return { insights: [], dropped: 0, period, reason: 'no_calls' };
  }

  const validIds = new Set(calls.map((c) => c.id));

  try {
    const claude = getClaude();
    const response = await claude.messages.create({
      model: AI_MODEL,
      max_tokens: 2000,
      output_config: { effort: AI_EFFORT, format: { type: 'json_schema', schema: INSIGHT_SCHEMA } },
      system: `You review a period of AI-handled phone calls for a local business and report what CHANGED. You are writing for the owner.

Rules:
- Report deviation, not description. The owner is already looking at these numbers. "You had 41 calls" is worthless; "containment fell 14 points while call volume held steady" is the job.
- If nothing moved meaningfully, return an empty list. Do not manufacture an observation to fill space.
- Every insight MUST cite the specific call ids that evidence it, taken from the list provided. An insight you cannot evidence with real calls will be discarded, so do not guess ids or cite calls that do not support the point.
- "act" means it needs a decision this week. "watch" means note it. Most things are watch.
- Plain language, no jargon, no percentages you have not been given.`,
      messages: [
        {
          role: 'user',
          content: `Period: ${from} to ${to}, compared against the equally long period before it.

Movement (null means not measured, which is not the same as zero):
${movement
  .map((d) => `- ${d.label}: ${d.now ?? 'not measured'} (was ${d.before ?? 'not measured'})`)
  .join('\n')}

Calls in this period you may cite:
${calls
  .map(
    (c) =>
      `${c.id} | ${c.startedAt} | sentiment=${c.sentiment ?? 'unknown'}` +
      `${c.booked ? ' | booked' : ''}${c.flagged ? ' | flagged' : ''}` +
      `${c.escalation ? ` | escalated=${c.escalation}` : ''}` +
      `${c.reason ? ` | reason=${c.reason}` : ''}` +
      `${c.quality === null ? '' : ` | quality=${c.quality}`}`
  )
  .join('\n')}`,
        },
      ],
    });

    const block = response.content.find(
      (b): b is { type: 'text'; text: string; citations: null } => b.type === 'text'
    );
    if (!block) return { insights: [], dropped: 0, period, reason: 'unavailable' };

    const parsed = JSON.parse(block.text) as {
      insights: Array<{ headline: string; detail: string; severity: string; call_ids: string[] }>;
    };

    const { insights, dropped } = takeTraceable(parsed.insights ?? [], validIds);
    if (dropped > 0) {
      // Worth a log line: a model dropping citations consistently is a prompt
      // regression, and it would otherwise show only as a quieter page.
      logger.warn({ clientId, dropped }, 'insights dropped for untraceable citations');
    }

    return { insights, dropped, period };
  } catch (err) {
    logger.error({ err, clientId }, 'period insights failed');
    return { insights: [], dropped: 0, period, reason: 'unavailable' };
  }
}
