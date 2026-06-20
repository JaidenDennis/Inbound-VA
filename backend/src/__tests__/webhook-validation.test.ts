import { describe, it, expect } from 'vitest';
import CryptoJS from 'crypto-js';
import { validateRetellSignature } from '../providers/retell/retell.validator.js';

// Retell signs with the API key: header `v={ts},d={hmac_sha256(body+ts, apiKey)}`,
// valid for 5 minutes. Env (RETELL_API_KEY) is provided by vitest.setup.ts.
function signHeader(body: string, ts: number, key = process.env.RETELL_API_KEY as string): string {
  const d = CryptoJS.HmacSHA256(body + ts, key).toString(CryptoJS.enc.Hex);
  return `v=${ts},d=${d}`;
}

describe('Retell webhook/function signature validation', () => {
  const body = '{"event":"call_started","call":{"call_id":"abc"}}';

  it('rejects a missing signature', () => {
    expect(validateRetellSignature(body, undefined)).toBe(false);
  });

  it('rejects a malformed signature header', () => {
    expect(validateRetellSignature(body, 'not-a-real-sig')).toBe(false);
    expect(validateRetellSignature(body, 'v=123,d=deadbeef')).toBe(false);
  });

  it('accepts a valid, current signature', () => {
    const now = Date.now();
    expect(validateRetellSignature(body, signHeader(body, now), now)).toBe(true);
  });

  it('rejects a stale signature (older than 5 minutes)', () => {
    const now = Date.now();
    const old = now - 6 * 60 * 1000;
    expect(validateRetellSignature(body, signHeader(body, old), now)).toBe(false);
  });

  it('rejects when the body was tampered with', () => {
    const now = Date.now();
    const header = signHeader(body, now);
    expect(validateRetellSignature('{"event":"tampered"}', header, now)).toBe(false);
  });

  it('rejects when signed with the wrong key', () => {
    const now = Date.now();
    const header = signHeader(body, now, 'attacker-key');
    expect(validateRetellSignature(body, header, now)).toBe(false);
  });
});
