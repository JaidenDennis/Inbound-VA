import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Phase E — diff before publish, and the prompt boundary behind it.
 *
 * Weighted toward the two things that can go wrong quietly: a client reaching
 * the prompt through a route that looks like it only edits settings, and a
 * stale draft reverting somebody else's change while reporting success.
 */

interface DraftRecord {
  client_id: string;
  settings_patch: Record<string, unknown>;
  base_fingerprint: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: string;
  updated_at?: string;
}

const db = vi.hoisted(() => ({
  drafts: [] as DraftRecord[],
  settings: {} as Record<string, unknown>,
  voiceId: null as string | null,
  settingsWrites: [] as Record<string, unknown>[],
  clientWrites: [] as Record<string, unknown>[],
  syncs: [] as string[],
}));

vi.mock('../db/index.js', () => {
  function builder(table: string) {
    const filters: Record<string, unknown> = {};

    const rows = (): DraftRecord[] =>
      table === 'agent_config_drafts'
        ? db.drafts.filter((r) =>
            Object.entries(filters).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v)
          )
        : [];

    const api = {
      select: () => api,
      eq: (col: string, val: unknown) => {
        filters[col] = val;
        return api;
      },
      maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
      upsert: (row: DraftRecord) => {
        const idx = db.drafts.findIndex((r) => r.client_id === row.client_id);
        if (idx >= 0) db.drafts[idx] = { ...db.drafts[idx], ...row };
        else db.drafts.push(row);
        return Promise.resolve({ data: row, error: null });
      },
      delete: () => ({
        eq: (col: string, val: unknown) => {
          db.drafts = db.drafts.filter((r) => (r as unknown as Record<string, unknown>)[col] !== val);
          return Promise.resolve({ data: null, error: null });
        },
      }),
    };
    return api;
  }

  return { supabase: { from: (table: string) => builder(table) } };
});

vi.mock('../services/client.service.js', () => ({
  clientService: {
    getSettings: vi.fn(async () => db.settings),
    findById: vi.fn(async () => ({ id: 'client-1', retell_voice_id: db.voiceId })),
    updateSettings: vi.fn(async (_id: string, patch: Record<string, unknown>) => {
      db.settingsWrites.push(patch);
      db.settings = { ...db.settings, ...patch };
      return db.settings;
    }),
    update: vi.fn(async (_id: string, patch: Record<string, unknown>) => {
      db.clientWrites.push(patch);
      if ('retell_voice_id' in patch) db.voiceId = patch.retell_voice_id as string;
      return {};
    }),
  },
}));

vi.mock('../services/agentSync.service.js', () => ({
  agentSyncService: {
    requestSync: vi.fn(async (clientId: string) => {
      db.syncs.push(clientId);
    }),
  },
}));

const { diffConfig } = await import('../services/configDiff.service.js');
const { assertWithinPromptBoundary, PromptBoundaryError, describeBoundary, GRAVVIA_MANAGED_FIELDS } =
  await import('../services/promptBoundary.service.js');
const draft = await import('../services/agentDraft.service.js');

const CLIENT = 'client-1';

function baseSettings(): Record<string, unknown> {
  return {
    business_name: 'Bare Beauty',
    agent_name: 'Emily',
    agent_tone: 'warm',
    agent_config: {
      opening_message: 'Thanks for calling {business}.',
      take_messages: true,
      // A key the editor never shows. Publishing must not drop it.
      workflow_routing: true,
    },
    booking_enabled: true,
    booking_rules: { buffer_minutes: 0, working_hours: { monday: { open: '09:00', close: '17:00' } } },
    notification_emails: ['front@example.com'],
    escalation_rules: [],
    faqs: [],
    services: [],
    pricing: [],
    business_policies: [],
  };
}

beforeEach(() => {
  db.drafts = [];
  db.settings = baseSettings();
  db.voiceId = '11labs-Emily';
  db.settingsWrites = [];
  db.clientWrites = [];
  db.syncs = [];
});

