import { getClaude, AI_MODEL, AI_EFFORT, isAiConfigured } from './claude.client.js';
import { supabase } from '../db/index.js';
import { logger } from '../utils/index.js';

/**
 * The post-call scoring pass (migration 023).
 *
 * Distinct from `call-intelligence.service.ts`, which produces prose for a human
 * reading ONE call on demand. This runs on EVERY call, unattended, and writes
 * numbers that get averaged into a trend on the owner's dashboard.
 *
 * The product claim it backs is coverage: human QA samples a small fraction of
 * calls, this scores all of them. That claim is only worth making if the
 * coverage figure is real, which is why `analyzed_at` is stamped and surfaced
 * rather than inferred.
 *
 * Three judgements the model makes that Retell cannot:
 *   - quality, on three axes, because "was the call good" is not one question
 *   - frustration and dead air, which need tone and flow rather than keywords
 *   - which questions the knowledge base failed to answer, which requires
 *     knowing whether an answer was actually given, not just what was asked
 */

/** Reasons a call gets pulled into the manager's flagged queue. */
export const FLAG_REASONS = [
  'caller_frustrated',
  'dead_air',
  'repeated_clarification',
  'caller_hung_up',
  'unanswered_question',
  'wrong_information',
] as const;

export type FlagReason = (typeof FLAG_REASONS)[number];

const QUALITY_SCHEMA = {
  type: 'object',
  properties: {
    accuracy: { type: 'number' },
    resolution: { type: 'number' },
    tone: { type: 'number' },
    flag_reasons: { type: 'array', items: { type: 'string', enum: FLAG_REASONS } },
    unanswered_questions: { type: 'array', items: { type: 'string' } },
  },
  required: ['accuracy', 'resolution', 'tone', 'flag_reasons', 'unanswered_questions'],
  additionalProperties: false,
} as const;

export interface CallQuality {
  accuracy: number;
  resolution: number;
  tone: number;
  /** Mean of the three axes, one decimal. */
  score: number;
  flagReasons: FlagReason[];
  unansweredQuestions: string[];
}

/**
 * Group questions that differ only in punctuation, case, filler or plurals.
 *
 * "Do you take Delta?" and "do you take delta" are one gap asked twice, and the
 * whole value of the gap list is that it is a work queue rather than a
 * transcript search. This is the same normalise-then-group move migration 017
 * makes for error fingerprints.
 */
