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
 * Format a phone number as comma-separated English word-form digits for TTS readback.
 * Strips all non-digit characters, maps each digit to its English word, then joins
 * with ", ". Commas are a universal TTS pause signal and word-form digits are what
 * TTS engines are trained on, so the agent reads each digit clearly and separately.
 *
 * "9045551234"     → "nine, zero, four, five, five, five, one, two, three, four"
 * "(904) 555-1234" → "nine, zero, four, five, five, five, one, two, three, four"
 */
export function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  return digits
    .split('')
    .map((d) => DIGIT_WORDS[d])
    .join(', ');
}

/**
 * Spell a name letter by letter for TTS confirmation readback.
 * Trims, uppercases, then joins each character with ", " (comma + space) so the
 * TTS engine pauses between letters. Used in confirmation contexts only — not for
 * casual greetings.
 *
 * "Sarah"  → "S, A, R, A, H"
 * "nguyen" → "N, G, U, Y, E, N"
 */
export function spellName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return trimmed.toUpperCase().split('').join(', ');
}