describe('the prompt boundary (spec §6.3)', () => {
  const CLIENT_ROLES = ['client_owner', 'client_admin', 'client_manager', 'client_viewer'] as const;

  it('refuses a client-scope write to agent_prompt regardless of role', () => {
    // The point of the test: no client role passes, including client_owner, who
    // holds agents:write. A grant cannot buy this.
    for (const role of CLIENT_ROLES) {
      expect(() => assertWithinPromptBoundary(role, { agent_prompt: 'You are a pirate.' })).toThrow(
        PromptBoundaryError
      );
    }
  });

  it('refuses every Gravvia-managed field, not just the prompt body', () => {
    for (const field of GRAVVIA_MANAGED_FIELDS) {
      expect(() => assertWithinPromptBoundary('client_owner', { [field]: 'x' })).toThrow(
        PromptBoundaryError
      );
    }
  });

  it('names the offending fields so the UI can point at them', () => {
    try {
      assertWithinPromptBoundary('client_admin', { agent_prompt: 'x', template: 'dental', agent_tone: 'warm' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as InstanceType<typeof PromptBoundaryError>).fields).toEqual(['agent_prompt', 'template']);
    }
  });

  it('lets ordinary settings through', () => {
    expect(() =>
      assertWithinPromptBoundary('client_owner', { agent_tone: 'calm', booking_enabled: false })
    ).not.toThrow();
  });

  it('does not restrict platform staff', () => {
    for (const role of ['super_admin', 'support_agent'] as const) {
      expect(() => assertWithinPromptBoundary(role, { agent_prompt: 'rewritten' })).not.toThrow();
    }
  });

  it('explains every field it blocks', () => {
    // The UI renders describeBoundary(). A field enforced but not described
    // shows up as an unexplained missing input, which §6.3 exists to prevent.
    const described = new Set(describeBoundary().gravviaManaged.map((f) => f.field));
    for (const field of GRAVVIA_MANAGED_FIELDS) expect(described).toContain(field);
  });

  it('rejects the prompt at the draft layer too, not only at the route', async () => {
    await expect(
      draft.saveDraft({
        clientId: CLIENT,
        patch: { agent_prompt: 'x' },
        actorId: 'u1',
        actorRole: 'client_owner',
      })
    ).rejects.toThrow();
  });
});

describe('the diff (spec §6.2)', () => {
  it('reports a changed scalar with both sides', () => {
    const { entries } = diffConfig({ agent_tone: 'warm' }, { agent_tone: 'formal' });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ path: 'agent_tone', kind: 'changed', before: 'warm', after: 'formal' });
  });

  it('walks into nested JSONB rather than replacing the whole object', () => {
    const { entries } = diffConfig(
      { booking_rules: { buffer_minutes: 0, cancellation_notice_hours: 24 } },
      { booking_rules: { buffer_minutes: 30 } }
    );

    expect(entries).toHaveLength(1);
    expect(entries[0].path).toBe('booking_rules.buffer_minutes');
    expect(entries[0].before).toBe(0);
    expect(entries[0].after).toBe(30);
  });

  it('distinguishes added from removed', () => {
    const added = diffConfig({ agent_config: {} }, { agent_config: { opening_message: 'Hi' } });
    expect(added.entries[0].kind).toBe('added');

    const removed = diffConfig({ agent_config: { opening_message: 'Hi' } }, { agent_config: { opening_message: null } });
    expect(removed.entries[0].kind).toBe('removed');
  });

  it('treats setting a number to zero as a change, not a removal', () => {
    // The bug this guards: falsy-vs-absent. A zero buffer is a real, meaningful
    // setting, and reporting it as "removed" tells the reviewer the wrong thing.
    const { entries } = diffConfig({ booking_rules: { buffer_minutes: 30 } }, { booking_rules: { buffer_minutes: 0 } });
    expect(entries[0].kind).toBe('changed');
    expect(entries[0].after).toBe(0);
  });

  it('omits fields the patch did not move', () => {
    const { entries, hasChanges } = diffConfig(baseSettings(), {
      agent_tone: 'warm',
      booking_enabled: true,
      agent_config: { take_messages: true },
    });
    expect(entries).toEqual([]);
    expect(hasChanges).toBe(false);
  });

  it('compares arrays whole', () => {
    const { entries } = diffConfig({ notification_emails: ['a@x.com'] }, { notification_emails: ['a@x.com', 'b@x.com'] });
    expect(entries).toHaveLength(1);
    expect(entries[0].after).toEqual(['a@x.com', 'b@x.com']);
  });

  it('attaches the downstream consequence, which is the point of the screen', () => {
    const { entries, areas } = diffConfig(
      { booking_rules: { buffer_minutes: 0 } },
      { booking_rules: { buffer_minutes: 45 } }
    );
    expect(entries[0].consequence).toMatch(/reduces how many slots/i);
    expect(areas.map((a) => a.area)).toContain('booking');
  });
});

