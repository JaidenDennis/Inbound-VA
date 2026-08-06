import { describe, it, expect } from 'vitest';
import { redactContext, redactText } from '../utils/redact.js';
import { normalizeMessage, fingerprintFor } from '../services/systemError.service.js';

/**
 * These are the tests that keep `system_errors` from becoming a credential
 * store. Error contexts carry whatever the throwing code had in scope, and every
 * holder of `system:read` can read the result — so a miss here hands live CRM
 * and provider credentials to anyone with console access.
 */
describe('redaction — secret-bearing keys', () => {
  it('redacts values under obviously secret key names', () => {
    const out = redactContext({
      authorization: 'Bearer abcdef123456',
      password: 'hunter2',
      api_key: 'pit-abcdef0123456789',
      apiKey: 'sk_live_0123456789abcdef',
      client_secret: 'shhh',
      refresh_token: 'rt-0123456789',
      privateKey: '-----BEGIN RSA PRIVATE KEY-----',
      sessionId: 'sess-123',
      cookie: 'gravvia_token=abc',
      signature: 'deadbeef',
    });

    for (const value of Object.values(out)) {
      expect(value).toBe('[Redacted]');
    }
  });

  it('redacts nested credentials however deep they sit', () => {
    const out = redactContext({
      crm: { connection: { credentials: { access_token: 'at-secret' }, name: 'GoHighLevel' } },
    });
    const crm = out.crm as Record<string, Record<string, unknown>>;
    expect(crm.connection.credentials).toBe('[Redacted]');
    // Non-secret siblings survive — a redactor that eats context is useless.
    expect(crm.connection.name).toBe('GoHighLevel');
  });

  it('redacts credentials inside arrays', () => {
    const out = redactContext({ headers: [{ authorization: 'Bearer x' }, { accept: 'application/json' }] });
    const headers = out.headers as Array<Record<string, unknown>>;
    expect(headers[0].authorization).toBe('[Redacted]');
    expect(headers[1].accept).toBe('application/json');
  });

  it('redacts caller PII that must not accumulate', () => {
    const out = redactContext({ dob: '1984-02-01', date_of_birth: '1984-02-01', ssn: '000-00-0000' });
    expect(out.dob).toBe('[Redacted]');
    expect(out.date_of_birth).toBe('[Redacted]');
    expect(out.ssn).toBe('[Redacted]');
  });
});

describe('redaction — secret-shaped values in free text', () => {
  // The dangerous case: the secret is in the message or stack, under no key at
  // all, because some HTTP client stringified the request into the error.
  it('strips bearer tokens from a message', () => {
    expect(redactText('Request failed with Authorization: Bearer abc123def456ghi'))
      .not.toContain('abc123def456ghi');
  });

  it('strips a JWT appearing anywhere in text', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N';
    const out = redactText(`token=${jwt} rejected`);
    expect(out).not.toContain(jwt);
    expect(out).toContain('[Redacted]');
  });

  it('strips provider-style API keys', () => {
    expect(redactText('key pit-0123456789abcdefgh was rejected')).toContain('[Redacted]');
    expect(redactText('using sk_live_0123456789abcdefgh')).not.toContain('sk_live_0123456789abcdefgh');
  });

  it('redacts secrets inside a stack trace', () => {
    const stack = [
      'Error: GHL rejected the request',
      '    at post (/app/src/crm/adapters/gohighlevel.ts:88:11) Bearer eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.sig',
    ].join('\n');
    expect(redactText(stack)).not.toContain('eyJhbGciOiJIUzI1NiJ9');
  });

  it('leaves ordinary messages intact', () => {
    const message = 'Client not found: booking rejected because the calendar was full';
    expect(redactText(message)).toBe(message);
  });
});

describe('redaction — robustness', () => {
  it('survives circular references', () => {
    const a: Record<string, unknown> = { name: 'a' };
    const b: Record<string, unknown> = { name: 'b', a };
    a.b = b;
    const out = redactContext(a);
    expect(out.name).toBe('a');
    expect(JSON.stringify(out)).toContain('[Circular]');
  });

  it('unwraps Error instances rather than emitting an empty object', () => {
    const out = redactContext({ cause: new Error('boom') });
    expect((out.cause as { message: string }).message).toBe('boom');
  });

  it('truncates very long strings so one error cannot bloat the table', () => {
    const out = redactText('x'.repeat(20_000));
    expect(out.length).toBeLessThan(10_000);
    expect(out).toContain('[truncated]');
  });

  it('returns an object even when handed a primitive', () => {
    expect(redactContext('just a string')).toEqual({ value: 'just a string' });
  });
});

describe('fingerprinting', () => {
  it('normalizes the variable parts of a message', () => {
    const normalized = normalizeMessage(
      "Call 8f2e4c1a-1111-2222-3333-444455556666 failed at 2026-08-05T10:00:00Z after 3 attempts"
    );
    expect(normalized).toContain('<uuid>');
    expect(normalized).toContain('<timestamp>');
    expect(normalized).toContain('<n>');
  });

  it('groups the same fault across different record ids', () => {
    const a = fingerprintFor({
      source: 'api', errorName: 'PostgresError', route: '/clients/:id',
      message: 'Client 8f2e4c1a-1111-2222-3333-444455556666 not found',
    });
    const b = fingerprintFor({
      source: 'api', errorName: 'PostgresError', route: '/clients/:id',
      message: 'Client 99999999-9999-9999-9999-999999999999 not found',
    });
    expect(a).toBe(b);
  });

  it('separates genuinely different faults', () => {
    const a = fingerprintFor({ source: 'api', errorName: 'TypeError', route: '/a', message: 'x is not a function' });
    const b = fingerprintFor({ source: 'api', errorName: 'TypeError', route: '/b', message: 'x is not a function' });
    const c = fingerprintFor({ source: 'worker', errorName: 'TypeError', route: '/a', message: 'x is not a function' });
    expect(new Set([a, b, c]).size).toBe(3);
  });
});
