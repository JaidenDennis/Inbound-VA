import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock the Retell SDK wrapper (no real network) ────────────────────────────
// One call now covers the LLM write, the agent write and the publish: Retell
// requires them in a fixed order, so retell.agent.ts owns the sequence rather
// than exposing the steps for a caller to get wrong. See retell-agent-publish.
const agent = {
  provisionRetellAgent: vi
    .fn()
    .mockResolvedValue({ agentId: 'ag_new', llmId: 'llm_new', version: 1 }),
  setInboundAgent: vi.fn().mockResolvedValue(undefined),
  purchaseNumber: vi.fn().mockResolvedValue('+14159990000'),
};
vi.mock('../providers/retell/retell.agent.js', () => agent);

// ── Mock client + settings ───────────────────────────────────────────────────
const baseClient = {
  id: 'c1',
  name: 'Glow Med Spa',
  slug: 'glow',
  industry: 'beauty',
  timezone: 'America/New_York',
  phone_numbers: ['+15551112222'],
  status: 'active',
  retell_agent_id: null as string | null,
  retell_llm_id: null as string | null,
  retell_voice_id: null as string | null,
};
const settings = {
  client_id: 'c1',
  agent_prompt: '',
  agent_personality: 'warm',
  agent_tone: 'friendly',
  agent_response_style: 'concise',
  faqs: [],
  services: [{ name: 'Botox', description: 'wrinkle treatment', duration_minutes: 30, price: 300 }],
  pricing: [],
  business_policies: [],
  booking_enabled: true,
  booking_rules: {
    advance_booking_hours: 24,
    max_advance_booking_days: 60,
    buffer_minutes: 15,
    working_hours: {},
    blackout_dates: [],
    lead_qualification_required: false,
    lead_qualification_fields: ['skin_concern'],
  },
  notification_emails: ['staff@glow.com'],
  escalation_rules: [],
  crm_type: 'none',
  crm_config: {},
  custom_field_mapping: {},
};
let clientRow = { ...baseClient };
vi.mock('../services/client.service.js', () => ({
  clientService: {
    findById: vi.fn(() => Promise.resolve(clientRow)),
    getSettings: vi.fn(() => Promise.resolve(settings)),
  },
}));
vi.mock('../services/audit.service.js', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));
// Knowledge overlay is identity here — provisioning renders from settings as-is.
vi.mock('../services/knowledge.service.js', () => ({
  knowledgeService: {
    settingsWithKnowledge: vi.fn((_id: string, s: unknown) => Promise.resolve(s)),
  },
}));

// ── Mock supabase ────────────────────────────────────────────────────────────
// Captures clients.update and the agent_config_versions insert. A successful
// provision now also snapshots its configuration and stamps the sync state, so
// the mock has to answer the version lookup too.
const clientUpdate = vi.fn();
const versionInsert = vi.fn();
vi.mock('../db/index.js', () => ({
  supabase: {
    from: vi.fn((table: string) => ({
      update: vi.fn((patch: Record<string, unknown>) => {
        if (table === 'clients') clientUpdate(patch);
        return { eq: vi.fn().mockResolvedValue({ error: null }) };
      }),
      upsert: vi.fn().mockResolvedValue({ error: null }),
      insert: vi.fn((row: Record<string, unknown>) => {
        if (table === 'agent_config_versions') versionInsert(row);
        return Promise.resolve({ error: null });
      }),
      // Version lookup: no prior versions, so the next one is 1.
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => ({
            limit: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) })),
          })),
        })),
      })),
    })),
  },
}));

const { provisioningService } = await import('../services/provisioning.service.js');

describe('ProvisioningService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agent.provisionRetellAgent.mockResolvedValue({ agentId: 'ag_new', llmId: 'llm_new', version: 1 });
    agent.purchaseNumber.mockResolvedValue('+14159990000');
    clientRow = { ...baseClient };
  });

  it('snapshots the configuration that actually shipped', async () => {
    // Only successful provisions are recorded, so the history answers "what was
    // the agent running with on Tuesday" — otherwise unanswerable, because a bad
    // prompt degrades every call silently.
    await provisioningService.provisionClient('c1', { userId: 'u-staff' });

    expect(versionInsert).toHaveBeenCalledTimes(1);
    const row = versionInsert.mock.calls[0][0];
    expect(row).toMatchObject({
      client_id: 'c1',
      version: 1,
      retell_agent_id: 'ag_new',
      retell_agent_version: 1,
      vertical: 'med_spa',
      created_by: 'u-staff',
    });
    // The rendered prompt is stored verbatim — the snapshot is only useful if it
    // holds the text Retell received, not a reference to regenerate it from.
    expect(typeof row.rendered_prompt).toBe('string');
    expect((row.rendered_prompt as string).length).toBeGreaterThan(0);

    // And the client is marked in sync, which is what clears the dashboard badge.
    expect(clientUpdate).toHaveBeenCalledWith(expect.objectContaining({ agent_sync_state: 'synced' }));
  });

  it('CREATES a new agent when the client has none, with config-driven URLs', async () => {
    const res = await provisioningService.provisionClient('c1');

    expect(res.agentId).toBe('ag_new');
    expect(res.llmId).toBe('llm_new');
    expect(res.vertical).toBe('med_spa');

    // Response engine built from the template; tool URLs point at our functions.
    const call = agent.provisionRetellAgent.mock.calls[0][0];
    expect(call.existingLlmId).toBeNull();
    expect(call.responseEngine.general_tools.map((t: { name: string }) => t.name)).toContain('book_appointment');
    expect(call.responseEngine.general_tools[0].url).toContain('/functions/retell/');
    expect(call.responseEngine.general_prompt).toContain('Glow Med Spa');

    // Agent points its webhook at the single dispatcher; create path (no existing id).
    expect(call.existingAgentId).toBeNull();
    expect(call.webhookUrl).toContain('/webhooks/retell');

    // Persisted to the client row.
    expect(clientUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ retell_agent_id: 'ag_new', retell_llm_id: 'llm_new' })
    );
    // Existing number mapped to the agent.
    expect(agent.setInboundAgent).toHaveBeenCalledWith('+15551112222', 'ag_new');
  });

  it('UPDATES in place when the client already has agent + llm ids (idempotent)', async () => {
    clientRow = { ...baseClient, retell_agent_id: 'ag_existing', retell_llm_id: 'llm_existing' };

    await provisioningService.provisionClient('c1');

    expect(agent.provisionRetellAgent.mock.calls[0][0].existingLlmId).toBe('llm_existing');
    expect(agent.provisionRetellAgent.mock.calls[0][0].existingAgentId).toBe('ag_existing');
  });

  it('buys a number when buyAreaCode is provided', async () => {
    await provisioningService.provisionClient('c1', { buyAreaCode: 415 });
    expect(agent.purchaseNumber).toHaveBeenCalledWith({ areaCode: 415, agentId: 'ag_new' });
  });

  it('throws when the client does not exist', async () => {
    clientRow = null as never;
    await expect(provisioningService.provisionClient('missing')).rejects.toThrow(/Client not found/);
  });
});
