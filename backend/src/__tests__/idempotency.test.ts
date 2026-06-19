import { describe, it, expect } from 'vitest';
import { buildIdempotencyKey } from '../utils/idempotency.js';

describe('buildIdempotencyKey', () => {
  it('produces the same key for same inputs', () => {
    const k1 = buildIdempotencyKey('call.ended', 'abc123');
    const k2 = buildIdempotencyKey('call.ended', 'abc123');
    expect(k1).toBe(k2);
  });

  it('produces different keys for different inputs', () => {
    const k1 = buildIdempotencyKey('call.ended', 'abc123');
    const k2 = buildIdempotencyKey('call.ended', 'xyz789');
    expect(k1).not.toBe(k2);
  });

  it('ignores undefined parts', () => {
    const k1 = buildIdempotencyKey('event', undefined, 'id');
    const k2 = buildIdempotencyKey('event', 'id');
    expect(k1).toBe(k2);
  });

  it('returns a 32-char hex string', () => {
    const k = buildIdempotencyKey('test');
    expect(k).toMatch(/^[a-f0-9]{32}$/);
  });
});
