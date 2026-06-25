/**
 * Format a phone number digit by digit for TTS readback.
 * Strips all non-digit characters, then joins each digit with " - ".
 *
 * "9045551234"   → "9 - 0 - 4 - 5 - 5 - 5 - 1 - 2 - 3 - 4"
 * "(904) 555-1234" → "9 - 0 - 4 - 5 - 5 - 5 - 1 - 2 - 3 - 4"
 */
export function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  return digits.split('').join(' - ');
}

/**
 * Spell a name letter by letter for TTS confirmation readback.
 * Trims, uppercases, then joins each character with " - ".
 * Used in confirmation contexts only — not for casual greetings.
 *
 * "Sarah"  → "S - A - R - A - H"
 * "nguyen" → "N - G - U - Y - E - N"
 */
export function spellName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return trimmed.toUpperCase().split('').join(' - ');
}
