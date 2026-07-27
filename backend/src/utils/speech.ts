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
 * Silent pause used inside spoken readbacks — between number groups, and between
 * spelled-out name letters. A comma is honored by the 11labs Flash/Turbo model as
 * a short, UNVOICED prosodic break, and is never spoken aloud. We deliberately
 * avoid the spaced hyphen: that model renders it as a connecting glide/schwa — an
 * audible extra syllable ("five-uh five", "ess-uh ay") that sounds like a slur —
 * and it also ignores ElevenLabs `<break/>` SSML entirely (the tag reaches the
 * model verbatim but produces no pause).
 */
export const PAUSE = ',';

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
  return phoneGroups(digits).map(toWords).join(`${PAUSE} `);
}

/**
 * Spell a name letter by letter for TTS confirmation readback, with a comma (a
 * silent pause) between letters so the TTS reads each one distinctly WITHOUT the
 * hyphen's slur artifact. Multiple words (first + last) are separated by a longer
 * pause. Trims and uppercases. Confirmation contexts only.
 *
 * "Sarah"     → "S, A, R, A, H"
 * "Ana Maria" → "A, N, A ... M, A, R, I, A"
 */
export function spellName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return trimmed
    .toUpperCase()
    .split(/\s+/)
    .map((word) => word.split('').join(`${PAUSE} `))
    .join(' ... ');
}

/**
 * Wrap a readback value (from formatPhone/spellName) with the instruction that
 * forces the LLM to speak it VERBATIM, keeping the built-in pauses. Commas are
 * SILENT pauses — the LLM must keep them so nothing runs together and must NEVER
 * voice them. It should then confirm with the caller, VARYING the phrasing rather
 * than repeating the same question every time.
 */
export function verbatim(value: string): string {
  return `say this back to the caller EXACTLY as written, keeping its pauses so nothing runs together — the commas are SILENT pauses (NEVER say them aloud). Then check it with the caller, varying how you ask (don't repeat the same confirmation phrase every time): "${value}"`;
}
