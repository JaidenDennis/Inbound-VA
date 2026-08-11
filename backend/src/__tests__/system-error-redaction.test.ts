import { describe, it, expect, vi } from 'vitest';
import { redactContext, redactText } from '../utils/redact.js';
import { normalizeMessage, fingerprintFor, systemErrorService } from '../services/systemError.service.js';

/**
 * Captures the payload passed to `supabase.from('system_errors').insert(...)`
 * so `record()` can be exercised end-to-end without a real database. Declared
 * with `let` (not `const`) because the `vi.mock` factory below closes over it
 * lazily — the factory only runs when `systemError.service.ts` first imports
 * `../db/index.js`, by which point this array already exists.
 */
let insertCalls: Record<string, unknown>[] = [];

vi.mock('../db/index.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      insert: vi.fn((payload: Record<string, unknown>) => {
        insertCalls.push(payload);
        return {
          select: vi.fn(() => ({
            single: vi.fn(async () => ({ data: { id: 'row-1' }, error: null })),
          })),
        };
      }),
    })),
  },
}));

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

/**
 * Regression coverage for `SystemErrorService.record()`'s input normalisation.
 * A prior "fix" replaced the direct `.name`/`.message`/`.stack` reads with
 * `input.error instanceof Error ? input.error : new Error(String(input.error))`.
 * That broke the plain-object branch of `RecordErrorInput['error']`
 * (`{ name?, message, stack? }`), which is a real, intended input — not a
 * mistake — used by `mailer.ts` (SmtpNotConfigured) and
 * `retell-signature.middleware.ts` (WebhookSignatureError). Under the naive
 * form, `String({ name: 'X', message: 'Y' })` is the literal string
 * `'[object Object]'`, which becomes both the stored `message` and, via
 * `fingerprintFor`, the fingerprint — so distinct faults collapse into one
 * group and the diagnostic text is destroyed.
 */
describe('SystemErrorService.record — error normalisation', () => {
  it('case 1: a genuine Error instance keeps its own name, message and stack', async () => {
    insertCalls = [];
    const error = new Error('database connection lost');
    error.name = 'ConnectionError';

    await systemErrorService.record({ source: 'worker', error });

    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0].error_name).toBe('ConnectionError');
    expect(insertCalls[0].message).toBe('database connection lost');
    expect(insertCalls[0].stack).toEqual(expect.stringContaining('ConnectionError'));
  });

  it('case 2: an error-like plain object preserves its real name and message, not "[object Object]"', async () => {
    insertCalls = [];
    // Shaped exactly like the mailer.ts / retell-signature.middleware.ts callers:
    // a plain object, never thrown, carrying `name` and `message` only.
    const errorLike = {
      name: 'SmtpNotConfigured',
      message: 'SMTP_PASS is unset, so no email is being sent.',
    };

    await systemErrorService.record({ source: 'email', error: errorLike });

    expect(insertCalls).toHaveLength(1);
    // This is the regression: the naive `instanceof Error` form stringifies
    // the whole object via `String(errorLike)`, producing 'Error' /
    // '[object Object]' for these two fields instead of the real values.
    expect(insertCalls[0].error_name).toBe('SmtpNotConfigured');
    expect(insertCalls[0].message).toBe('SMTP_PASS is unset, so no email is being sent.');
    expect(insertCalls[0].message).not.toBe('[object Object]');
  });

  it('case 2b: two error-like objects with different messages produce different fingerprints', async () => {
    // The signature-middleware caller reports two distinct causes (no header
    // vs digest mismatch) through this same object shape. If the message text
    // is lost, both collapse to '[object Object]' and become one fingerprint
    // group in the error console, which is exactly the bug this guards against.
    insertCalls = [];
    await systemErrorService.record({
      source: 'webhook',
      error: { name: 'WebhookSignatureError', message: 'Missing signature header' },
    });
    await systemErrorService.record({
      source: 'webhook',
      error: { name: 'WebhookSignatureError', message: 'Signature digest mismatch' },
    });

    expect(insertCalls).toHaveLength(2);
    expect(insertCalls[0].message).toBe('Missing signature header');
    expect(insertCalls[1].message).toBe('Signature digest mismatch');
    expect(insertCalls[0].fingerprint).not.toBe(insertCalls[1].fingerprint);
  });

  it('case 3: a hostile, non-error-like value does not throw and still records a sensible fault', async () => {
    insertCalls = [];

    // None of these are Error instances or `{ message: string }` objects.
    // `record()` is invoked with `void` by real callers, so if any of these
    // threw synchronously ahead of the try/catch, `await` would reject here
    // and fail the test — that rejection is exactly what would otherwise
    // surface as an unhandled rejection in production, instead of the
    // best-effort no-op this method promises to be.
    const results = await Promise.all([
      systemErrorService.record({ source: 'api', error: null as unknown as Error }),
      systemErrorService.record({ source: 'api', error: undefined as unknown as Error }),
      systemErrorService.record({ source: 'api', error: 'just a string' as unknown as Error }),
      systemErrorService.record({ source: 'api', error: { code: 500 } as unknown as Error }),
    ]);

    expect(results).toEqual(['row-1', 'row-1', 'row-1', 'row-1']);
    expect(insertCalls).toHaveLength(4);
    for (const call of insertCalls) {
      expect(typeof call.error_name).toBe('string');
      expect(typeof call.message).toBe('string');
    }
  });
});
