import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CrmConnection, GhlBlueprint } from '../types/index.js';

// ── DB mock: crm_sync_logs run row (load + upsert) and crm_connections update ──
const state: { runRow: Record<string, unknown> | null } = { runRow: null };
const runUpserts: Array<Record<string, unknown>> = [];
const connUpdates: Array<Record<string, unknown>> = [];

vi.mock('../db/index.js', () => {
  const runSelectChain = {
    eq: vi.fn(() => runSelectChain),
    maybeSingle: vi.fn(async () => ({ data: state.runRow })),
  };
  return {
    supabase: {
      from: vi.fn((table: string) => {
        if (table === 'crm_sync_logs') {
          return {
            select: vi.fn(() => runSelectChain),
            upsert: vi.fn(async (row: Record<string, unknown>) => {
              runUpserts.push(row);
              state.runRow = row;
              return { error: null };
            }),
          };
        }
        if (table === 'crm_connections') {
          return {
            update: vi.fn((payload: Record<string, unknown>) => ({
              eq: vi.fn(async () => {
                connUpdates.push(payload);
                return { error: null };
              }),
            })),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    },
  };
});

vi.mock('../crm/credentials.js', () => ({
  resolveAdapterConfig: vi.fn(async () => ({ accessToken: 'at', locationId: 'loc_1' })),
}));

const publishedEvents: Array<{ type: string; payload: Record<string, unknown> }> = [];
vi.mock('../events/index.js', () => ({
  eventBus: {
    publish: vi.fn(async (event: { type: string; payload: Record<string, unknown> }) => {
      publishedEvents.push(event);
      return event;
    }),
  },
}));

// ── Provisioning client mock: shared instance the service constructs ──
const mockClient = {
  listPipelines: vi.fn(),
  createPipeline: vi.fn(),
  updatePipelineStages: vi.fn(),
  listCustomFields: vi.fn(),
  createCustomField: vi.fn(),
  listTags: vi.fn(),
  createTag: vi.fn(),
  upsertContact: vi.fn(),
  searchOpportunitiesByContact: vi.fn(),
  createOpportunity: vi.fn(),
};

vi.mock('../crm/ghl-provisioning-client.js', () => {
  class GhlApiError extends Error {
    constructor(message: string, readonly status?: number, readonly body?: unknown) {
      super(message);
      this.name = 'GhlApiError';
    }
  }
  class GhlAuthError extends GhlApiError {
    constructor(message: string, body?: unknown) {
      super(message, 401, body);
      this.name = 'GhlAuthError';
    }
  }
  return {
    GhlApiError,
    GhlAuthError,
    // Must be `new`-able: a plain function returning an object works as a constructor.
    GhlProvisioningClient: vi.fn(function () {
      return mockClient;
    }),
  };
});

const { ghlProvisioningService } = await import('../crm/ghl-provisioning.service.js');
const { GhlAuthError } = await import('../crm/ghl-provisioning-client.js');

const conn = { id: 'conn_1', crm_type: 'gohighlevel' } as CrmConnection;

function blueprint(): GhlBlueprint {
  return {
    name: 'test-bp',
    pipeline: { name: 'Sales', stages: ['New', 'Won'] },
    customFields: [{ name: 'Interest', dataType: 'SINGLE_OPTIONS', options: ['Hot', 'Cold'] }],
    tags: ['inbound'],
    demoLeads: [
      {
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@acme.example.com',
        phone: '+15550100001',
        customFields: { Interest: 'Hot' },
        opportunity: { name: 'Acme', stage: 'New', monetaryValue: 100 },
      },
    ],
  };
}

const fullPipeline = {
  id: 'p1',
  name: 'Sales',
  stages: [
    { id: 's1', name: 'New' },
    { id: 's2', name: 'Won' },
  ],
};

function apply(bp = blueprint(), attempt = 1) {
  return ghlProvisioningService.applyBlueprint({
    clientId: 'client_1',
    runId: 'run_1',
    blueprint: bp,
    conn,
    attempt,
  });
}

beforeEach(() => {
  state.runRow = null;
  runUpserts.length = 0;
  connUpdates.length = 0;
  publishedEvents.length = 0;
  for (const fn of Object.values(mockClient)) fn.mockReset();
});

describe('applyBlueprint — happy path', () => {
  it('creates everything on an empty location and completes the run', async () => {
    mockClient.listPipelines
      .mockResolvedValueOnce([]) // pipeline step: nothing yet
      .mockResolvedValue([fullPipeline]); // re-list + opportunities step
    mockClient.createPipeline.mockResolvedValue(fullPipeline);
    mockClient.listCustomFields
      .mockResolvedValueOnce([]) // customFields step
      .mockResolvedValue([{ id: 'f1', name: 'Interest', dataType: 'SINGLE_OPTIONS' }]);
    mockClient.createCustomField.mockResolvedValue({ id: 'f1', name: 'Interest', dataType: 'SINGLE_OPTIONS' });
    mockClient.listTags.mockResolvedValue([]);
    mockClient.createTag.mockResolvedValue({ id: 't1', name: 'inbound' });
    mockClient.upsertContact.mockResolvedValue({ id: 'ct1', isNew: true });
    mockClient.searchOpportunitiesByContact.mockResolvedValue([]);
    mockClient.createOpportunity.mockResolvedValue({ id: 'o1' });

    const run = await apply();

    expect(run.status).toBe('success');
    expect(run.steps.map((s) => s.status)).toEqual(['success', 'success', 'success', 'success', 'success']);
    expect(mockClient.createPipeline).toHaveBeenCalledWith('Sales', ['New', 'Won']);
    expect(mockClient.upsertContact).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'jane@acme.example.com' }),
      [{ id: 'f1', field_value: 'Hot' }]
    );
    expect(mockClient.createOpportunity).toHaveBeenCalledWith(
      expect.objectContaining({ pipelineId: 'p1', pipelineStageId: 's1', contactId: 'ct1' })
    );
    expect(publishedEvents.map((e) => e.type)).toEqual(['crm.provision.started', 'crm.provision.completed']);
    // one persist per step + the final success persist
    expect(runUpserts.length).toBeGreaterThanOrEqual(5);
    expect(runUpserts.at(-1)).toMatchObject({ status: 'success', entity_id: 'run_1' });
  });

  it('re-apply on a provisioned location creates nothing', async () => {
    mockClient.listPipelines.mockResolvedValue([fullPipeline]);
    mockClient.listCustomFields.mockResolvedValue([{ id: 'f1', name: 'Interest', dataType: 'SINGLE_OPTIONS' }]);
    mockClient.listTags.mockResolvedValue([{ id: 't1', name: 'inbound' }]);
    mockClient.upsertContact.mockResolvedValue({ id: 'ct1', isNew: false });
    mockClient.searchOpportunitiesByContact.mockResolvedValue([{ id: 'o1', name: 'Acme', pipelineId: 'p1' }]);

    const run = await apply();

    expect(run.status).toBe('success');
    expect(mockClient.createPipeline).not.toHaveBeenCalled();
    expect(mockClient.updatePipelineStages).not.toHaveBeenCalled();
    expect(mockClient.createCustomField).not.toHaveBeenCalled();
    expect(mockClient.createTag).not.toHaveBeenCalled();
    expect(mockClient.createOpportunity).not.toHaveBeenCalled();
    const totals = run.steps.reduce((sum, s) => sum + s.created, 0);
    expect(totals).toBe(0);
  });
});

describe('applyBlueprint — pipeline update', () => {
  it('appends missing stages while retaining every existing stage id in order', async () => {
    const partial = { id: 'p1', name: 'Sales', stages: [{ id: 's1', name: 'New' }] };
    mockClient.listPipelines
      .mockResolvedValueOnce([partial])
      .mockResolvedValue([fullPipeline]);
    mockClient.listCustomFields.mockResolvedValue([{ id: 'f1', name: 'Interest', dataType: 'SINGLE_OPTIONS' }]);
    mockClient.listTags.mockResolvedValue([{ id: 't1', name: 'inbound' }]);
    mockClient.upsertContact.mockResolvedValue({ id: 'ct1', isNew: false });
    mockClient.searchOpportunitiesByContact.mockResolvedValue([{ id: 'o1', name: 'Acme', pipelineId: 'p1' }]);

    await apply();

    expect(mockClient.updatePipelineStages).toHaveBeenCalledWith('p1', 'Sales', [
      { id: 's1', name: 'New', position: 0 },
      { name: 'Won', position: 1 },
    ]);
  });
});

describe('applyBlueprint — resume', () => {
  it('skips steps already recorded successful and reruns the rest', async () => {
    state.runRow = {
      status: 'failed',
      error_message: 'boom',
      payload: {
        blueprintName: 'test-bp',
        steps: [
          { step: 'pipeline', status: 'success', created: 1, updated: 0, skipped: 0, detail: { pipelineId: 'p1' } },
          { step: 'customFields', status: 'success', created: 1, updated: 0, skipped: 0 },
          { step: 'tags', status: 'failed', created: 0, updated: 0, skipped: 0, error: 'boom' },
          { step: 'demoLeads', status: 'pending', created: 0, updated: 0, skipped: 0 },
          { step: 'opportunities', status: 'pending', created: 0, updated: 0, skipped: 0 },
        ],
      },
    };
    mockClient.listPipelines.mockResolvedValue([fullPipeline]);
    mockClient.listCustomFields.mockResolvedValue([{ id: 'f1', name: 'Interest', dataType: 'SINGLE_OPTIONS' }]);
    mockClient.listTags.mockResolvedValue([]);
    mockClient.createTag.mockResolvedValue({ id: 't1', name: 'inbound' });
    mockClient.upsertContact.mockResolvedValue({ id: 'ct1', isNew: true });
    mockClient.searchOpportunitiesByContact.mockResolvedValue([]);
    mockClient.createOpportunity.mockResolvedValue({ id: 'o1' });

    const run = await apply(blueprint(), 2);

    expect(run.status).toBe('success');
    // completed steps untouched
    expect(mockClient.createPipeline).not.toHaveBeenCalled();
    expect(mockClient.createCustomField).not.toHaveBeenCalled();
    // failed/pending steps rerun
    expect(mockClient.createTag).toHaveBeenCalledWith('inbound');
    expect(mockClient.createOpportunity).toHaveBeenCalled();
  });
});

describe('applyBlueprint — failure handling', () => {
  it('401 flags the connection, parks the run for manual review and stops retries', async () => {
    mockClient.listPipelines.mockRejectedValue(new GhlAuthError('token revoked'));

    await expect(apply()).rejects.toMatchObject({ name: 'UnrecoverableError' });

    expect(connUpdates).toContainEqual({ needs_reauth: true });
    expect(runUpserts.at(-1)).toMatchObject({ status: 'manual_review' });
    expect(publishedEvents.map((e) => e.type)).toContain('crm.provision.failed');
  });

  it('other step failures persist the failed step and rethrow for BullMQ retry', async () => {
    mockClient.listPipelines.mockResolvedValue([fullPipeline]);
    mockClient.listCustomFields.mockRejectedValue(new Error('GHL 500'));

    await expect(apply()).rejects.toThrow('GHL 500');

    expect(connUpdates).toEqual([]);
    const last = runUpserts.at(-1) as { status: string; payload: { steps: Array<{ step: string; status: string; error?: string }> } };
    expect(last.status).toBe('failed');
    const fieldStep = last.payload.steps.find((s) => s.step === 'customFields');
    expect(fieldStep).toMatchObject({ status: 'failed', error: 'GHL 500' });
    // pipeline step already succeeded — resume will skip it
    expect(last.payload.steps.find((s) => s.step === 'pipeline')?.status).toBe('success');
  });

  it('skips same-name custom fields with a different dataType and records a warning', async () => {
    mockClient.listPipelines.mockResolvedValue([fullPipeline]);
    mockClient.listCustomFields.mockResolvedValue([{ id: 'f1', name: 'Interest', dataType: 'TEXT' }]);
    mockClient.listTags.mockResolvedValue([{ id: 't1', name: 'inbound' }]);
    mockClient.upsertContact.mockResolvedValue({ id: 'ct1', isNew: false });
    mockClient.searchOpportunitiesByContact.mockResolvedValue([{ id: 'o1', name: 'Acme', pipelineId: 'p1' }]);

    const run = await apply();

    expect(mockClient.createCustomField).not.toHaveBeenCalled();
    const step = run.steps.find((s) => s.step === 'customFields');
    expect(step?.skipped).toBe(1);
    expect(JSON.stringify(step?.detail)).toContain('left unchanged');
  });
});
