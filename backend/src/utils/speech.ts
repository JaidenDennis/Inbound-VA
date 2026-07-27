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
 * Silent pause between number GROUPS. A comma is honored by the 11labs Flash/
 * Turbo model as a short, unvoiced prosodic break — unlike the spaced hyphen,
 * which that model tends to render as a connecting glide/schwa (an audible extra
 * syllable, "five-uh five"). So groups are comma-separated; digits WITHIN a group
 * flow on plain spaces, the way a person actually reads a number.
 */
export const GROUP_PAUSE = ',';

/** Split a run of digits into human phone groups: area(3) prefix(3) line(4). */
function phoneGroups(digits: string): string[] {
  if (digits.length === 10) return [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6)];
  if (digits.length === 11 && digits[0] === '1')
    return [digits.slice(0, 1), digits.slice(1, 4), digits.slice(4, 7), digits.slice(7)];
  // Fallback for other lengths: 3-digit chunks, last chunk up to 4.
  const groups: string[] = [];
  let rest = digits;
  while (rest.length > 4) {
    groups.push(rest.slice(0, 3));
    rest = rest.slice(3);
  }
  groups.push(rest);
  return groups;
}

/**
 * Format a phone number for TTS readback the way a person says one: in natural
 * groups (area code, prefix, last four) with a brief pause between groups, meant
 * to be spoken VERBATIM by the agent as a confirmation question. Strips non-
 * digits and maps each to its English word (so "904" is never read as "nine
 * hundred four"). Digits within a group flow on spaces; groups are separated by
 * a comma (a silent pause) — NOT a per-digit hyphen, which the TTS slurs into an
 * extra syllable.
 *
 * "9045551234" → "nine zero four, five five five, one two three four"
 */
export function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  const toWords = (group: string): string =>
    group
      .split('')
      .map((d) => DIGIT_WORDS[d])
      .join(' ');
  return phoneGroups(digits).map(toWords).join(`${GROUP_PAUSE} `);
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
 * Wrap a readback value (from formatPhone/spellName) with the instruction that
 * forces the LLM to speak it VERBATIM, keeping the built-in pauses. Commas
 * (between number groups) and dashes (between spelled letters) are SILENT
 * pauses — the LLM must keep them so nothing runs together, must NEVER voice
 * them, and should follow the readback with a confirmation question.
 */
export function verbatim(value: string): string {
  return `say this back to the caller EXACTLY as written, keeping its pauses so it doesn't run together — the commas and dashes are SILENT pauses (NEVER say them aloud), then ask if you got it right: "${value}"`;
}
