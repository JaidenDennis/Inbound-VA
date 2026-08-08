import { getClaude, AI_MODEL, AI_EFFORT } from './claude.client.js';
import { supabase } from '../db/index.js';

/**
 * Per-call analysis: what happened, how it went, and what to change.
 *
 * Retell already returns a summary; this is the layer above it — sentiment, the
 * specific moment a call went wrong, and whether the fix belongs in the
 * knowledge base or the agent's configuration. That last judgement is the point:
 * "the agent didn't know our parking situation" is actionable, "call quality was
 * poor" is not.
 */

const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    caller_intent: { type: 'string' },
    outcome: {
      type: 'string',
      enum: ['resolved', 'booked', 'lead_captured', 'transferred', 'abandoned', 'unresolved'],
    },
    sentiment: { type: 'string', enum: ['positive', 'neutral', 'frustrated', 'angry'] },
    went_well: { type: 'array', items: { type: 'string' } },
    went_wrong: { type: 'array', items: { type: 'string' } },
    suggested_fixes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          fix: { type: 'string' },
          where: { type: 'string', enum: ['knowledge', 'agent_config', 'staff_followup', 'none'] },
        },
        required: ['fix', 'where'],
        additionalProperties: false,
      },
    },
    needs_human_followup: { type: 'boolean' },
  },
  required: [
    'summary',
    'caller_intent',
    'outcome',
    'sentiment',
    'went_well',
    'went_wrong',
    'suggested_fixes',
    'needs_human_followup',
  ],
  additionalProperties: false,
} as const;

export interface CallAnalysis {
  summary: string;
  caller_intent: string;
  outcome: string;
  sentiment: string;
  went_well: string[];
  went_wrong: string[];
  suggested_fixes: Array<{ fix: string; where: string }>;
  needs_human_followup: boolean;
}

export async function analyzeCall(callId: string): Promise<CallAnalysis | null> {
  const { data: call } = await supabase
    .from('calls')
    .select('id, client_id, from_number, status, duration_seconds, started_at')
    .eq('id', callId)
    .maybeSingle();
  if (!call) return null;

  const [transcriptRow, summaryRow] = await Promise.all([
    supabase.from('call_transcripts').select('transcript').eq('call_id', callId).maybeSingle(),
    supabase.from('call_summaries').select('summary').eq('call_id', callId).maybeSingle(),
  ]);

  const transcript = (transcriptRow.data as { transcript?: string } | null)?.transcript;
  // Without a transcript there is nothing to analyse — an analysis built from
  // metadata alone would be invention dressed as insight.
  if (!transcript?.trim()) return null;

  const claude = getClaude();
  const meta = call as Record<string, unknown>;

  const response = await claude.messages.create({
    model: AI_MODEL,
    max_tokens: 3000,
    output_config: { effort: AI_EFFORT, format: { type: 'json_schema', schema: ANALYSIS_SCHEMA } },
    system: `You review transcripts of calls handled by an AI phone agent for a local business, and report what happened and what to change.

Rules:
- Ground every observation in the transcript. Quote or paraphrase the specific moment; never generalise about "call quality".
- "went_wrong" is for things the agent could have done better. A caller being rude is not something that went wrong.
- Each suggested fix must be specific and actionable, and routed correctly:
  - "knowledge" — the agent lacked a fact it should have had (a price, a policy, an opening time).
  - "agent_config" — the agent's behaviour or permissions were wrong (couldn't transfer, wouldn't book, wrong tone).
  - "staff_followup" — a person needs to call this caller back.
  - "none" — nothing to change.
- If the call went fine, say so and return an empty fix list. Do not manufacture criticism.
- Write for the business owner: plain language, no jargon.`,
    messages: [
      {
        role: 'user',
        content: `Call metadata: status ${String(meta.status)}, duration ${String(meta.duration_seconds ?? 'unknown')} seconds.
${summaryRow.data ? `\nProvider summary: ${(summaryRow.data as { summary: string }).summary}` : ''}

Transcript:
${transcript.slice(0, 40000)}`,
      },
    ],
  });

  const block = response.content.find(
    (b): b is { type: 'text'; text: string; citations: null } => b.type === 'text'
  );
  if (!block) return null;

  try {
    return JSON.parse(block.text) as CallAnalysis;
  } catch {
    return null;
  }
}
