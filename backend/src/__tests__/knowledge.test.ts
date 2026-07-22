import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import CryptoJS from 'crypto-js';

// ─── Fixtures: two tenants with different knowledge (isolation test) ─────────
// Promotion windows are clock-relative so the suite never rots with the calendar.
function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

const tables: Record<string, Array<Record<string, unknown>>> = {
  'faqs:c1': [
    { question: 'Do you accept insurance?', answer: 'We accept most major insurance plans.', category: 'billing', active: true },
    { question: 'Where do I park?', answer: 'Free parking behind the building.', category: 'visit', active: true },
  ],
  'services:c1': [
    { name: 'Botox', description: 'Wrinkle relaxer treatment', duration_minutes: 30, price: 250 },
  ],
  'pricing:c1': [
    { name: 'Botox', price: 250, member_price: 199, unit: 'area', notes: 'Starting price', upsell_note: '3-area package saves 15%' },
  ],
  'promotions:c1': [
    { title: 'Summer Glow', description: '20% off facials this month', eligibility: 'New clients only', starts_at: daysFromNow(-7), ends_at: daysFromNow(7) },
    { title: 'Expired Deal', description: 'Old promo', eligibility: null, starts_at: daysFromNow(-60), ends_at: daysFromNow(-30) },
    { title: 'Future Deal', description: 'Not yet live', eligibility: null, starts_at: daysFromNow(30), ends_at: null },
    { title: 'Evergreen Referral', description: 'Refer a friend, get $25 credit', eligibility: null, starts_at: null, ends_at: null },
  ],
  'faqs:c2': [
    { question: 'Do you accept insurance?', answer: 'No — we are cash pay only.', category: 'billing', active: true },
  ],
};

vi.mock('../db/index.js', () => ({
  supabase: {
    from: vi.fn((table: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn((_col: string, clientId: string) => ({
          eq: vi.fn(() => Promise.resolve({ data: tables[`${table}:${clientId}`] ?? [], error: null })),
          // Scope guard's call_sessions lookup → no session (legacy passthrough).
          maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
        })),
      })),
      insert: vi.fn(() => Promise.resolve({ error: null })),
    })),
  },
}));

const clients: Record<string, { id: string; name: string; timezone: string }> = {
  '+15550000001': { id: 'c1', name: 'Glow Spa', timezone: 'America/New_York' },
  '+15550000002': { id: 'c2', name: 'Cash Clinic', timezone: 'America/Chicago' },
};

vi.mock('../services/client.service.js', () => ({
  clientService: {
    findByPhoneNumber: vi.fn((n: string) => Promise.resolve(clients[n] ?? null)),
    findByAgentId: vi.fn(() => Promise.resolve(null)),
    getSettings: vi.fn(() => Promise.resolve({ services: [], pricing: [], faqs: [], booking_enabled: true })),
  },
  ClientService: class {},
}));

const NOW = new Date();

const { knowledgeService } = await import('../services/knowledge.service.js');
const { resolveWorkflowByIntent } = await import('../workflows/index.js');
const { retellFunctionRoutes } = await import('../routes/functions/retell-functions.route.js');

describe('KnowledgeService.load', () => {
  it('reads relational rows first and enforces promotion date windows', async () => {
    const k = await knowledgeService.load('c1', null, NOW);
    expect(k.services.map((s) => s.name)).toEqual(['Botox']);
    expect(k.pricing[0].member_price).toBe(199);
    expect(k.promotions.map((p) => p.title)).toEqual(['Summer Glow', 'Evergreen Referral']); // expired + future excluded
  });

  it('falls back to client_settings JSONB when a table has no rows', async () => {
    const settings = {
      services: [{ name: 'Legacy Facial', description: 'From JSONB', duration_minutes: 45 }],
      pricing: [],
      faqs: [{ question: 'Legacy?', answer: 'Yes.' }],
    } as never;
    const k = await knowledgeService.load('c-empty', settings, NOW);
    expect(k.services[0].name).toBe('Legacy Facial');
    expect(k.faqs[0].answer).toBe('Yes.');
    expect(k.promotions).toEqual([]);
  });

  it('isolates tenants — each client only sees its own knowledge', async () => {
    const a = await knowledgeService.load('c1', null, NOW);
    const b = await knowledgeService.load('c2', null, NOW);
    expect(a.faqs.find((f) => f.question.includes('insurance'))?.answer).toMatch(/most major insurance/);
    expect(b.faqs.find((f) => f.question.includes('insurance'))?.answer).toMatch(/cash pay only/);
    expect(b.services).toEqual([]);
  });
});

