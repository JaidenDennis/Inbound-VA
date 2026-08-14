import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import { ZodError } from 'zod';

/**
 * The website intake endpoint.
 *
 * Unauthenticated by design — gravvia.com is a static site, so any secret it
 * used would be published in browser JavaScript. These tests pin the defences
 * that stand in for that secret, because each is the kind of check that is easy
 * to weaken later without noticing: an origin list that stops being consulted,
 * a honeypot that starts returning 400 and so tells the spammer it was caught.
 */

type IngestArg = Record<string, unknown>;

const ingest = vi.fn<(input: IngestArg) => Promise<{
  queued: true;
  clientId: string;
  contactId: string;
  jobId: string;
}>>(async () => ({
  queued: true as const,
  clientId: 'c1',
  contactId: 'contact-abcdef12',
  jobId: 'job-1',
}));

vi.mock('../services/clay-lead.service.js', () => ({
  clayLeadService: { ingest: (input: IngestArg) => ingest(input) },
  ClayIngestError: class extends Error {
    statusCode: number;
    constructor(statusCode: number, message: string) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

const ENV = {
  SITE_LEAD_CLIENT_ID: '11111111-1111-1111-1111-111111111111',
  SITE_LEAD_ORIGINS: 'https://gravvia.com,https://www.gravvia.com',
  SITE_LEAD_RATE_LIMIT_MAX: 5,
  SITE_LEAD_MIN_FILL_MS: 3000,
  RATE_LIMIT_WINDOW_MS: 60_000,
};

vi.mock('../config/index.js', () => ({
  get env() {
    return ENV;
  },
}));

const { siteLeadRoute } = await import('../routes/webhooks/site-lead.route.js');

const VALID = {
  name: 'Dana Reyes',
  business: 'Bare Beauty',
  email: 'dana@barebeauty.example',
  phone: '+1 904 555 0142',
  industry: 'med_spa',
  volume: '120',
  notes: 'After-hours bookings',
  elapsedMs: 45_000,
};

/** Distinct from `undefined`, which would trigger the default parameter. */
const NO_ORIGIN = Symbol('no-origin');

async function post(body: unknown, origin: string | typeof NO_ORIGIN = 'https://gravvia.com') {
  const app = Fastify();
  // The real server turns a failed .parse() into a 400 in app.ts's error
  // handler. A bare instance would answer 500 and the validation tests below
  // would be asserting against the harness rather than the route.
  app.setErrorHandler((error: unknown, _request, reply) => {
    if (error instanceof ZodError) {
      reply.code(400).send({ error: 'Validation failed', details: error.flatten().fieldErrors });
      return;
    }
    const e = error as { statusCode?: number; message?: string };
    reply.code(e.statusCode ?? 500).send({ error: e.message ?? 'error' });
  });
  await app.register(siteLeadRoute);
  await app.ready();
  const res = await app.inject({
    method: 'POST',
    url: '/webhooks/site/lead',
    ...(typeof origin === 'string' ? { headers: { origin } } : {}),
    payload: body as Record<string, unknown>,
  });
  await app.close();
  return res;
}

beforeEach(() => {
  ingest.mockClear();
  ENV.SITE_LEAD_CLIENT_ID = '11111111-1111-1111-1111-111111111111';
  ENV.SITE_LEAD_ORIGINS = 'https://gravvia.com,https://www.gravvia.com';
});

describe('accepting a real submission', () => {
  it('queues the lead and answers 202', async () => {
    const res = await post(VALID);
    expect(res.statusCode).toBe(202);
    expect(ingest).toHaveBeenCalledOnce();
  });

  it('tags it as a website enquiry, so it is distinguishable from Clay and from a call', async () => {
    await post(VALID);
    const arg = ingest.mock.calls[0]![0];
    expect(arg.source).toBe('website');
    expect(arg.tags).toContain('website-intake');
  });

  it('anchors idempotency on the email, so a double-submit is one opportunity', async () => {
    await post(VALID);
    const a = ingest.mock.calls[0]![0];
    expect(a.recordId).toBe('site:dana@barebeauty.example');
  });

  it('returns a reference that comes from the created record, not a random number', async () => {
    const res = await post(VALID);
    expect(res.json().reference).toBe('contact-'.slice(0, 8));
  });

  it('omits fields the visitor left blank rather than writing empty values', async () => {
    await post({ name: 'A Person', email: 'a@b.example', elapsedMs: 9000 });
    const arg = ingest.mock.calls[0]![0];
    expect(arg).not.toHaveProperty('phone');
    expect(arg).not.toHaveProperty('company');
  });
});

describe('spam defences', () => {
  it('drops a submission with the honeypot filled — and still answers 202', async () => {
    const res = await post({ ...VALID, company_website: 'http://spam.example' });
    // 202, not 400: telling a spammer which check caught them is free tuning
    // information for them.
    expect(res.statusCode).toBe(202);
    expect(ingest).not.toHaveBeenCalled();
  });

  it('drops a submission returned faster than a person can type', async () => {
    const res = await post({ ...VALID, elapsedMs: 400 });
    expect(res.statusCode).toBe(202);
    expect(ingest).not.toHaveBeenCalled();
  });

  it('accepts one that took long enough', async () => {
    await post({ ...VALID, elapsedMs: 3001 });
    expect(ingest).toHaveBeenCalledOnce();
  });

  it('accepts when the page sent no timing at all, rather than assuming the worst', async () => {
    const { elapsedMs: _drop, ...noTiming } = VALID;
    await post(noTiming);
    expect(ingest).toHaveBeenCalledOnce();
  });
});

describe('origin', () => {
  it('refuses an origin that is not on the list', async () => {
    const res = await post(VALID, 'https://evil.example');
    expect(res.statusCode).toBe(403);
    expect(ingest).not.toHaveBeenCalled();
  });

  it('refuses a request with no origin header', async () => {
    const res = await post(VALID, NO_ORIGIN);
    expect(res.statusCode).toBe(403);
  });

  it('accepts every configured origin, so the www host is not locked out', async () => {
    await post(VALID, 'https://www.gravvia.com');
    expect(ingest).toHaveBeenCalledOnce();
  });

  it('refuses everything when no origins are configured — never fails open', async () => {
    ENV.SITE_LEAD_ORIGINS = '';
    const res = await post(VALID);
    expect(res.statusCode).toBe(403);
    expect(ingest).not.toHaveBeenCalled();
  });
});

describe('configuration', () => {
  it('is disabled, not open, when no client is configured', async () => {
    ENV.SITE_LEAD_CLIENT_ID = '';
    const res = await post(VALID);
    expect(res.statusCode).toBe(503);
    expect(ingest).not.toHaveBeenCalled();
  });
});

describe('validation', () => {
  it('rejects a missing email — it is the only way to reply', async () => {
    const { email: _drop, ...noEmail } = VALID;
    const res = await post(noEmail);
    expect(res.statusCode).toBe(400);
  });

  it('rejects a malformed email', async () => {
    const res = await post({ ...VALID, email: 'not-an-address' });
    expect(res.statusCode).toBe(400);
  });
});
