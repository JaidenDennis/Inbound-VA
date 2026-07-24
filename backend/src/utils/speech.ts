const DIGIT_WORDS: Record<string, string> = {
  '0': 'zero',
  '1': 'one',
  '2': 'two',
  '3': 'three',
  '4': 'four',
  '5': 'five',
  '6': 'six',
  '7': 'seven',
  '8': 'eight',
  '9': 'nine',
};

/**
 * Separator inserted between spoken digits/letters to stop them slurring.
 *
 * We deliberately do NOT use the ElevenLabs `<break time="..."/>` SSML tag:
 * Retell runs a fast 11labs model (Flash/Turbo) that IGNORES `<break>` SSML, so
 * the tags reach the model verbatim (confirmed in live transcripts) but produce
 * NO pause — the digits run together. A plain spaced hyphen is honored as a
 * short, silent pause by that model and is never spoken aloud, which is what
 * reliably separates the digits/letters. Kept as a constant so it's easy to
 * tune (e.g. to " ... " for a longer pause) in one place.
 */
export const PAUSE_TAG = '-';

/**
 * Format a phone number for TTS readback with a hard pause between every digit.
 * Strips non-digits, maps each to its English word (so "904" is never read as
 * "nine hundred four"), then joins with a <break> tag so ElevenLabs can't slur
 * them. The result is meant to be spoken VERBATIM by the agent.
 *
 * "9045551234" → "nine - zero - four - five - five - five - one - two - three - four"
 */
export function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  return digits
    .split('')
    .map((d) => DIGIT_WORDS[d])
    .join(` ${PAUSE_TAG} `);
}

/**
 * Spell a name letter by letter for TTS confirmation readback, with a hard pause
 * between every letter so the TTS reads each one distinctly. Trims, uppercases,
 * then joins each character with a <break> tag. Confirmation contexts only.
 *
 * "Sarah" → "S - A - R - A - H"
 */
export function spellName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return trimmed.toUpperCase().split('').join(` ${PAUSE_TAG} `);
}

/**
 * Wrap a dash-separated readback value (from formatPhone/spellName) with the
 * instruction that forces the LLM to speak it VERBATIM — each digit/letter one
 * at a time. The dashes are silent pauses that the TTS honors; the LLM must
 * keep them and must never say the word "dash".
 */
export function verbatim(value: string): string {
  return `say this back to the caller EXACTLY as written, one digit/letter at a time, keeping every dash so they don't run together — the dashes are silent pauses, NEVER say the word "dash": "${value}"`;
}