export function normalizeQuestion(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    // Leading filler carries no meaning and splits otherwise-identical questions.
    .replace(/^(so|um|uh|hi|hey|hello|and|well|ok|okay)\s+/g, '')
    .replace(/\b(do|does|did|can|could|would|will|is|are|the|a|an|you|your|guys|please)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clampScore(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  // Out of range is a prompt bug, not a value to salvage. Returning null keeps
  // it out of the average instead of burying a 47 as a plausible 10.
  if (v < 0 || v > 10) return null;
  return Math.round(v * 10) / 10;
}

/**
 * Score one call and return the result, without writing anything.
 *
 * Returns null when there is nothing to score — no transcript, AI not
 * configured, or a malformed response. Null means "not measured" and the caller
 * must leave `analyzed_at` unset rather than recording zeros.
 */
export async function scoreCall(callId: string): Promise<CallQuality | null> {
  if (!isAiConfigured()) return null;

  const { data: transcriptRow } = await supabase
    .from('call_transcripts')
    .select('transcript')
    .eq('call_id', callId)
    .maybeSingle();

  const transcript = (transcriptRow as { transcript?: string } | null)?.transcript;
  // Without a transcript there is nothing to score. A score derived from
  // metadata alone would be invention with a decimal point on it.
  if (!transcript?.trim()) return null;

  const claude = getClaude();
  const response = await claude.messages.create({
    model: AI_MODEL,
    max_tokens: 1500,
    output_config: { effort: AI_EFFORT, format: { type: 'json_schema', schema: QUALITY_SCHEMA } },
    system: `You score transcripts of calls handled by an AI phone agent for a local business. Your scores are averaged into a trend the business owner reads, so they must be consistent between calls rather than generous or harsh.

Score three axes from 0 to 10:
- accuracy: was everything the agent stated correct and consistent? Deduct for contradictions, invented facts, or wrong details. A call where the agent correctly said "I don't know" scores HIGH on accuracy.
- resolution: did the caller get what they rang for? A correct transfer counts as resolved. An unanswered question does not.
- tone: was the agent natural, warm and appropriately brief? Deduct for robotic repetition, talking over the caller, or excessive length.

Flag reasons — include only what the transcript actually shows:
- caller_frustrated: audible irritation, repetition out of exasperation, complaints about the agent
- dead_air: long unexplained pauses, or the agent failing to respond
- repeated_clarification: the agent asked for the same information more than once
- caller_hung_up: the caller ended the call mid-flow, before resolution
- unanswered_question: the caller asked something the agent could not answer
- wrong_information: the agent stated something incorrect or self-contradictory

unanswered_questions: the specific questions the agent could not answer, phrased as the CALLER asked them. Empty if none. Do not include questions the agent answered, and do not include the caller's own details.

A call that went fine scores well and carries no flags. Do not manufacture problems to look thorough.`,
    messages: [{ role: 'user', content: `Transcript:\n${transcript.slice(0, 40000)}` }],
  });

  const block = response.content.find(
    (b): b is { type: 'text'; text: string; citations: null } => b.type === 'text'
  );
  if (!block) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(block.text) as Record<string, unknown>;
  } catch {
    logger.warn({ callId }, 'call quality pass returned unparseable JSON');
    return null;
  }

  const accuracy = clampScore(parsed.accuracy);
  const resolution = clampScore(parsed.resolution);
  const tone = clampScore(parsed.tone);
  // All three or none: a mean over a partial set is not comparable with a mean
  // over a full one, and these get averaged across calls.
  if (accuracy === null || resolution === null || tone === null) {
    logger.warn({ callId, parsed }, 'call quality pass returned out-of-range scores');
    return null;
  }

  const rawFlags = Array.isArray(parsed.flag_reasons) ? parsed.flag_reasons : [];
  const flagReasons = [
    ...new Set(rawFlags.filter((r): r is FlagReason => (FLAG_REASONS as readonly unknown[]).includes(r))),
  ];

  const rawQuestions = Array.isArray(parsed.unanswered_questions) ? parsed.unanswered_questions : [];
  const unansweredQuestions = rawQuestions
    .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
    .map((q) => q.trim().slice(0, 500))
    .slice(0, 10);

  return {
    accuracy,
    resolution,
    tone,
    score: Math.round(((accuracy + resolution + tone) / 3) * 10) / 10,
    flagReasons,
    unansweredQuestions,
  };
}

/**
 * Score a call and persist the result.
 *
 * Idempotent by `analyzed_at`: the provider retries webhooks, and a second run
 * would mean a second model call and a double-counted knowledge gap. Pass
 * `force` to re-score deliberately.
 */
export async function analyzeAndStore(
  callId: string,
  options: { force?: boolean } = {}
): Promise<CallQuality | null> {
  const { data: call } = await supabase
    .from('calls')
    .select('id, client_id, retell_call_id')
    .eq('id', callId)
    .maybeSingle();

  const row = call as { id: string; client_id: string; retell_call_id: string | null } | null;
  if (!row?.retell_call_id) {
    logger.warn({ callId }, 'call has no retell_call_id — cannot attach quality scores');
    return null;
  }

  if (!options.force) {
    const { data: existing } = await supabase
      .from('call_records')
      .select('analyzed_at')
      .eq('retell_call_id', row.retell_call_id)
      .maybeSingle();
    if ((existing as { analyzed_at?: string | null } | null)?.analyzed_at) return null;
  }

  const quality = await scoreCall(callId);
  // Leave analyzed_at unset. The call stays in the backlog and counts against
  // coverage, which is the truthful outcome — pretending it was analysed would
  // inflate the one number that makes the coverage claim checkable.
  if (!quality) return null;

  const { error } = await supabase
    .from('call_records')
    .update({
      quality_score: quality.score,
      quality_accuracy: quality.accuracy,
      quality_resolution: quality.resolution,
      quality_tone: quality.tone,
      flagged: quality.flagReasons.length > 0,
      flag_reasons: quality.flagReasons,
      analyzed_at: new Date().toISOString(),
    })
    .eq('retell_call_id', row.retell_call_id);

  if (error) {
    logger.error({ err: error, callId }, 'failed to persist call quality');
    return null;
  }

  // Knowledge gaps are recorded through the SQL function so the
  // insert-or-increment is atomic — two workers analysing two calls that asked
  // the same question must not race into a duplicate or a lost count.
  for (const question of quality.unansweredQuestions) {
    const normalized = normalizeQuestion(question);
    if (!normalized) continue;
    const { error: gapError } = await supabase.rpc('record_knowledge_gap', {
      p_client_id: row.client_id,
      p_call_id: row.id,
      p_question: question,
      p_normalized: normalized,
    });
    if (gapError) logger.error({ err: gapError, callId }, 'failed to record knowledge gap');
  }

  return quality;
}
