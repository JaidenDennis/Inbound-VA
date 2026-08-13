import { describe, it, expect } from 'vitest';
import { exportFilename, companySlug } from '../utils/exportFilename.js';

/**
 * An export lands in someone's Downloads folder next to exports from every
 * other tool they use. "gravvia-money-2026-08-13.csv" tells them which vendor
 * produced it; it does not tell them which of their businesses it describes,
 * which is the question an operator with several tenants actually has.
 */
describe('companySlug', () => {
  it('lowercases and hyphenates', () => {
    expect(companySlug('Bare Beauty Med Spa')).toBe('bare-beauty-med-spa');
  });

  it('drops punctuation that is awkward in a filename', () => {
    expect(companySlug("Mike's Plumbing & Heating, Inc.")).toBe('mikes-plumbing-heating-inc');
    // A slash separates two things, so it becomes a separator — unlike the
    // apostrophe above, which sits inside a single word.
    expect(companySlug('A/B Test: Co')).toBe('a-b-test-co');
  });

  it('collapses runs of separators and trims them from the ends', () => {
    expect(companySlug('  Harborview   —  Apartments  ')).toBe('harborview-apartments');
    expect(companySlug('---Acme---')).toBe('acme');
  });

  it('keeps digits, which are often load-bearing in a business name', () => {
    expect(companySlug('Studio 54 Salon')).toBe('studio-54-salon');
  });

  it('transliterates nothing it cannot represent, rather than emitting mojibake', () => {
    expect(companySlug('Café Niño')).toBe('caf-ni-o');
  });

  it('falls back when a name reduces to nothing usable', () => {
    expect(companySlug('!!!')).toBe('client');
    expect(companySlug('')).toBe('client');
    expect(companySlug(null)).toBe('client');
  });

  it('caps length so the filename stays manageable', () => {
    const long = 'A'.repeat(120);
    expect(companySlug(long).length).toBeLessThanOrEqual(60);
  });
});

describe('exportFilename', () => {
  it('leads with the company, then what it is, then when', () => {
    expect(exportFilename('Bare Beauty Med Spa', 'money', '2026-08-13')).toBe(
      'bare-beauty-med-spa-money-2026-08-13.csv'
    );
  });

  it('honours a non-csv extension', () => {
    expect(exportFilename('Acme', 'calls', '2026-01-02', 'json')).toBe(
      'acme-calls-2026-01-02.json'
    );
  });

  it('still produces a usable name when the company is unknown', () => {
    expect(exportFilename(null, 'trust', '2026-08-13')).toBe('client-trust-2026-08-13.csv');
  });
});
