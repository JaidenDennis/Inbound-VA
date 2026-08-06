import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The behaviour under test is the fix for the core Phase 2 bug: a knowledge edit
 * changed the database while the live Retell agent kept answering with the old
 * content. requestSync() is what closes that gap, and it has to coalesce — a
 * client editing twelve FAQs must cause one provision, not twelve.
 */

const queue = vi.hoisted(() => ({
  add: vi.fn(),
  getJob: vi.fn(),
}));
vi.mock('../queues/index.js', () => ({
  agentProvisioningQueue: queue,
  redis: {},
}));

const db = vi.hoisted(() => {
  const updates: Array<{ table: string; patch: Record<string, unknown> }> = [];
  const supabase = {
    from: (table: string) => ({
      update: (patch: Record<string, unknown>) => {
        updates.push({ table, patch });
        return { eq: () => Promise.resolve({ data: null, error: null }) };
      },
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () => ({ maybeSingle: () => Promise.resolve({ data: { version: 3 }, error: null }) }),
          }),
        }),
      }),
      insert: () => Promise.resolve({ data: null, error: null }),
    }),
  };
  return { updates, supabase };
});
vi.mock('../db/index.js', () => ({ supabase: db.supabase }));

const { agentSyncService, SYNC_DEBOUNCE_MS } = await import('../services/agentSync.service.js');

describe('agent sync — coalescing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.updates.length = 0;
    queue.getJob.mockResolvedValue(null);
    queue.add.mockResolvedValue({ id: 'job-1' });
  });

  it('marks the client pending so the dashboard can say the agent is stale', async () => {
    await agentSyncService.requestSync('client-a');
    const update = db.updates.find((u) => u.table === 'clients');
    expect(update?.patch.agent_sync_state).toBe('pending');
    // A previous failure must not stick around once a new sync is queued.
    expect(update?.patch.agent_sync_error).toBeNull();
  });

  it('queues one delayed job per client, keyed so a burst collapses', async () => {
    await agentSyncService.requestSync('client-a');

    expect(queue.add).toHaveBeenCalledTimes(1);
    const [, payload, opts] = queue.add.mock.calls[0];
    expect(payload).toEqual({ clientId: 'client-a', userId: undefined });
    expect(opts.jobId).toBe('agent-sync:client-a');
    expect(opts.delay).toBe(SYNC_DEBOUNCE_MS);
  });

  it('uses the same jobId for every edit in a burst, so BullMQ drops duplicates', async () => {
    for (let i = 0; i < 12; i += 1) await agentSyncService.requestSync('client-a');

    const jobIds = new Set(queue.add.mock.calls.map((c) => c[2].jobId));
    expect(jobIds).toEqual(new Set(['agent-sync:client-a']));
  });

  it('keeps different clients on separate jobs', async () => {
    await agentSyncService.requestSync('client-a');
    await agentSyncService.requestSync('client-b');

    const jobIds = queue.add.mock.calls.map((c) => c[2].jobId);
    expect(jobIds).toEqual(['agent-sync:client-a', 'agent-sync:client-b']);
  });
});

describe('agent sync — immediate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.updates.length = 0;
    queue.add.mockResolvedValue({ id: 'job-1' });
  });

  it('runs without the coalescing delay', async () => {
    queue.getJob.mockResolvedValue(null);
    await agentSyncService.requestSync('client-a', { immediate: true });

    const [, , opts] = queue.add.mock.calls[0];
    expect(opts.delay).toBeUndefined();
  });

  it('cancels a pending delayed job so the agent is not provisioned twice', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    queue.getJob.mockResolvedValue({ remove });

    await agentSyncService.requestSync('client-a', { immediate: true });

    expect(queue.getJob).toHaveBeenCalledWith('agent-sync:client-a');
    expect(remove).toHaveBeenCalled();
  });
});

describe('agent sync — state transitions', () => {
  beforeEach(() => {
    db.updates.length = 0;
  });

  it('records success with a timestamp and clears the error', async () => {
    await agentSyncService.markSynced('client-a');
    const patch = db.updates.at(-1)!.patch;
    expect(patch.agent_sync_state).toBe('synced');
    expect(patch.agent_sync_error).toBeNull();
    expect(patch.agent_synced_at).toEqual(expect.any(String));
  });

  it('records failure with the reason, so the badge can explain itself', async () => {
    await agentSyncService.markFailed('client-a', 'Business name is not set');
    const patch = db.updates.at(-1)!.patch;
    expect(patch.agent_sync_state).toBe('failed');
    expect(patch.agent_sync_error).toBe('Business name is not set');
  });

  it('truncates a runaway error message rather than failing the update', async () => {
    await agentSyncService.markFailed('client-a', 'x'.repeat(5000));
    expect((db.updates.at(-1)!.patch.agent_sync_error as string).length).toBe(1000);
  });
});
