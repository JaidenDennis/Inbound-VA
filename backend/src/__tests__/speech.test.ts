import { describe, it, expect } from 'vitest';
import { formatPhone, spellName } from '../utils/speech.js';

describe('formatPhone', () => {
  it('renders a clean 10-digit number as comma-separated words', () => {
    expect(formatPhone('9045551234')).toBe('nine, zero, four, five, five, five, one, two, three, four');
  });

  it('strips formatting before mapping (parens, dashes, spaces)', () => {
    expect(formatPhone('(904) 555-1234')).toBe('nine, zero, four, five, five, five, one, two, three, four');
  });

  it('handles a number with dots', () => {
    expect(formatPhone('904.555.1234')).toBe('nine, zero, four, five, five, five, one, two, three, four');
  });

  it('handles a partial / short number', () => {
    expect(formatPhone('904')).toBe('nine, zero, four');
  });

  it('returns empty string for empty input', () => {
    expect(formatPhone('')).toBe('');
  });

  it('returns empty string when input has no digits', () => {
    expect(formatPhone('()')).toBe('');
  });
});

describe('spellName', () => {
  it('spells a simple first name', () => {
    expect(spellName('Sarah')).toBe('S, A, R, A, H');
  });

  it('uppercases lowercase input', () => {
    expect(spellName('nguyen')).toBe('N, G, U, Y, E, N');
  });

  it('handles a full name with a space', () => {
    expect(spellName('Ana Maria')).toBe('A, N, A,  , M, A, R, I, A');
  });

  it('handles a single letter', () => {
    expect(spellName('A')).toBe('A');
  });

  it('trims surrounding whitespace before spelling', () => {
    expect(spellName('  Jo  ')).toBe('J, O');
  });

  it('returns empty string for empty input', () => {
    expect(spellName('')).toBe('');
  });
});
