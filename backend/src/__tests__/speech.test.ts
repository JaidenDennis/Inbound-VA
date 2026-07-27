import { describe, it, expect } from 'vitest';
import { formatPhone, spellName } from '../utils/speech.js';

describe('formatPhone', () => {
  // Read the way a person says a number: area / prefix / line, comma between
  // groups (a silent pause), digits within a group flowing on spaces.
  const FULL = 'nine zero four, five five five, one two three four';

  it('renders a 10-digit number in natural groups with comma pauses', () => {
    expect(formatPhone('9045551234')).toBe(FULL);
  });

  it('strips formatting before grouping (parens, dashes, spaces)', () => {
    expect(formatPhone('(904) 555-1234')).toBe(FULL);
  });

  it('handles a number with dots', () => {
    expect(formatPhone('904.555.1234')).toBe(FULL);
  });

  it('splits off a leading country code as its own group', () => {
    expect(formatPhone('19045551234')).toBe(`one, ${FULL}`);
  });

  it('reads a short/partial number as a single group (no trailing comma)', () => {
    expect(formatPhone('904')).toBe('nine zero four');
  });

  it('returns empty string for empty input', () => {
    expect(formatPhone('')).toBe('');
  });

  it('returns empty string when input has no digits', () => {
    expect(formatPhone('()')).toBe('');
  });
});

describe('spellName', () => {
  // Comma between letters (a silent pause) instead of the schwa-inducing hyphen.
  it('spells a simple first name with comma pauses between letters', () => {
    expect(spellName('Sarah')).toBe('S, A, R, A, H');
  });

  it('uppercases lowercase input', () => {
    expect(spellName('nguyen')).toBe('N, G, U, Y, E, N');
  });

  it('separates first + last name with a longer pause', () => {
    expect(spellName('Ana Maria')).toBe('A, N, A ... M, A, R, I, A');
  });

  it('collapses extra whitespace between names', () => {
    expect(spellName('Ana   Maria')).toBe('A, N, A ... M, A, R, I, A');
  });

  it('handles a single letter (no trailing pause)', () => {
    expect(spellName('A')).toBe('A');
  });

  it('trims surrounding whitespace before spelling', () => {
    expect(spellName('  Jo  ')).toBe('J, O');
  });

  it('returns empty string for empty input', () => {
    expect(spellName('')).toBe('');
  });
});
