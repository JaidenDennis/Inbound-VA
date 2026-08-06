import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// Clay → CRM outbound lead ingest: a secret-authenticated webhook that turns an
// enriched Clay row into a contact plus a queued CRM opportunity, so outbound
// leads travel the same retry/idempotency path as voice-captured ones.

const SECRET = 'clay-test-secret-at-least-16-chars';
process.env.CLAY_INGEST_SECRET = SECRET;
process.env.CLAY_DEFAULT_CLIENT_ID = '11111111-1111-4111-8111-111111111111';

let connRow: Record<string, unknown> | null;
vi.mock('../db/index.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(() => Promise.resolve({ data: connRow, error: null })),
          })),
        })),
      })),
    })),
  },
}));

type QueueAdd = (
  name: string,
  data: Record<string, unknown>,
  opts: { jobId: string }
) => Promise<void>;
const crmAdd = vi.fn<QueueAdd>(() => Promise.resolve());
vi.mock('../queues/index.js', () => ({ crmSyncQueue: { add: crmAdd } }));

type UpsertByIdentity = (
  clientId: string,
  identity: { phone?: string; email?: string },
  data: Record<string, unknown>
) => Promise<Record<string, unknown>>;
const upsertByIdentity = vi.fn<UpsertByIdentity>((_clientId, _identity, data) =>
  Promise.resolve({ id: 'ct-clay-1', ...data })
);
vi.mock('../services/contact.service.js', () => ({
  contactService: { upsertByIdentity },
}));

const { clayLeadRoute } = await import('../routes/webhooks/clay-lead.route.js');

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(clayLeadRoute);
  return app;
}

function post(app: FastifyInstance, body: unknown, secret: string | null = SECRET) {
  return app.inject({
    method: 'POST',
    url: '/webhooks/clay/lead',
    headers: {
      'content-type': 'application/json',
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
    },
    payload: JSON.stringify(body),
  });
}

const FULL_LEAD = {
  recordId: 'clay-row-42',
  fullName: 'Sarah Mitchell',
  email: 'Sarah@BrightSmile.com',
  phone: '(904) 760-5971',
  company: 'BrightSmile Dental',
  jobTitle: 'Practice Manager',
  industry: 'Dental',
  callVolume: '220',
  interest: 'Hot',
  value: 3600,
  linkedinUrl: 'https://linkedin.com/in/sarahmitchell',
  notes: 'Runs 3 locations, currently uses an answering service.',
};

describe('POST /webhooks/clay/lead — auth', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    vi.clearAllMocks();
    connRow = { id: 'conn1', crm_type: 'gohighlevel', crm_config: {}, needs_reauth: false };
    app = await buildApp();
  });

  it('rejects a request with no secret', async () => {
    const res = await post(app, FULL_LEAD, null);
    expect(res.statusCode).toBe(401);
    expect(crmAdd).not.toHaveBeenCalled();
  });

  it('rejects a wrong secret', async () => {
    const res = await post(app, FULL_LEAD, 'not-the-right-secret-value');
    expect(res.statusCode).toBe(401);
    expect(crmAdd).not.toHaveBeenCalled();
  });

  it('accepts the secret via X-Clay-Secret as well as Authorization', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/clay/lead',
      headers: { 'content-type': 'application/json', 'x-clay-secret': SECRET },
      payload: JSON.stringify(FULL_LEAD),
    });
    expect(res.statusCode).toBe(202);
  });
});

