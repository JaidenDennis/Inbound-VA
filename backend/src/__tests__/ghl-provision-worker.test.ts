import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnrecoverableError, type Job } from 'bullmq';
import type { CrmSyncJob } from '../types/index.js';

const state: {
  conn: Record<string, unknown> | null;
  failedJobInserts: Array<Record<string, unknown>>;
} = { conn: null, failedJobInserts: [] };

vi.mock('../queues/index.js', () => ({ redis: {} }));

vi.mock('../db/index.js', () => {
  const connChain = {
    eq: vi.fn(() => connChain),
    single: vi.fn(async () =>
      state.conn ? { data: state.conn, error: null } : { data: null, error: { message: 'not found' } }
    ),
  };
  return {
    supabase: {
      from: vi.fn((table: string) => {
        if (table === 'crm_connections') return { select: vi.fn(() => connChain) };
        if (table === 'failed_jobs') {
          return {
            insert: vi.fn(async (row: Record<string, unknown>) => {
              state.failedJobInserts.push(row);
              return { error: null };
            }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    },
  };
});

vi.mock('../crm/index.js', () => ({
  getCrmAdapter: vi.fn(() => ({})),
  resolveAdapterConfig: vi.fn(async () => ({})),
}));

const applyBlueprint = vi.fn();
const markRunManualReview = vi.fn(async () => undefined);
const loadProvisionRun = vi.fn(async () => ({
  runId: 'run_1',
  clientId: 'client_1',
  crmConnectionId: 'conn_1',
  blueprintName: 'test-bp',
  status: 'pending' as const,
  steps: [],
}));

vi.mock('../crm/ghl-provisioning.service.js', () => ({
  ghlProvisioningService: { applyBlueprint },
  markRunManualReview,
  loadProvisionRun,
}));

const { processCrmSync } = await import('../workers/crm-sync.worker.js');
const { onFinalFailure } = await import('../workers/failure-alerts.js');

function provisionJob(attemptsMade = 0): Job<CrmSyncJob> {
  return {
    name: 'provision',
    attemptsMade,
    opts: { attempts: 3 },
    data: {
      kind: 'provision',
      clientId: 'client_1',
      crmConnectionId: 'conn_1',
      runId: 'run_1',
      blueprintName: 'test-bp',
      blueprint: { name: 'test-bp', pipeline: { name: 'P', stages: ['New'] }, customFields: [], tags: [] },
      idempotencyKey: 'key',
    },
  } as unknown as Job<CrmSyncJob>;
}

beforeEach(() => {
  state.conn = { id: 'conn_1', client_id: 'client_1', crm_type: 'gohighlevel', needs_reauth: false };
  state.failedJobInserts.length = 0;
  applyBlueprint.mockReset().mockResolvedValue(undefined);
  markRunManualReview.mockClear();
  loadProvisionRun.mockClear();
});

describe('processCrmSync — provision dispatch', () => {
  it('routes provision jobs to the provisioning service', async () => {
    await processCrmSync(provisionJob());
    expect(applyBlueprint).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run_1', clientId: 'client_1', attempt: 1 })
    );
  });

  it('still rejects unknown entity types on the sync path', async () => {
    const job = {
      name: 'manual-sync',
      attemptsMade: 0,
      opts: { attempts: 3 },
      data: {
        clientId: 'client_1',
        crmConnectionId: 'conn_1',
        entityType: 'bogus',
        entityId: 'e1',
        operation: 'create',
        payload: {},
        idempotencyKey: 'k',
      },
    } as unknown as Job<CrmSyncJob>;
    await expect(processCrmSync(job)).rejects.toThrow('Unknown entity type');
    expect(applyBlueprint).not.toHaveBeenCalled();
  });

  it('parks the run without retrying when the connection is missing', async () => {
    state.conn = null;
    await expect(processCrmSync(provisionJob())).rejects.toBeInstanceOf(UnrecoverableError);
    expect(markRunManualReview).toHaveBeenCalled();
    expect(applyBlueprint).not.toHaveBeenCalled();
  });

  it('parks the run without retrying when the connection already needs re-auth', async () => {
    state.conn = { ...state.conn!, needs_reauth: true };
    await expect(processCrmSync(provisionJob())).rejects.toBeInstanceOf(UnrecoverableError);
    expect(markRunManualReview).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ errorMessage: expect.stringContaining('re-authorization') })
    );
    expect(applyBlueprint).not.toHaveBeenCalled();
  });

  it('parks the run on the final failed attempt', async () => {
    applyBlueprint.mockRejectedValue(new Error('boom'));
    await expect(processCrmSync(provisionJob(2))).rejects.toThrow('boom'); // attempt 3 of 3
    expect(loadProvisionRun).toHaveBeenCalled(); // persisted steps survive the flip
    expect(markRunManualReview).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ attempts: 3, errorMessage: 'boom' })
    );
  });

  it('leaves parking to BullMQ retries on non-final attempts', async () => {
    applyBlueprint.mockRejectedValue(new Error('boom'));
    await expect(processCrmSync(provisionJob(0))).rejects.toThrow('boom'); // attempt 1 of 3
    expect(markRunManualReview).not.toHaveBeenCalled();
  });

  it('does not double-park when the service already handled a 401', async () => {
    applyBlueprint.mockRejectedValue(new UnrecoverableError('token revoked'));
    await expect(processCrmSync(provisionJob(2))).rejects.toBeInstanceOf(UnrecoverableError);
    expect(markRunManualReview).not.toHaveBeenCalled();
  });
});

describe('onFinalFailure', () => {
  function job(attemptsMade: number): Job {
    return {
      id: 'j1',
      attemptsMade,
      opts: { attempts: 3 },
      data: { kind: 'provision' },
    } as unknown as Job;
  }

  it('treats UnrecoverableError as terminal even with attempts remaining', async () => {
    await onFinalFailure('crm-sync', job(1), new UnrecoverableError('dead'));
    expect(state.failedJobInserts).toHaveLength(1);
    expect(state.failedJobInserts[0]).toMatchObject({ status: 'manual_review', queue_name: 'crm-sync' });
  });

  it('waits for retries to exhaust on ordinary errors', async () => {
    await onFinalFailure('crm-sync', job(1), new Error('flaky'));
    expect(state.failedJobInserts).toHaveLength(0);

    await onFinalFailure('crm-sync', job(3), new Error('flaky'));
    expect(state.failedJobInserts).toHaveLength(1);
  });
});
