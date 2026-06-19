import { describe, it, expect } from 'vitest';
import CryptoJS from 'crypto-js';
import { validateRetellSignature } from '../providers/retell/retell.validator.js';

// Env is provided by vitest.setup.ts (RETELL_WEBHOOK_SECRET etc.) before import.

describe('Retell webhook signature validation', () => {
  it('rejects missing signature', () => {
    expect(validateRetellSignature('{"event":"test"}', undefined)).toBe(false);
  });

  it('rejects wrong signature', () => {
    expect(validateRetellSignature('{"event":"test"}', 'wrong-sig')).toBe(false);
  });

  it('accepts correct HMAC-SHA256 signature', () => {
    const body = '{"event":"call_started"}';
    const expected = CryptoJS.HmacSHA256(body, process.env.RETELL_WEBHOOK_SECRET as string).toString(CryptoJS.enc.Hex);
    expect(validateRetellSignature(body, expected)).toBe(true);
  });
});
