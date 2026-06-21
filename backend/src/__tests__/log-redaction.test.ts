import { describe, it, expect } from 'vitest';
import pino from 'pino';
import { LOG_REDACT_PATHS } from '../utils/logger.js';

// Build a logger with the SAME redact config used in production and capture the
// serialized line, so we verify secrets are actually censored (not just that the
// paths are syntactically valid — pino would throw at construction otherwise).
function capture(obj: Record<string, unknown>): Record<string, unknown> {
  const lines: string[] = [];
  const dest = { write: (s: string) => void lines.push(s) };
  const log = pino(
    { base: undefined, redact: { paths: LOG_REDACT_PATHS, censor: '[Redacted]' } },
    dest as unknown as pino.DestinationStream
  );
  log.info(obj, 'msg');
  return JSON.parse(lines.join('')) as Record<string, unknown>;
}

describe('log redaction', () => {
  it('redacts sensitive request headers but keeps benign ones', () => {
    const out = capture({
      req: {
        headers: {
          authorization: 'Bearer super-secret-token',
          cookie: 'session=abc',
          'x-retell-signature': 'v=1,d=deadbeef',
          'x-admin-api-key': 'admin-key',
          'user-agent': 'Retell/1.0',
        },
      },
    });
    const headers = (out.req as { headers: Record<string, string> }).headers;
    expect(headers.authorization).toBe('[Redacted]');
    expect(headers.cookie).toBe('[Redacted]');
    expect(headers['x-retell-signature']).toBe('[Redacted]');
    expect(headers['x-admin-api-key']).toBe('[Redacted]');
    expect(headers['user-agent']).toBe('Retell/1.0'); // non-sensitive untouched
  });

  it('redacts credential/secret fields at top level and one level deep', () => {
    const out = capture({
      password: 'hunter2',
      credentials: { apiKey: 'k' },
      RETELL_API_KEY: 'key_live_123',
      crm: { credentials_encrypted: 'enc' },
    });
    expect(out.password).toBe('[Redacted]');
    expect(out.credentials).toBe('[Redacted]');
    expect(out.RETELL_API_KEY).toBe('[Redacted]');
    expect((out.crm as Record<string, string>).credentials_encrypted).toBe('[Redacted]');
  });
});
