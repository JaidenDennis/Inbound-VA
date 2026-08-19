import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The behaviour under test is the fix for the core Phase 2 bug: a knowledge edit
 * changed the database while the live Retell agent kept answering with the old
 * content. requestSync() is what closes that gap, and it has to coalesce — a
 * client editing twelve FAQs must cause one provision, not twelve.
 */

/**
 * BullMQ's own custom-job-id rules, copied from Job.validateOptions:
 *   - a purely numeric id is rejected
 *   - an id containing ':' is rejected unless it has exactly two of them
 *     (a legacy carve-out for repeatable jobs)
 *
 * The mock enforces them because the plain `add: vi.fn()` it replaces is why
 * this file happily asserted `jobId === 'agent-sync:client-a'` for months while
 * production answered 500 "Custom Id cannot contain :" to every knowledge-base
 * save, the hours save and the Publish Now button. A queue double that accepts
 * what the real queue rejects is not a double, it is a blindfold.
 */
export function assertValidBullMqJobId(jobId: unknown): void {
  if (typeof jobId !== 'string') return; // undefined is legal — BullMQ assigns one
  if (`${parseInt(jobId, 10)}` === jobId) {
    throw new Error('Custom Id cannot be integers');
  }
  if (jobId.includes(':') && jobId.split(':').length !== 3) {
    throw new Error('Custom Id cannot contain :');
  }
}

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
    queue.add.mockImplementation((_name: string, _data: unknown, opts?: { jobId?: string }) => {
      assertValidBullMqJobId(opts?.jobId);
      return Promise.resolve({ id: 'job-1' });
    });
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
    expect(opts.jobId).toBe('agent-sync-client-a');
    expect(opts.delay).toBe(SYNC_DEBOUNCE_MS);
  });

  it('uses the same jobId for every edit in a burst, so BullMQ drops duplicates', async () => {
    for (let i = 0; i < 12; i += 1) await agentSyncService.requestSync('client-a');

    const jobIds = new Set(queue.add.mock.calls.map((c) => c[2].jobId));
    expect(jobIds).toEqual(new Set(['agent-sync-client-a']));
  });

  it('keeps different clients on separate jobs', async () => {
    await agentSyncService.requestSync('client-a');
    await agentSyncService.requestSync('client-b');

    const jobIds = queue.add.mock.calls.map((c) => c[2].jobId);
    expect(jobIds).toEqual(['agent-sync-client-a', 'agent-sync-client-b']);
  });
});

describe('agent sync — immediate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.updates.length = 0;
    queue.add.mockImplementation((_name: string, _data: unknown, opts?: { jobId?: string }) => {
      assertValidBullMqJobId(opts?.jobId);
      return Promise.resolve({ id: 'job-1' });
    });
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

    expect(queue.getJob).toHaveBeenCalledWith('agent-sync-client-a');
    expect(remove).toHaveBeenCalled();
  });
});