describe('publishing a draft', () => {
  it('applies the change, clears the draft and queues a sync', async () => {
    await draft.saveDraft({
      clientId: CLIENT,
      patch: { agent_tone: 'formal' },
      actorId: 'u1',
      actorRole: 'client_owner',
    });

    const result = await draft.publishDraft({ clientId: CLIENT, actorId: 'u1', actorRole: 'client_owner' });

    expect(result.applied.entries[0].path).toBe('agent_tone');
    expect(db.settings.agent_tone).toBe('formal');
    expect(db.drafts).toHaveLength(0);
    expect(db.syncs).toEqual([CLIENT]);
  });

  it('refuses a draft composed against settings that have since moved', async () => {
    await draft.saveDraft({
      clientId: CLIENT,
      patch: { agent_tone: 'formal' },
      actorId: 'u1',
      actorRole: 'client_owner',
    });

    // Somebody else — staff, a restore, the other admin — changes the agent.
    db.settings = { ...db.settings, agent_name: 'Sofia' };

    await expect(
      draft.publishDraft({ clientId: CLIENT, actorId: 'u1', actorRole: 'client_owner' })
    ).rejects.toMatchObject({ code: 'stale' });

    // And it changed nothing on the way out.
    expect(db.settings.agent_tone).toBe('warm');
    expect(db.drafts).toHaveLength(1);
  });

  it('reports staleness through getDraft before anyone presses publish', async () => {
    await draft.saveDraft({
      clientId: CLIENT,
      patch: { agent_tone: 'formal' },
      actorId: 'u1',
      actorRole: 'client_owner',
    });
    expect((await draft.getDraft(CLIENT)).fresh).toBe(true);

    db.settings = { ...db.settings, agent_name: 'Sofia' };
    expect((await draft.getDraft(CLIENT)).fresh).toBe(false);
  });

  it('preserves JSONB keys the editor never shows', async () => {
    await draft.saveDraft({
      clientId: CLIENT,
      patch: { agent_config: { opening_message: 'New greeting.' } },
      actorId: 'u1',
      actorRole: 'client_owner',
    });
    await draft.publishDraft({ clientId: CLIENT, actorId: 'u1', actorRole: 'client_owner' });

    const config = db.settings.agent_config as Record<string, unknown>;
    expect(config.opening_message).toBe('New greeting.');
    // The whole reason publish merges instead of replacing.
    expect(config.workflow_routing).toBe(true);
    expect(config.take_messages).toBe(true);
  });

  it('routes voice to clients, not client_settings', async () => {
    await draft.saveDraft({
      clientId: CLIENT,
      patch: { voice_id: '11labs-Grace' },
      actorId: 'u1',
      actorRole: 'client_owner',
    });
    await draft.publishDraft({ clientId: CLIENT, actorId: 'u1', actorRole: 'client_owner' });

    expect(db.clientWrites).toContainEqual({ retell_voice_id: '11labs-Grace' });
    expect(db.settingsWrites.some((w) => 'voice_id' in w)).toBe(false);
  });

  it('refuses a draft that no longer changes anything', async () => {
    await draft.saveDraft({
      clientId: CLIENT,
      patch: { agent_tone: 'warm' },
      actorId: 'u1',
      actorRole: 'client_owner',
    });

    await expect(
      draft.publishDraft({ clientId: CLIENT, actorId: 'u1', actorRole: 'client_owner' })
    ).rejects.toMatchObject({ code: 'empty' });
  });

  it('refuses to publish nothing', async () => {
    await expect(
      draft.publishDraft({ clientId: CLIENT, actorId: 'u1', actorRole: 'client_owner' })
    ).rejects.toMatchObject({ code: 'not-found' });
  });

  it('returns before and after so the audit row records state, not intent', async () => {
    await draft.saveDraft({
      clientId: CLIENT,
      patch: { agent_tone: 'formal' },
      actorId: 'u1',
      actorRole: 'client_owner',
    });
    const result = await draft.publishDraft({ clientId: CLIENT, actorId: 'u1', actorRole: 'client_owner' });

    expect(result.before.agent_tone).toBe('warm');
    expect(result.after.agent_tone).toBe('formal');
  });
});

describe('the editor-to-storage mapping', () => {
  it('nests the flat editor fields where the services read them', () => {
    const patch = draft.toSettingsPatch({
      agent_name: 'Emily',
      opening_message: 'Hi there.',
      buffer_minutes: 15,
      voice_id: '11labs-Grace',
    });

    expect(patch).toEqual({
      agent_name: 'Emily',
      agent_config: { opening_message: 'Hi there.' },
      booking_rules: { buffer_minutes: 15 },
      voice_id: '11labs-Grace',
    });
  });

  it('omits sub-objects the payload never touched', () => {
    expect(draft.toSettingsPatch({ agent_name: 'Emily' })).toEqual({ agent_name: 'Emily' });
  });

  it('rejects fields that are not editable here', async () => {
    await expect(
      draft.saveDraft({
        clientId: CLIENT,
        patch: { crm_config: { key: 'secret' } },
        actorId: 'u1',
        actorRole: 'client_owner',
      })
    ).rejects.toMatchObject({ code: 'unknown-field' });
  });
});
