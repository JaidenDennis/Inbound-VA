import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ICrmAdapter } from '../crm/crm.interface.js';

// ── Configurable supabase mock ────────────────────────────────────────────────
let contactRow: Record<string, unknown> | null = null;
const updateSpy = vi.fn();

vi.mock('../db/index.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: contactRow }),
          })),
        })),
      })),
      update: vi.fn((patch: Record<string, unknown>) => {
        updateSpy(patch);
        return { eq: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })) };
      }),
    })),
  },
}));

// Avoid opening a real Redis connection when the worker module loads.
vi.mock('../queues/index.js', () => ({ redis: {} }));

const { resolveCrmContactId } = await import('../workers/crm-sync.worker.js');

function makeAdapter(over: Partial<ICrmAdapter> = {}): ICrmAdapter {
  return {
    name: 'mock',
    createOrUpdateContact: vi.fn().mockResolvedValue({ success: true, externalId: 'crm-123' }),
    createLead: vi.fn(), createNote: vi.fn(), createTask: vi.fn(),
    createAppointment: vi.fn(), updateConversation: vi.fn(),
    pushTranscript: vi.fn(), pushCallSummary: vi.fn(),
    testConnection: vi.fn().mockResolvedValue(true),
    ...over,
  } as ICrmAdapter;
}

describe('resolveCrmContactId', () => {
  beforeEach(() => {
    contactRow = null;
    updateSpy.mockClear();
  });

  it('returns the stored CRM id without re-syncing', async () => {
    contactRow = { id: 'internal-1', client_id: 'c1', external_crm_id: 'crm-existing', first_name: 'A', last_name: 'B', phone: '+1' };
    const adapter = makeAdapter();
    const id = await resolveCrmContactId(adapter, 'c1', 'internal-1');
    expect(id).toBe('crm-existing');
    expect(adapter.createOrUpdateContact).not.toHaveBeenCalled();
  });

  it('syncs the contact and saves the returned CRM id when missing', async () => {
    contactRow = { id: 'internal-1', client_id: 'c1', external_crm_id: null, first_name: 'Jane', last_name: 'Doe', email: 'j@x.com', phone: '+15551112222' };
    const adapter = makeAdapter();
    const id = await resolveCrmContactId(adapter, 'c1', 'internal-1');
    expect(id).toBe('crm-123');
    expect(adapter.createOrUpdateContact).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: 'Jane', lastName: 'Doe', phone: '+15551112222' })
    );
    expect(updateSpy).toHaveBeenCalledWith({ external_crm_id: 'crm-123' });
  });

  it('falls back to the internal id for forwarder adapters that return no id', async () => {
    contactRow = { id: 'internal-1', client_id: 'c1', external_crm_id: null, first_name: 'A', last_name: 'B', phone: '+1' };
    const adapter = makeAdapter({ createOrUpdateContact: vi.fn().mockResolvedValue({ success: true }) });
    const id = await resolveCrmContactId(adapter, 'c1', 'internal-1');
    expect(id).toBe('internal-1');
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('throws when the contact does not exist', async () => {
    contactRow = null;
    await expect(resolveCrmContactId(makeAdapter(), 'c1', 'missing')).rejects.toThrow(/Contact not found/);
  });

  it('throws when the CRM contact sync fails (so the job retries)', async () => {
    contactRow = { id: 'internal-1', client_id: 'c1', external_crm_id: null, first_name: 'A', last_name: 'B', phone: '+1' };
    const adapter = makeAdapter({ createOrUpdateContact: vi.fn().mockResolvedValue({ success: false, error: 'CRM down' }) });
    await expect(resolveCrmContactId(adapter, 'c1', 'internal-1')).rejects.toThrow(/CRM down/);
  });
});