describe('POST /webhooks/clay/lead — ingest', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    vi.clearAllMocks();
    connRow = { id: 'conn1', crm_type: 'gohighlevel', crm_config: {}, needs_reauth: false };
    app = await buildApp();
  });

  it('creates the contact and queues an opportunity + note', async () => {
    const res = await post(app, FULL_LEAD);
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ queued: true, contactId: 'ct-clay-1' });

    // Contact: split name, normalized phone/email, enrichment as custom fields.
    expect(upsertByIdentity).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      { phone: '+19047605971', email: 'sarah@brightsmile.com' },
      expect.objectContaining({
        first_name: 'Sarah',
        last_name: 'Mitchell',
        company: 'BrightSmile Dental',
        tags: expect.arrayContaining(['clay', 'outbound-lead']),
        custom_fields: {
          'Company Industry': 'Dental',
          'Current Call Volume': '220',
          'Interest Level': 'Hot',
        },
      })
    );

    const leadJob = crmAdd.mock.calls.find((c) => c[0] === 'clay-lead');
    expect(leadJob?.[1]).toMatchObject({
      entityType: 'lead',
      entityId: 'ct-clay-1',
      crmConnectionId: 'conn1',
      payload: {
        contactId: 'ct-clay-1',
        title: 'BrightSmile Dental — Outbound Lead',
        source: 'clay-outbound',
        value: 3600,
      },
    });

    const noteJob = crmAdd.mock.calls.find((c) => c[0] === 'clay-lead-note');
    expect(noteJob?.[1]).toMatchObject({ entityType: 'note' });
    const noteBody = (noteJob?.[1].payload as { body: string }).body;
    expect(noteBody).toContain('Runs 3 locations');
    expect(noteBody).toContain('linkedin.com/in/sarahmitchell');
  });

  it('is idempotent per Clay row — the same row reuses the same job id', async () => {
    await post(app, FULL_LEAD);
    const firstJobId = crmAdd.mock.calls.find((c) => c[0] === 'clay-lead')?.[2].jobId;
    crmAdd.mockClear();

    await post(app, { ...FULL_LEAD, value: 9999 });
    const secondJobId = crmAdd.mock.calls.find((c) => c[0] === 'clay-lead')?.[2].jobId;

    expect(secondJobId).toBeTruthy();
    expect(secondJobId).toBe(firstJobId);
  });

  it('accepts an email-only lead (no phone) — outbound rows often have no number', async () => {
    const res = await post(app, { fullName: 'James Porter', email: 'james@porterlaw.com' });
    expect(res.statusCode).toBe(202);
    expect(upsertByIdentity).toHaveBeenCalledWith(
      expect.any(String),
      { phone: undefined, email: 'james@porterlaw.com' },
      expect.objectContaining({ first_name: 'James', last_name: 'Porter' })
    );
  });

  it('treats Clay blank cells ("") as absent rather than invalid input', async () => {
    const res = await post(app, {
      fullName: 'Elena Vasquez',
      email: 'elena@glowmedspa.com',
      phone: '',
      industry: '',
      callVolume: '',
      notes: '',
    });
    expect(res.statusCode).toBe(202);
    // No enrichment to write, so custom_fields is left untouched entirely.
    const contactData = upsertByIdentity.mock.calls[0][2];
    expect(contactData.custom_fields).toBeUndefined();
    // Nothing rep-facing to record, so no note job was queued.
    expect(crmAdd.mock.calls.some((c) => c[0] === 'clay-lead-note')).toBe(false);
  });

  it('rejects a lead with neither email nor phone', async () => {
    // Zod throws; app.ts's error handler maps ZodError to 400 in the real app,
    // so here just assert the request failed and nothing was written.
    const res = await post(app, { fullName: 'No Contact Info', company: 'Ghost Co' });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(upsertByIdentity).not.toHaveBeenCalled();
    expect(crmAdd).not.toHaveBeenCalled();
  });

  it('routes outbound to its own pipeline/stage when the connection configures one', async () => {
    connRow = {
      id: 'conn1',
      crm_type: 'gohighlevel',
      needs_reauth: false,
      crm_config: {
        outboundPipelineId: 'pipe_out',
        outboundStageId: 'stage_new',
        outboundOpportunityLabel: 'AI Voice Agent',
      },
    };
    await post(app, FULL_LEAD);
    expect(crmAdd.mock.calls.find((c) => c[0] === 'clay-lead')?.[1]).toMatchObject({
      payload: {
        pipelineId: 'pipe_out',
        stageId: 'stage_new',
        title: 'BrightSmile Dental — AI Voice Agent',
      },
    });
  });

  it('honours per-connection custom field naming', async () => {
    connRow = {
      id: 'conn1',
      crm_type: 'gohighlevel',
      needs_reauth: false,
      crm_config: { clayFieldNames: { industry: 'Vertical' } },
    };
    await post(app, FULL_LEAD);
    expect(upsertByIdentity.mock.calls[0][2].custom_fields).toMatchObject({ Vertical: 'Dental' });
  });

  it('404s when the client has no active CRM connection', async () => {
    connRow = null;
    const res = await post(app, FULL_LEAD);
    expect(res.statusCode).toBe(404);
    expect(crmAdd).not.toHaveBeenCalled();
  });

  it('409s when the CRM connection needs re-authorization', async () => {
    connRow = { id: 'conn1', crm_type: 'gohighlevel', crm_config: {}, needs_reauth: true };
    const res = await post(app, FULL_LEAD);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/re-authorization/);
    expect(crmAdd).not.toHaveBeenCalled();
  });
});
