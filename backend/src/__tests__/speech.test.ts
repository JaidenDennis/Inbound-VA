import { describe, it, expect } from 'vitest';
import { formatPhone, spellName, PAUSE_TAG } from '../utils/speech.js';

// Build the expected output the same way the formatters join tokens, so the
// tests assert on token mapping + tag placement without hard-coding the long
// repeated tag string by hand.
const join = (...parts: string[]): string => parts.join(` ${PAUSE_TAG} `);

describe('formatPhone', () => {
  it('renders a clean 10-digit number as word-form digits split by pause tags', () => {
    expect(formatPhone('9045551234')).toBe(
      join('nine', 'zero', 'four', 'five', 'five', 'five', 'one', 'two', 'three', 'four')
    );
  });

  it('strips formatting before mapping (parens, dashes, spaces)', () => {
    expect(formatPhone('(904) 555-1234')).toBe(
      join('nine', 'zero', 'four', 'five', 'five', 'five', 'one', 'two', 'three', 'four')
    );
  });

  it('handles a number with dots', () => {
    expect(formatPhone('904.555.1234')).toBe(
      join('nine', 'zero', 'four', 'five', 'five', 'five', 'one', 'two', 'three', 'four')
    );
  });

  it('handles a partial / short number', () => {
    expect(formatPhone('904')).toBe(join('nine', 'zero', 'four'));
  });

  it('returns empty string for empty input', () => {
    expect(formatPhone('')).toBe('');
  });

  it('returns empty string when input has no digits', () => {
    expect(formatPhone('()')).toBe('');
  });
});

describe('spellName', () => {
  it('spells a simple first name with pause tags between letters', () => {
    expect(spellName('Sarah')).toBe(join('S', 'A', 'R', 'A', 'H'));
  });

  it('uppercases lowercase input', () => {
    expect(spellName('nguyen')).toBe(join('N', 'G', 'U', 'Y', 'E', 'N'));
  });

  it('handles a full name with a space', () => {
    expect(spellName('Ana Maria')).toBe(join('A', 'N', 'A', ' ', 'M', 'A', 'R', 'I', 'A'));
  });

  it('handles a single letter (no trailing tag)', () => {
    expect(spellName('A')).toBe('A');
  });

  it('trims surrounding whitespace before spelling', () => {
    expect(spellName('  Jo  ')).toBe(join('J', 'O'));
  });

  it('returns empty string for empty input', () => {
    expect(spellName('')).toBe('');
  });
});
