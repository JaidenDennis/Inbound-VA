import { getClaude, AI_MODEL, AI_EFFORT } from './claude.client.js';
import { supabase } from '../db/index.js';
import { clientService } from '../services/index.js';

/**
 * The configuration copilot: drafts agent content the client then approves.
 *
 * Everything here returns a *draft*. Nothing writes to the database — the
 * caller reviews the suggestion in the editor and saves it themselves. That
 * boundary is deliberate: a model that could silently rewrite what an agent
 * tells callers is a model that can change what a business promises, and the
 * one-click review step is what keeps a human accountable for that.
 */

/** Structured output shapes, enforced by the API rather than parsed hopefully. */
const FAQ_SCHEMA = {
  type: 'object',
  properties: {
    faqs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          answer: { type: 'string' },
          category: { type: 'string' },
        },
        required: ['question', 'answer', 'category'],
        additionalProperties: false,
      },
    },
  },
  required: ['faqs'],
  additionalProperties: false,
} as const;

const GREETING_SCHEMA = {
  type: 'object',
  properties: {
    options: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          style: { type: 'string' },
        },
        required: ['text', 'style'],
        additionalProperties: false,
      },
    },
  },
  required: ['options'],
  additionalProperties: false,
} as const;

/** What the agent already knows — so drafts extend it rather than duplicate it. */
async function existingContext(clientId: string): Promise<string> {
  const client = await clientService.findById(clientId);
  const settings = await clientService.getSettings(clientId);

  const [faqs, services] = await Promise.all([
    supabase.from('faqs').select('question').eq('client_id', clientId).eq('active', true).limit(40),
    supabase
      .from('services')
      .select('name, description, price, duration_minutes')
      .eq('client_id', clientId)
      .eq('active', true)
      .limit(40),
  ]);

  const serviceList = ((services.data ?? []) as Array<Record<string, unknown>>)
    .map((s) => `- ${s.name}${s.price != null ? ` ($${s.price})` : ''}: ${s.description ?? ''}`)
    .join('\n');
  const faqList = ((faqs.data ?? []) as Array<{ question: string }>)
    .map((f) => `- ${f.question}`)
    .join('\n');

  return `Business: ${settings?.business_name ?? client?.name ?? 'unknown'}
Industry: ${client?.industry ?? 'unknown'}
Agent name: ${settings?.agent_name ?? 'not set'}

Services offered:
${serviceList || '(none configured)'}

Questions the agent can already answer:
${faqList || '(none configured)'}`;
}

export interface DraftedFaq {
  question: string;
  answer: string;
  category: string;
}

/**
 * Suggest FAQs this agent is missing.
 *
 * Grounded in the client's own services and existing FAQs so it proposes gaps
 * rather than generic filler, and instructed to leave specifics blank rather
 * than invent them — a confidently wrong price is worse than an obvious blank.
 */
export async function draftFaqs(clientId: string, topic?: string): Promise<DraftedFaq[]> {
  const claude = getClaude();
  const context = await existingContext(clientId);

  const response = await claude.messages.create({
    model: AI_MODEL,
    max_tokens: 4096,
    output_config: { effort: AI_EFFORT, format: { type: 'json_schema', schema: FAQ_SCHEMA } },
    system: `You write FAQ entries for an AI phone agent that answers calls for a local business.

Rules:
- Write questions the way a caller would actually say them out loud, not the way a website would title them.
- Answers must be speakable: two or three sentences, no bullet points, no formatting, no URLs read aloud.
- Only state facts present in the business context you are given. Where a specific detail is needed but unknown — a price, a phone number, an address, a policy window — write a clearly marked placeholder in square brackets like [confirm price] so a human fills it in. Never invent the value.
- Do not duplicate a question the agent can already answer.
- Suggest at most 8.`,
    messages: [
      {
        role: 'user',
        content: `${context}

${topic ? `Focus on this topic: ${topic}` : 'Suggest the questions callers to this kind of business most often ask that this agent cannot yet answer.'}`,
      },
    ],
  });

  const parsed = extractJson<{ faqs: DraftedFaq[] }>(response);
  return parsed?.faqs ?? [];
}

export interface GreetingOption {
  text: string;
  style: string;
}

/**
 * Draft opening lines. Recording disclosure is required in every option
 * because the greeting replaces the template default wholesale — a caller who
 * is being recorded without a disclosure is a legal exposure, not a style
 * preference, so it is not left to the model's judgement.
 */
export async function draftGreetings(clientId: string, brief?: string): Promise<GreetingOption[]> {
  const claude = getClaude();
  const client = await clientService.findById(clientId);
  const settings = await clientService.getSettings(clientId);

  const response = await claude.messages.create({
    model: AI_MODEL,
    max_tokens: 2048,
    output_config: { effort: AI_EFFORT, format: { type: 'json_schema', schema: GREETING_SCHEMA } },
    system: `You write the opening line an AI phone agent speaks when it answers a call.

Rules:
- Use the tokens {business} and {agent} rather than literal names — they are substituted at call time.
- Every option must (a) greet, (b) identify the business and the agent, (c) invite the caller to speak, and (d) disclose that the call is recorded. All four, in one or two spoken sentences.
- Write for the ear. No formatting, no lists, no semicolons.
- Give 4 options with genuinely different registers, and label each one's style in a word or two.`,
    messages: [
      {
        role: 'user',
        content: `Business: ${settings?.business_name ?? client?.name ?? 'the business'}
Industry: ${client?.industry ?? 'general'}
Agent name: ${settings?.agent_name ?? 'the assistant'}
${brief ? `\nWhat they want: ${brief}` : ''}`,
      },
    ],
  });

  const parsed = extractJson<{ options: GreetingOption[] }>(response);
  return parsed?.options ?? [];
}

/** Structured outputs still arrive as a text block — parse it defensively. */
function extractJson<T>(response: { content: Array<{ type: string }> }): T | null {
  const block = response.content.find(
    (b): b is { type: 'text'; text: string } => b.type === 'text'
  );
  if (!block) return null;
  try {
    return JSON.parse(block.text) as T;
  } catch {
    return null;
  }
}
