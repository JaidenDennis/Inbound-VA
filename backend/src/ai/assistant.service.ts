import type Anthropic from '@anthropic-ai/sdk';
import { getClaude, AI_MODEL, AI_EFFORT } from './claude.client.js';
import { toolDefinitions, runTool, type ToolContext } from './assistant.tools.js';
import { logger } from '../utils/index.js';

/**
 * The dashboard assistant: answers questions about the caller's own data.
 *
 * The loop is written by hand rather than using the SDK tool runner because
 * every tool call has to be executed against a tenant context the model never
 * sees — the runner would hand us the call after binding arguments, and the
 * point here is that the tenant is bound outside the model's reach entirely.
 *
 * The assistant is read-only by construction (see assistant.tools.ts) so there
 * is no approval gate to build: the worst outcome of a confused turn is a
 * wasted query, never a mutation.
 */

export interface AssistantTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssistantReply {
  reply: string;
  /** Tool names used, so the UI can show what was consulted. */
  consulted: string[];
}

/** Bounds a runaway loop. Real questions resolve in two or three rounds. */
const MAX_ROUNDS = 8;

function systemPrompt(ctx: ToolContext, audience: 'staff' | 'client'): string {
  const scope =
    audience === 'staff'
      ? 'You are speaking to Gravvia platform staff, who can see every client on the platform.'
      : 'You are speaking to a business owner about their own account. They see only their own data.';

  return `You are the assistant inside Gravvia Engage, a platform that runs AI voice agents answering inbound phone calls for local businesses.

${scope}

Answer questions about their data by calling the tools available to you. The tools are the only source of truth you have — you have no memory of this account and no knowledge of it beyond what a tool returns this turn.

How to answer:
- Lead with the answer. A question about a number gets the number in the first sentence, then the context.
- Use the tools rather than guessing. If a tool returns nothing, say so plainly instead of inventing a plausible figure.
- Never state a statistic, name, or date that did not come from a tool result this turn.
- Write for someone who runs a business, not an engineer. Say "calls that went to voicemail", not "in_voicemail = true". Never show raw ids, column names, or JSON unless asked.
- Keep it short. Most questions deserve two or three sentences. Use a compact list only when comparing several items.
- If something looks wrong — an agent out of sync, numbers not routed, CRM pushes failing — say so and name the fix, even if they didn't ask.
${audience === 'client' ? '- Never mention other clients, the platform\'s internals, or how the agent is prompted. If asked, say that is managed by the Gravvia team.' : ''}

Today is ${new Date().toISOString().slice(0, 10)}.`;
}

export async function askAssistant(
  history: AssistantTurn[],
  ctx: ToolContext,
  audience: 'staff' | 'client'
): Promise<AssistantReply> {
  const claude = getClaude();
  const consulted: string[] = [];

  const messages: Anthropic.MessageParam[] = history.map((turn) => ({
    role: turn.role,
    content: turn.content,
  }));

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await claude.messages.create({
      model: AI_MODEL,
      max_tokens: 4096,
      system: systemPrompt(ctx, audience),
      output_config: { effort: AI_EFFORT },
      tools: toolDefinitions(),
      messages,
    });

    if (response.stop_reason === 'refusal') {
      return {
        reply: "I can't help with that one. Try rephrasing, or ask about your calls, bookings, or agent setup.",
        consulted,
      };
    }

    const toolUses = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
    );

    if (toolUses.length === 0) {
      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
        .trim();
      return { reply: text || 'I could not put together an answer for that.', consulted };
    }

    messages.push({ role: 'assistant', content: response.content });

    // All results go back in ONE user message — splitting them teaches the
    // model to stop issuing parallel calls.
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      consulted.push(use.name);
      const { result, isError } = await runTool(
        use.name,
        (use.input ?? {}) as Record<string, unknown>,
        ctx
      );
      results.push({
        type: 'tool_result',
        tool_use_id: use.id,
        content: typeof result === 'string' ? result : JSON.stringify(result),
        ...(isError ? { is_error: true } : {}),
      });
    }

    messages.push({ role: 'user', content: results });
  }

  logger.warn({ clientId: ctx.clientId }, 'Assistant hit the tool-round ceiling');
  return {
    reply:
      'That took more lookups than I can do in one go. Try narrowing the question — a single client, or a shorter time period.',
    consulted,
  };
}
