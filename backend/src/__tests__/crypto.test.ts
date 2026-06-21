import { describe, it, expect } from 'vitest';
import CryptoJS from 'crypto-js';
import { encrypt, decrypt, hashApiKey, generateApiKey } from '../utils/crypto.js';

// ENCRYPTION_KEY is provided by vitest.setup.ts.
describe('crypto (AES-256-GCM at rest)', () => {
  it('round-trips a value through encrypt/decrypt', () => {
    const secret = JSON.stringify({ apiKey: 'sk_live_abc', locationId: '123' });
    const ct = encrypt(secret);
    expect(ct.startsWith('gcm.v1.')).toBe(true); // new authenticated format
    expect(ct).not.toContain(secret); // not stored in plaintext
    expect(decrypt(ct)).toBe(secret);
  });

  it('produces a unique ciphertext each time (random IV)', () => {
    expect(encrypt('same')).not.toBe(encrypt('same'));
  });

  it('rejects tampered ciphertext (auth tag fails)', () => {
    const ct = encrypt('do-not-tamper');
    // Format: gcm.v1.<iv>.<tag>.<data> → mutate the tag's first base64 char,
    // which always changes a decoded byte (base64 padding can't absorb it).
    const parts = ct.split('.');
    parts[3] = (parts[3][0] === 'A' ? 'B' : 'A') + parts[3].slice(1);
    expect(() => decrypt(parts.join('.'))).toThrow();
  });

  it('still decrypts legacy CryptoJS-encrypted values (backward compat)', () => {
    const legacy = CryptoJS.AES.encrypt('legacy-secret', process.env.ENCRYPTION_KEY as string).toString();
    expect(legacy.startsWith('gcm.v1.')).toBe(false);
    expect(decrypt(legacy)).toBe('legacy-secret');
  });

  it('hashes API keys deterministically and mints prefixed keys', () => {
    expect(hashApiKey('abc')).toBe(hashApiKey('abc'));
    expect(hashApiKey('abc')).toHaveLength(64); // sha256 hex
    expect(generateApiKey()).toMatch(/^gve_[0-9a-f]{64}$/);
  });
});
