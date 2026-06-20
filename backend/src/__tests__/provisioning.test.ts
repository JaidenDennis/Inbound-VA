import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock the Retell SDK wrapper (no real network) ────────────────────────────
const agent = {
  createOrUpdateResponseEngine: vi.fn().mockResolvedValue('llm_new'),
  createOrUpdateAgent: vi.fn().mockResolvedValue({ agentId: 'ag_new', version: 1 }),
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

// ── Mock supabase (capture clients.update) ───────────────────────────────────
const clientUpdate = vi.fn();
vi.mock('../db/index.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      update: vi.fn((patch: Record<string, unknown>) => {
        clientUpdate(patch);
        return { eq: vi.fn().mockResolvedValue({ error: null }) };
      }),
      upsert: vi.fn().mockResolvedValue({ error: null }),
    })),
  },
}));

const { provisioningService } = await import('../services/provisioning.service.js');

describe('ProvisioningService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agent.createOrUpdateResponseEngine.mockResolvedValue('llm_new');
    agent.createOrUpdateAgent.mockResolvedValue({ agentId: 'ag_new', version: 1 });
    agent.purchaseNumber.mockResolvedValue('+14159990000');
    clientRow = { ...baseClient };
  });

  it('CREATES a new agent when the client has none, with config-driven URLs', async () => {
    const res = await provisioningService.provisionClient('c1');

    expect(res.agentId).toBe('ag_new');
    expect(res.llmId).toBe('llm_new');
    expect(res.vertical).toBe('med_spa');

    // Response engine built from the template; tool URLs point at our functions.
    const [spec, existingLlm] = agent.createOrUpdateResponseEngine.mock.calls[0];
    expect(existingLlm).toBeNull();
    expect(spec.general_tools.map((t: { name: string }) => t.name)).toContain('book_appointment');
    expect(spec.general_tools[0].url).toContain('/functions/retell/');
    expect(spec.general_prompt).toContain('Glow Med Spa');

    // Agent points its webhook at the single dispatcher; create path (no existing id).
    const agentArg = agent.createOrUpdateAgent.mock.calls[0][0];
    expect(agentArg.existingAgentId).toBeNull();
    expect(agentArg.webhookUrl).toContain('/webhooks/retell');

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

    expect(agent.createOrUpdateResponseEngine.mock.calls[0][1]).toBe('llm_existing');
    expect(agent.createOrUpdateAgent.mock.calls[0][0].existingAgentId).toBe('ag_existing');
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
