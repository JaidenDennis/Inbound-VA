import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import CryptoJS from 'crypto-js';

// Phase 4 — lead capture: qualify_lead pushes the lead into the CRM pipeline
// and alerts staff; forms_send delivers intake forms by email with a staff
// fallback so nothing is dropped.

const clientObj = { id: 'c1', name: 'Glow', timezone: 'America/New_York' };
let settingsObj: Record<string, unknown>;

vi.mock('../services/index.js', () => ({
  clientService: {
    findByPhoneNumber: vi.fn(() => Promise.resolve(clientObj)),
    findByAgentId: vi.fn(() => Promise.resolve(clientObj)),
    getSettings: vi.fn(() => Promise.resolve(settingsObj)),
  },
  contactService: {
    findByPhone: vi.fn(() => Promise.resolve(null)),
    upsertByPhone: vi.fn(() => Promise.resolve({ id: 'ct1', first_name: 'Jane', last_name: 'Doe' })),
  },
  callService: { findByRetellId: vi.fn(() => Promise.resolve({ id: 'call1', client_id: 'c1', contact_id: 'ct1' })) },
  knowledgeService: { settingsWithKnowledge: vi.fn((_id: string, s: unknown) => Promise.resolve(s)) },
}));

const notifAdd = vi.fn(() => Promise.resolve(undefined));
const crmAdd = vi.fn(() => Promise.resolve(undefined));
vi.mock('../queues/index.js', () => ({
  notificationsQueue: { add: notifAdd },
  crmSyncQueue: { add: crmAdd },
}));
vi.mock('../booking/index.js', () => ({ bookingService: {} }));

let activeConn: { id: string } | null = { id: 'conn1' };
const staffInserts: Array<Record<string, unknown>> = [];
vi.mock('../db/index.js', () => ({
  supabase: {
    from: vi.fn((table: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(() =>
              Promise.resolve({ data: table === 'crm_connections' ? activeConn : null, error: null })
            ),
          })),
          maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
        })),
      })),
      insert: vi.fn((row: Record<string, unknown>) => {
        if (table === 'staff_notifications') staffInserts.push(row);
        return Promise.resolve({ error: null });
      }),
    })),
  },
}));

const { retellFunctionRoutes } = await import('../routes/functions/retell-functions.route.js');
const { resolveWorkflowByIntent } = await import('../workflows/index.js');

function sign(rawBody: string, now = Date.now()): string {
  const d = CryptoJS.HmacSHA256(rawBody + now, process.env.RETELL_API_KEY as string).toString(CryptoJS.enc.Hex);
  return `v=${now},d=${d}`;
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    (req as unknown as { rawBody: string }).rawBody = body as string;
    done(null, body ? JSON.parse(body as string) : {});
  });
  await app.register(retellFunctionRoutes);
  return app;
}

async function callFn(app: FastifyInstance, name: string, args: Record<string, unknown>) {
  const raw = JSON.stringify({
    name,
    call: { call_id: 'rc-l1', from_number: '+19998887777', to_number: '+15551112222' },
    args,
  });
  return app.inject({
    method: 'POST',
    url: `/functions/retell/${name}`,
    headers: { 'content-type': 'application/json', 'x-retell-signature': sign(raw) },
    payload: raw,
  });
}

describe('qualify_lead (CRM pipeline + staff notify)', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    vi.clearAllMocks();
    staffInserts.length = 0;
    activeConn = { id: 'conn1' };
    settingsObj = { notification_emails: ['owner@glow.com'], agent_config: {} };
    app = await buildApp();
  });

  it('captures the lead, enqueues the CRM lead sync, and alerts staff', async () => {
    const res = await callFn(app, 'qualify_lead', {
      name: 'Jane Doe',
      phone: '+19998887777',
      email: 'jane@x.com',
      service_interest: 'Botox',
    });
    expect(res.json().qualified).toBe(true);
    expect(crmAdd).toHaveBeenCalledWith(
      'lead-capture',
      expect.objectContaining({
        entityType: 'lead',
        payload: expect.objectContaining({ contactId: 'ct1', title: 'Jane Doe — Botox', source: 'inbound-voice' }),
      }),
      // jobId is a hashed idempotency key (buildIdempotencyKey SHA-256s its parts).
      expect.objectContaining({ jobId: expect.any(String) })
    );
    expect(notifAdd).toHaveBeenCalledWith(
      'new-lead',
      expect.objectContaining({ type: 'lead', subject: expect.stringContaining('Jane Doe') }),
      expect.anything()
    );
  });

  it('skips the CRM sync when the client has no active connection', async () => {
    activeConn = null;
    const res = await callFn(app, 'qualify_lead', { name: 'Jane Doe', phone: '+19998887777', service_interest: 'Botox' });
    expect(res.json().qualified).toBe(true);
    expect(crmAdd).not.toHaveBeenCalled();
  });
});

describe('forms_send', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    vi.clearAllMocks();
    staffInserts.length = 0;
    settingsObj = {
      notification_emails: ['owner@glow.com'],
      agent_config: { intake_form_url: 'https://forms.glow.com/intake' },
    };
    app = await buildApp();
  });

  it('emails the forms link when the caller has an email and a link is configured', async () => {
    const res = await callFn(app, 'forms_send', {
      caller_name: 'Jane Doe',
      phone: '+19998887777',
      email: 'jane@x.com',
      form_type: 'intake',
    });
    expect(res.json().sent).toBe(true);
    expect(res.json().channel).toBe('email');
    expect(notifAdd).toHaveBeenCalledWith(
      'forms-send',
      expect.objectContaining({
        recipients: ['jane@x.com'],
        body: expect.stringContaining('https://forms.glow.com/intake'),
      }),
      expect.anything()
    );
    expect(staffInserts).toHaveLength(0);
  });

  it('falls back to a staff task when the caller has no email', async () => {
    const res = await callFn(app, 'forms_send', { caller_name: 'Jane Doe', phone: '+19998887777' });
    expect(res.json().sent).toBe(false);
    expect(res.json().channel).toBe('staff');
    expect(staffInserts).toHaveLength(1);
    expect(staffInserts[0]).toMatchObject({ type: 'lead', metadata: expect.objectContaining({ kind: 'forms' }) });
  });

  it('falls back to a staff task when no form link is configured', async () => {
    settingsObj = { notification_emails: [], agent_config: {} };
    const res = await callFn(app, 'forms_send', { caller_name: 'Jane', phone: '+19998887777', email: 'j@x.com' });
    expect(res.json().channel).toBe('staff');
    expect(notifAdd).not.toHaveBeenCalled();
  });
});

describe('lead workflow definitions', () => {
  it('routes lead intents with the crm scope', () => {
    expect(resolveWorkflowByIntent('lead_qualification')?.id).toBe('lead_qualification');
    expect(resolveWorkflowByIntent('new_patient')?.id).toBe('new_client_intake');
    expect(resolveWorkflowByIntent('paperwork')?.id).toBe('intake_forms');
    expect(resolveWorkflowByIntent('lead_qualification')?.scopes).toContain('crm');
    // Consent is validated: an explicit yes is required.
    const consent = resolveWorkflowByIntent('new_patient')?.slots.find((s) => s.name === 'consent');
    expect(consent?.validate?.('no', { settings: null, timezone: 'UTC', now: new Date() })).toMatch(/explicit yes/);
    expect(consent?.validate?.('yes', { settings: null, timezone: 'UTC', now: new Date() })).toBeNull();
  });
});
