import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the upsert payload + options, and echo the update patch back, so we
// can assert seeding shape and completed_at stamping without a real DB.
const db = vi.hoisted(() => {
  const calls: { upsertRows?: Array<Record<string, unknown>>; upsertOpts?: Record<string, unknown> } = {};
  const supabase = {
    from: () => ({
      upsert: (rows: Array<Record<string, unknown>>, opts: Record<string, unknown>) => {
        calls.upsertRows = rows;
        calls.upsertOpts = opts;
        return Promise.resolve({ error: null });
      },
      update: (patch: Record<string, unknown>) => {
        const result = { data: { id: 'm1', client_id: 'c', stage_key: 'go_live', sort_order: 7, ...patch }, error: null };
        const single = () => Promise.resolve(result);
        const select = () => ({ single });
        const eq2 = () => ({ select });
        const eq1 = () => ({ eq: eq2 });
        return { eq: eq1 };
      },
    }),
  };
  return { calls, supabase };
});
vi.mock('../db/index.js', () => ({ supabase: db.supabase }));

import { OnboardingService } from '../services/onboarding.service.js';
import { ONBOARDING_STAGES } from '../types/index.js';

describe('OnboardingService.seedForClient', () => {
  beforeEach(() => {
    db.calls.upsertRows = undefined;
    db.calls.upsertOpts = undefined;
  });

  it('seeds all 8 stages as not_started, in order, idempotently', async () => {
    await new OnboardingService().seedForClient('client-a');

    const rows = db.calls.upsertRows!;
    expect(rows).toHaveLength(8);
    expect(rows.map((r) => r.stage_key)).toEqual(ONBOARDING_STAGES.map((s) => s.key));
    expect(rows.map((r) => r.sort_order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(rows.every((r) => r.status === 'not_started')).toBe(true);
    expect(rows.every((r) => r.client_id === 'client-a')).toBe(true);
    // ON CONFLICT DO NOTHING so re-seeding never clobbers progress.
    expect(db.calls.upsertOpts).toMatchObject({ onConflict: 'client_id,stage_key', ignoreDuplicates: true });
  });
});

describe('OnboardingService.updateStage', () => {
  it('stamps completed_at when a stage is completed', async () => {
    const m = await new OnboardingService().updateStage('c', 'go_live', 'complete');
    expect(m.status).toBe('complete');
    expect(m.completed_at).toBeTruthy();
  });

  it('clears completed_at when a stage is moved back from complete', async () => {
    const m = await new OnboardingService().updateStage('c', 'go_live', 'in_progress');
    expect(m.status).toBe('in_progress');
    expect(m.completed_at).toBeNull();
  });
});
