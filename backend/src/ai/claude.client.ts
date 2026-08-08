import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/index.js';

/**
 * The single Claude client.
 *
 * Constructed lazily so a deployment with no ANTHROPIC_API_KEY boots normally —
 * the AI routes then answer 503 with an explanation instead of the whole API
 * failing to start over a feature most tenants never touch.
 */

let client: Anthropic | null = null;

export function isAiConfigured(): boolean {
  return !!env.ANTHROPIC_API_KEY;
}

export function getClaude(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error(
      'AI features are not configured. Set ANTHROPIC_API_KEY on the API service to enable them.'
    );
  }
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client;
}

export const AI_MODEL = env.ANTHROPIC_MODEL;

/**
 * Every AI surface here is a short, bounded task, so the whole family runs at
 * `medium` effort. Raising it buys deeper reasoning the console does not need
 * and costs latency an operator waiting on a chat reply will feel.
 */
export const AI_EFFORT = 'medium' as const;