describe('agent sync — job ids BullMQ will actually accept', () => {
  // The regression that broke Publish Now, every knowledge-base save and the
  // business-hours save with 500 "Custom Id cannot contain :".
  beforeEach(() => {
    vi.clearAllMocks();
    db.updates.length = 0;
    queue.getJob.mockResolvedValue(null);
    queue.add.mockImplementation((_name: string, _data: unknown, opts?: { jobId?: string }) => {
      assertValidBullMqJobId(opts?.jobId);
      return Promise.resolve({ id: 'job-1' });
    });
  });

  it('produces a colon-free id on the debounced path', async () => {
    await agentSyncService.requestSync('3f2b9c14-8d7a-4e6f-9a1b-2c3d4e5f6a7b');
    expect(queue.add.mock.calls[0][2].jobId).not.toContain(':');
  });

  it('produces a colon-free id on the immediate path', async () => {
    // The one Publish Now uses. It was the worse of the two: `agent-sync:<id>:now:<ts>`
    // carried three colons where BullMQ tolerates only exactly two.
    await agentSyncService.requestSync('3f2b9c14-8d7a-4e6f-9a1b-2c3d4e5f6a7b', { immediate: true });
    expect(queue.add.mock.calls[0][2].jobId).not.toContain(':');
  });

  it('the guard itself rejects what BullMQ rejects', () => {
    expect(() => assertValidBullMqJobId('agent-sync:client-a')).toThrow('Custom Id cannot contain :');
    expect(() => assertValidBullMqJobId('agent-sync:client-a:now:123')).toThrow('Custom Id cannot contain :');
    expect(() => assertValidBullMqJobId('12345')).toThrow('Custom Id cannot be integers');
    // Exactly two colons is BullMQ's legacy repeatable-job carve-out.
    expect(() => assertValidBullMqJobId('a:b:c')).not.toThrow();
    expect(() => assertValidBullMqJobId('agent-sync-client-a')).not.toThrow();
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

/**
 * A finished job must not block the next one.
 *
 * The coalescing above leans on "BullMQ ignores an add for a jobId that already
 * exists". That is true, and it is also true AFTER the job finishes: the queue
 * keeps completed jobs (removeOnComplete: { count: 200 }) and keeps failed ones
 * forever (removeOnFail: false), so the id survives the run that used it.
 *
 * The consequence in production: Bare Beauty synced once on 14 Aug, and every
 * edit afterwards flipped the row to 'pending' and queued nothing. Five days
 * later the dashboard still said "pending", Retell still served version 19, and
 * nothing had errored — requestSync had returned cleanly each time. Clearview
 * Orthodontics was in the same state since 11 Aug, and a client whose provision
 * FAILED was worse off still: retained forever, it could never retry even once
 * the invalid config was fixed.
 *
 * The double below models what the real queue does — an add against a live id
 * is dropped — because the mock this file previously used returned null from
 * getJob unconditionally, which is exactly the blindfold that let this ship.
 */
describe('agent sync — a finished job must not block the next one', () => {
  /** Minimal BullMQ semantics: ids are unique, add against a live id is a no-op. */
  function stubQueue(seed?: { id: string; state: string }) {
    const jobs = new Map<string, { id: string; state: string; removed: boolean }>();
    if (seed) jobs.set(seed.id, { ...seed, removed: false });

    queue.getJob.mockImplementation(async (id: string) => {
      const job = jobs.get(id);
      if (!job) return null;
      return {
        id: job.id,
        getState: async () => job.state,
        remove: async () => {
          job.removed = true;
          jobs.delete(job.id);
        },
      };
    });

    queue.add.mockImplementation(async (_n: string, _d: unknown, opts?: { jobId?: string }) => {
      assertValidBullMqJobId(opts?.jobId);
      const id = opts?.jobId;
      if (id && jobs.has(id)) return { id, dropped: true }; // what BullMQ really does
      if (id) jobs.set(id, { id, state: 'delayed', removed: false });
      return { id };
    });

    return jobs;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    db.updates.length = 0;
  });

  it.each(['completed', 'failed'])(
    'clears a %s job for this client so the new edit is actually queued',
    async (state) => {
      const jobs = stubQueue({ id: 'agent-sync-client-a', state });

      await agentSyncService.requestSync('client-a');

      // The live job must be one this request scheduled, not the corpse of the
      // last one. Without the fix the add is silently dropped and the client
      // never syncs again.
      const live = jobs.get('agent-sync-client-a');
      expect(live).toBeDefined();
      expect(live!.state).toBe('delayed');
    }
  );

  it('still coalesces while a job is genuinely pending', async () => {
    // The behaviour the fix must NOT break: a burst of edits inside the window
    // is still one provision, so a delayed job is left exactly where it is.
    stubQueue({ id: 'agent-sync-client-a', state: 'delayed' });

    const before = await queue.getJob('agent-sync-client-a');
    const removeSpy = vi.spyOn(before, 'remove');

    for (let i = 0; i < 5; i += 1) await agentSyncService.requestSync('client-a');

    expect(removeSpy).not.toHaveBeenCalled();
  });

  it('leaves another client\u2019s finished job alone', async () => {
    const jobs = stubQueue({ id: 'agent-sync-client-b', state: 'completed' });

    await agentSyncService.requestSync('client-a');

    expect(jobs.has('agent-sync-client-b')).toBe(true);
  });
});
