import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ICrmAdapter } from '../crm/crm.interface.js';
import type { CrmConnection } from '../types/index.js';

// Fully mocked: no live GoHighLevel / Supabase / Retell calls. This exercises
// the branch logic of runBookingAutomation in isolation.

// Contact lookup used by resolveCrmContactId — pre-linked so the adapter is
// never called to (re)create the contact.
let contactRow: Record<string, unknown> | null = null;
vi.mock('../db/index.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: contactRow })) })),
        })),
      })),
      update: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })) })),
    })),
  },
}));

// Avoid opening real Redis / CRM plugin side effects when the worker loads.
vi.mock('../queues/index.js', () => ({ redis: {} }));
vi.mock('../crm/index.js', () => ({
  getCrmAdapter: vi.fn(() => ({})),
  resolveAdapterConfig: vi.fn(async () => ({})),
}));
vi.mock('../crm/ghl-provisioning.service.js', () => ({
  ghlProvisioningService: { applyBlueprint: vi.fn() },
  markRunManualReview: vi.fn(),
  loadProvisionRun: vi.fn(),
}));

// The GHL write client — every method a spy so nothing hits the network.
const ghl = {
  addContactTags: vi.fn(async () => ['appointment-booked']),
  createContactTask: vi.fn(async () => ({ id: 'task-1' })),
  searchOpportunitiesByContact: vi.fn(async () => [{ id: 'opp-1', name: 'Deal', pipelineId: 'pipe-1' }]),
  moveOpportunityStage: vi.fn(async () => undefined),
};
vi.mock('../crm/ghl-provisioning-client.js', () => ({
  // Regular function (not an arrow) so `new GhlProvisioningClient()` works;
  // returning an object from a constructor yields that object.
  GhlProvisioningClient: vi.fn(function () {
    return ghl;
  }),
}));

const { runBookingAutomation } = await import('../workers/crm-sync.worker.js');

const adapter = { name: 'gohighlevel' } as unknown as ICrmAdapter;
const ghlConn = { crm_type: 'gohighlevel' } as unknown as CrmConnection;
const payload = { contactId: 'internal-1', title: 'Marketing Call' };

function config(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { accessToken: 'tok', locationId: 'loc', ...over };
}

describe('runBookingAutomation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contactRow = {
      id: 'internal-1', client_id: 'c1', external_crm_id: 'ghl-contact-1',
      first_name: 'Jordan', last_name: 'Rivera', phone: '+15550300000',
    };
  });

  it('tags, tasks, and advances the opportunity to the configured booked stage', async () => {
    const res = await runBookingAutomation(ghlConn, 'c1', adapter, config({ bookedStageId: 'stage-booked' }), payload);

    expect(ghl.addContactTags).toHaveBeenCalledWith('ghl-contact-1', ['appointment-booked']);
    expect(ghl.createContactTask).toHaveBeenCalledWith(
      'ghl-contact-1',
      expect.stringContaining('Marketing Call'),
      expect.any(Date)
    );
    expect(ghl.moveOpportunityStage).toHaveBeenCalledWith('opp-1', 'stage-booked');
    expect(res).toEqual({ success: true, externalId: 'opp-1' });
  });

  it('uses configured bookedTags instead of the default', async () => {
    await runBookingAutomation(ghlConn, 'c1', adapter, config({ bookedStageId: 's', bookedTags: ['booked', 'vip'] }), payload);
    expect(ghl.addContactTags).toHaveBeenCalledWith('ghl-contact-1', ['booked', 'vip']);
  });

  it('skips the opportunity move when no bookedStageId is configured', async () => {
    const res = await runBookingAutomation(ghlConn, 'c1', adapter, config(), payload);

    expect(ghl.addContactTags).toHaveBeenCalledOnce();
    expect(ghl.createContactTask).toHaveBeenCalledOnce();
    expect(ghl.searchOpportunitiesByContact).not.toHaveBeenCalled();
    expect(ghl.moveOpportunityStage).not.toHaveBeenCalled();
    // No opportunity moved → falls back to the contact id as the reference.
    expect(res).toEqual({ success: true, externalId: 'ghl-contact-1' });
  });

  it('still tags/tasks when the contact has no opportunity to advance', async () => {
    ghl.searchOpportunitiesByContact.mockResolvedValueOnce([]);
    const res = await runBookingAutomation(ghlConn, 'c1', adapter, config({ bookedStageId: 'stage-booked' }), payload);

    expect(ghl.addContactTags).toHaveBeenCalledOnce();
    expect(ghl.moveOpportunityStage).not.toHaveBeenCalled();
    expect(res).toEqual({ success: true, externalId: 'ghl-contact-1' });
  });

  it('no-ops (no GHL calls) for non-GoHighLevel connections', async () => {
    const hubspotConn = { crm_type: 'hubspot' } as unknown as CrmConnection;
    const res = await runBookingAutomation(hubspotConn, 'c1', adapter, config({ bookedStageId: 's' }), payload);

    expect(ghl.addContactTags).not.toHaveBeenCalled();
    expect(ghl.moveOpportunityStage).not.toHaveBeenCalled();
    expect(res.success).toBe(true);
    expect(res.metadata?.skipped).toContain('hubspot');
  });
});
