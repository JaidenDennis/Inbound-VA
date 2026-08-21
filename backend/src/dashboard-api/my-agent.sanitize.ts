import { isDialable } from '../utils/index.js';
/**
 * Read-side sanitiser for the agent editor.
 *
 * GET /my-agent echoes stored settings into the editor and PATCH /my-agent
 * validates them strictly against `updateSchema`. Those two facts combine into
 * a lockout: a stored value outside the current schema — written by an older
 * template, a direct database edit, or a schema that tightened after the row
 * was saved — makes the record permanently un-editable. The form loads the bad
 * value, posts it back untouched alongside the user's real change, and the
 * whole save is rejected. The user has no way to correct it from the UI,
 * because every attempt carries the poison along.
 *
 * So the editor is never handed a value the API would refuse.
 *
 * This belongs on the way OUT and nowhere else. Sanitising on the way IN would
 * silently discard something a user actually typed, which is a worse failure
 * than a visible rejection.
 */

export interface AgentReadbackOptions {
  voices: readonly string[];
  tones: readonly string[];
  styles: readonly string[];
  personalities: readonly string[];
}

export interface AgentReadback {
  voice_id: string;
  agent_tone: string;
  agent_response_style: string;
  agent_personality: string;
  responsiveness: number | null;
  interruption_sensitivity: number | null;
  voice_temperature: number | null;
  notification_emails: string[];
  pronunciation_dictionary: Array<{ word: string; alphabet: string; phoneme: string }>;
}

/** Mirrors `z.string().email()` closely enough to agree on real addresses. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Kept in step with `updateSchema`'s numeric bounds in my-agent.route.ts. */
const RANGES = {
  responsiveness: [0.3, 1],
  interruption_sensitivity: [0.3, 1],
  voice_temperature: [0.2, 1.2],
} as const;

const ALPHABETS = ['ipa', 'cmu'];

/** A member of `allowed`, or '' — which the editor renders as "not set". */
function oneOf(value: unknown, allowed: readonly string[]): string {
  return typeof value === 'string' && allowed.includes(value) ? value : '';
}

/**
 * In range, or null. Null rather than a clamp on purpose: a clamped value would
 * silently rewrite a setting the user never chose, and the editor already
 * treats null as "use the platform default", which is the honest reading of a
 * value the API will not accept.
 */
function inRange(value: unknown, [min, max]: readonly [number, number]): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : null;
}

export function sanitizeAgentReadback(
  stored: Record<string, unknown>,
  options: AgentReadbackOptions
): AgentReadback {
  const emails = Array.isArray(stored.notification_emails) ? stored.notification_emails : [];
  const dictionary = Array.isArray(stored.pronunciation_dictionary)
    ? stored.pronunciation_dictionary
    : [];

  return {
    voice_id: oneOf(stored.voice_id, options.voices),
    agent_tone: oneOf(stored.agent_tone, options.tones),
    agent_response_style: oneOf(stored.agent_response_style, options.styles),
    agent_personality: oneOf(stored.agent_personality, options.personalities),

    responsiveness: inRange(stored.responsiveness, RANGES.responsiveness),
    interruption_sensitivity: inRange(
      stored.interruption_sensitivity,
      RANGES.interruption_sensitivity
    ),
    voice_temperature: inRange(stored.voice_temperature, RANGES.voice_temperature),

    notification_emails: emails.filter(
      (e): e is string => typeof e === 'string' && EMAIL.test(e)
    ),

    // Every field must survive `pronunciationSchema`, so a partial row is
    // dropped rather than half-repaired — a blank word or phoneme carries no
    // instruction worth preserving.
    pronunciation_dictionary: dictionary.filter(
      (p): p is { word: string; alphabet: string; phoneme: string } => {
        if (!p || typeof p !== 'object') return false;
        const row = p as Record<string, unknown>;
        return (
          typeof row.word === 'string' && row.word.length > 0 &&
          typeof row.phoneme === 'string' && row.phoneme.length > 0 &&
          typeof row.alphabet === 'string' && ALPHABETS.includes(row.alphabet)
        );
      }
    ),
  };
}

/**
 * Reject a transfer that could never connect.
 *
 * Without this the save succeeds, the toggle reads "on", and the renderer
 * quietly emits no transfer tool — a switch that does nothing and says
 * nothing, which is the exact failure this area kept producing.
 *
 * Checked against the MERGED config rather than the patch: turning the toggle
 * on without resending the number is a legitimate edit, and the number already
 * stored is the one that counts. Checking the patch alone would reject it.
 *
 * This can only reject a save that is already broken, and both escapes — fix
 * the number, or switch transfer off — are fields on the same form, so it
 * cannot produce the un-editable record described at the top of this file.
 */
export function transferValidationError(
  merged: Record<string, unknown>
): { error: string; details: Record<string, string[]> } | null {
  if (merged.transfer_enabled !== true) return null;
  if (isDialable(merged.transfer_number)) return null;
  return {
    error: 'Validation failed',
    details: {
      transfer_number: [
        'Add a phone number in international format (e.g. +19045551234) to transfer callers to a person.',
      ],
    },
  };
}