describe('KnowledgeService.search', () => {
  it('ranks the matching FAQ for a natural-language question', async () => {
    const res = await knowledgeService.search('c1', 'do you take insurance', null, NOW);
    expect(res.found).toBe(true);
    expect(res.faqs[0].answer).toMatch(/insurance plans/);
  });

  it('matches services and pricing by name', async () => {
    const res = await knowledgeService.search('c1', 'how much is botox', null, NOW);
    expect(res.services[0].name).toBe('Botox');
    expect(res.pricing[0].upsell_note).toMatch(/package/);
  });

  it('returns found:false when nothing matches', async () => {
    const res = await knowledgeService.search('c1', 'quantum flux capacitors', null, NOW);
    expect(res.found).toBe(false);
    expect(res.activePromotions.length).toBeGreaterThan(0); // still lists live offers separately
  });
});

describe('settingsWithKnowledge', () => {
  it('overlays relational knowledge without mutating the original settings', async () => {
    const original = { services: [], pricing: [], faqs: [], booking_enabled: true } as never;
    const merged = await knowledgeService.settingsWithKnowledge('c1', original);
    expect(merged.services.map((s: { name: string }) => s.name)).toEqual(['Botox']);
    expect((original as { services: unknown[] }).services).toEqual([]);
  });
});

describe('knowledge workflow definitions', () => {
  it('routes knowledge intents to their workflows with the knowledge scope', () => {
    expect(resolveWorkflowByIntent('hours')?.id).toBe('faq');
    expect(resolveWorkflowByIntent('pricing')?.id).toBe('pricing');
    expect(resolveWorkflowByIntent('specials')?.id).toBe('promotions');
    expect(resolveWorkflowByIntent('general_information')?.id).toBe('general_information');
    expect(resolveWorkflowByIntent('pricing')?.scopes).toContain('knowledge');
  });
});

// ─── knowledge_search endpoint ───────────────────────────────────────────────
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

async function search(app: FastifyInstance, toNumber: string, args: Record<string, unknown>) {
  const raw = JSON.stringify({
    name: 'knowledge_search',
    call: { call_id: 'rc-k1', from_number: '+19998887777', to_number: toNumber },
    args,
  });
  return app.inject({
    method: 'POST',
    url: '/functions/retell/knowledge_search',
    headers: { 'content-type': 'application/json', 'x-retell-signature': sign(raw) },
    payload: raw,
  });
}

describe('knowledge_search endpoint', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await buildApp();
  });

  it('answers from the calling tenant\'s knowledge only', async () => {
    const a = await search(app, '+15550000001', { query: 'do you take insurance' });
    expect(a.json().found).toBe(true);
    expect(a.json().faqs[0].answer).toMatch(/most major insurance/);

    const b = await search(app, '+15550000002', { query: 'do you take insurance' });
    expect(b.json().faqs[0].answer).toMatch(/cash pay only/);
  });

  it('lists every live promotion for the promotions topic (windows enforced)', async () => {
    const res = await search(app, '+15550000001', { query: 'any specials right now', topic: 'promotions' });
    const titles = res.json().promotions.map((p: { title: string }) => p.title);
    expect(titles).toContain('Summer Glow');
    expect(titles).toContain('Evergreen Referral');
    expect(titles).not.toContain('Expired Deal');
    expect(titles).not.toContain('Future Deal');
  });

  it('tells the agent not to guess when nothing matches', async () => {
    const res = await search(app, '+15550000002', { query: 'underwater basket weaving' });
    expect(res.json().found).toBe(false);
    expect(res.json().message).toMatch(/never guess/);
  });
});
