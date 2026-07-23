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
 * ElevenLabs SSML pause tag inserted between digits/letters. Commas and periods
 * get compressed by the 11labs prosody model when the tokens are short, so a
 * hard <break> is the only reliable way to stop digits/letters slurring together.
 * The tag is silent — the LLM must reproduce it verbatim but never speak it.
 * 0.3s is long enough to separate cleanly without sounding robotic. NOTE: too
 * many breaks in one utterance can cause 11labs audio artifacts; tune here.
 */
export const PAUSE_TAG = '<break time="0.3s" />';

/**
 * Format a phone number for TTS readback with a hard pause between every digit.
 * Strips non-digits, maps each to its English word (so "904" is never read as
 * "nine hundred four"), then joins with a <break> tag so ElevenLabs can't slur
 * them. The result is meant to be spoken VERBATIM by the agent.
 *
 * "9045551234" → "nine <break time="0.3s" /> zero <break time="0.3s" /> four ..."
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
 * "Sarah" → "S <break time="0.3s" /> A <break time="0.3s" /> R ..."
 */
export function spellName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return trimmed.toUpperCase().split('').join(` ${PAUSE_TAG} `);
}

/**
 * Wrap a break-tagged readback value (from formatPhone/spellName) with the
 * instruction that forces the LLM to speak it VERBATIM. The <break> pause tags
 * only survive to the TTS if the model echoes the string exactly rather than
 * paraphrasing it — hence the explicit framing and the reminder that the
 * markers are silent and must never be spoken aloud.
 */
export function verbatim(value: string): string {
  return `say this back to the caller EXACTLY as written, reproducing the "<break ... />" pause markers but NEVER speaking them aloud (they are silent pauses): "${value}"`;
}
