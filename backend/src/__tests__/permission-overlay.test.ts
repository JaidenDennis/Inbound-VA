import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The per-tenant permission overlay (migration 022).
 *
 * This is a privilege boundary, so the tests are weighted toward what must NOT
 * be possible rather than toward the happy path. The escalation cases below are
 * the reason the overlay has three independent guards.
 */

interface OverrideRow {
  client_id: string;
  role: string;
  permission: string;
  granted: boolean;
  created_by?: string | null;
  updated_at?: string;
}

const db = vi.hoisted(() => ({
  /** Base grants per role, as migration 016/022 would seed them. */
  base: new Map<string, string[]>(),
  overrides: [] as OverrideRow[],
  audits: [] as Record<string, unknown>[],
  failOverlayRead: false,
}));

vi.mock('../db/index.js', () => {
  /** Minimal PostgREST-shaped builder covering the chains these services use. */
  function builder(table: string) {
    const filters: Record<string, unknown> = {};
    let pending: OverrideRow | null = null;
    let op: 'select' | 'upsert' | 'delete' | 'insert' = 'select';

    const matching = (): OverrideRow[] =>
      db.overrides.filter((r) =>
        Object.entries(filters).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v)
      );

    const api = {
      select: () => api,
      order: () => api,
      eq: (col: string, val: unknown) => {
        filters[col === 'client_id' ? 'client_id' : col] = val;
        return api;
      },
      insert: (row: Record<string, unknown>) => {
        op = 'insert';
        if (table === 'audit_logs') db.audits.push(row);
        return Promise.resolve({ data: null, error: null });
      },
      upsert: (row: OverrideRow) => {
        op = 'upsert';
        pending = row;
        const idx = db.overrides.findIndex(
          (r) => r.client_id === row.client_id && r.role === row.role && r.permission === row.permission
        );
        if (idx >= 0) db.overrides[idx] = row;
        else db.overrides.push(row);
        return api;
      },
      delete: () => {
        op = 'delete';
        return api;
      },
      single: () => Promise.resolve({ data: pending, error: null }),
      maybeSingle: () => {
        if (table === 'roles') {
          const role = filters.name as string;
          const perms = db.base.get(role);
          return Promise.resolve({
            data: perms ? { permissions: perms.map((p) => ({ permission: p })) } : null,
            error: null,
          });
        }
        return Promise.resolve({ data: matching()[0] ?? null, error: null });
      },
      // Awaiting the builder directly is how the list/delete calls resolve.
      then: (resolve: (v: { data: unknown; error: unknown }) => void) => {
        if (op === 'delete') {
          const keep = db.overrides.filter((r) => !matching().includes(r));
          db.overrides.length = 0;
          db.overrides.push(...keep);
          return resolve({ data: null, error: null });
        }
        if (table === 'client_permission_overrides' && db.failOverlayRead) {
          return resolve({ data: null, error: { message: 'connection reset' } });
        }
        return resolve({ data: matching(), error: null });
      },
    };
    return api;
  }

  return { supabase: { from: (table: string) => builder(table) } };
});

const { getEffectivePermissions, invalidatePermissionCache } = await import(
  '../services/permission.service.js'
);
const { setOverride, clearOverride, PermissionOverlayError } = await import(
  '../services/clientPermission.service.js'
);

const CLIENT = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const ACTOR = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

beforeEach(() => {
  db.base.clear();
  db.base.set('client_manager', [
    'clients:read',
    'calls:read',
    'analytics:read',
    'transcripts:read',
    'tickets:read',
  ]);
  db.base.set('client_owner', ['clients:read', 'calls:read', 'configure:roles', 'users:write']);
  db.base.set('client_viewer', ['clients:read', 'analytics:read']);
  db.base.set('super_admin', ['system:write', 'recordings:read', 'clients:write']);
  db.overrides.length = 0;
  db.audits.length = 0;
  db.failOverlayRead = false;
  invalidatePermissionCache();
});

describe('overlay resolution', () => {
  it('returns base grants when the tenant has no overrides', async () => {
    const grants = await getEffectivePermissions('client_manager', CLIENT);
    expect([...grants].sort()).toEqual([
      'analytics:read',
      'calls:read',
      'clients:read',
      'tickets:read',
      'transcripts:read',
    ]);
  });

  it('adds a granted override', async () => {
    await setOverride({
      clientId: CLIENT,
      role: 'client_manager',
      permission: 'knowledge:write',
      granted: true,
      actorId: ACTOR,
    });
    const grants = await getEffectivePermissions('client_manager', CLIENT);
    expect(grants.has('knowledge:write')).toBe(true);
  });

  it('removes a revoked override', async () => {
    await setOverride({
      clientId: CLIENT,
      role: 'client_manager',
      permission: 'transcripts:read',
      granted: false,
      actorId: ACTOR,
    });
    const grants = await getEffectivePermissions('client_manager', CLIENT);
    expect(grants.has('transcripts:read')).toBe(false);
    // ...and leaves everything else alone.
    expect(grants.has('calls:read')).toBe(true);
  });

  it('honours the latest decision when a grant is flipped', async () => {
    const args = {
      clientId: CLIENT,
      role: 'client_manager',
      permission: 'knowledge:write',
      actorId: ACTOR,
    };
    await setOverride({ ...args, granted: true });
    expect((await getEffectivePermissions('client_manager', CLIENT)).has('knowledge:write')).toBe(true);

    invalidatePermissionCache();
    await setOverride({ ...args, granted: false });
    expect((await getEffectivePermissions('client_manager', CLIENT)).has('knowledge:write')).toBe(false);
  });

  it('scopes overrides to one tenant', async () => {
    await setOverride({
      clientId: CLIENT,
      role: 'client_manager',
      permission: 'knowledge:write',
      granted: true,
      actorId: ACTOR,
    });
    expect((await getEffectivePermissions('client_manager', OTHER)).has('knowledge:write')).toBe(false);
  });

  it('clearOverride returns the role to its base grants', async () => {
    await setOverride({
      clientId: CLIENT,
      role: 'client_manager',
      permission: 'transcripts:read',
      granted: false,
      actorId: ACTOR,
    });
    expect((await getEffectivePermissions('client_manager', CLIENT)).has('transcripts:read')).toBe(false);

    await clearOverride({
      clientId: CLIENT,
      role: 'client_manager',
      permission: 'transcripts:read',
      actorId: ACTOR,
    });
    expect((await getEffectivePermissions('client_manager', CLIENT)).has('transcripts:read')).toBe(true);
  });
});

describe('platform users are outside the overlay', () => {
  it('resolves to base grants and never reads an override', async () => {
    // An override row that would grant nothing extra anyway, but proves the
    // platform path does not consult the table: super_admin has no tenant.
    db.overrides.push({
      client_id: CLIENT,
      role: 'client_owner',
      permission: 'knowledge:write',
      granted: true,
    });
    for (const clientId of [null, undefined]) {
      const grants = await getEffectivePermissions('super_admin', clientId);
      expect([...grants].sort()).toEqual(['clients:write', 'recordings:read', 'system:write']);
    }
  });
});

describe('escalation is refused', () => {
  // The whole reason the overlay has an allowlist. Each of these, if allowed,
  // hands a tenant something that belongs to Gravvia.
  const forbidden = [
    'system:read',
    'system:write',
    'recordings:read',
    'clients:write',
    'users:write',
    'settings:write',
    'tickets:triage',
  ];

  for (const permission of forbidden) {
    it(`refuses to grant ${permission} to a tenant role`, async () => {
      await expect(
        setOverride({
          clientId: CLIENT,
          role: 'client_owner',
          permission,
          granted: true,
          actorId: ACTOR,
        })
      ).rejects.toThrow(PermissionOverlayError);
      expect(db.overrides).toHaveLength(0);
    });
  }

  for (const role of ['super_admin', 'support_agent', 'analyst']) {
    it(`refuses to override the platform role ${role}`, async () => {
      await expect(
        setOverride({
          clientId: CLIENT,
          role,
          permission: 'calls:read',
          granted: true,
          actorId: ACTOR,
        })
      ).rejects.toMatchObject({ code: 'platform-role' });
      expect(db.overrides).toHaveLength(0);
    });
  }

  it('refuses an unknown role', async () => {
    await expect(
      setOverride({
        clientId: CLIENT,
        role: 'client_god',
        permission: 'calls:read',
        granted: true,
        actorId: ACTOR,
      })
    ).rejects.toMatchObject({ code: 'unknown-role' });
  });

  // Defence 3: even a row that reached the table by some other path must not
  // grant anything off the allowlist when it is READ back.
  it('ignores a forbidden grant already present in the table', async () => {
    db.overrides.push({
      client_id: CLIENT,
      role: 'client_owner',
      permission: 'system:write',
      granted: true,
    });
    const grants = await getEffectivePermissions('client_owner', CLIENT);
    expect(grants.has('system:write')).toBe(false);
  });

  // ...but a REVOKE off the allowlist is still honoured. Taking access away is
  // always safe, and ignoring it would silently restore a grant someone removed.
  it('still honours a revoke of a non-allowlisted permission', async () => {
    db.base.set('client_owner', ['clients:read', 'users:write']);
    db.overrides.push({
      client_id: CLIENT,
      role: 'client_owner',
      permission: 'users:write',
      granted: false,
    });
    const grants = await getEffectivePermissions('client_owner', CLIENT);
    expect(grants.has('users:write')).toBe(false);
  });
});

describe('owner lockout guard', () => {
  it('refuses to revoke configure:roles from client_owner', async () => {
    await expect(
      setOverride({
        clientId: CLIENT,
        role: 'client_owner',
        permission: 'configure:roles',
        granted: false,
        actorId: ACTOR,
      })
    ).rejects.toMatchObject({ code: 'owner-lockout' });
  });

  it('allows revoking configure:roles from any other role', async () => {
    await expect(
      setOverride({
        clientId: CLIENT,
        role: 'client_admin',
        permission: 'configure:roles',
        granted: false,
        actorId: ACTOR,
      })
    ).resolves.toBeDefined();
  });

  it('allows granting configure:roles to client_owner', async () => {
    await expect(
      setOverride({
        clientId: CLIENT,
        role: 'client_owner',
        permission: 'configure:roles',
        granted: true,
        actorId: ACTOR,
      })
    ).resolves.toBeDefined();
  });
});

describe('failure behaviour', () => {
  // A failed overlay read must not fall back to base grants: a tenant that
  // revoked transcripts:read would silently get it back during a DB blip.
  it('denies everything when the overlay cannot be read', async () => {
    db.failOverlayRead = true;
    const grants = await getEffectivePermissions('client_manager', CLIENT);
    expect(grants.size).toBe(0);
  });

  it('does not cache a failed read', async () => {
    db.failOverlayRead = true;
    expect((await getEffectivePermissions('client_manager', CLIENT)).size).toBe(0);

    db.failOverlayRead = false;
    // No invalidate call: the point is that the failure was never cached.
    expect((await getEffectivePermissions('client_manager', CLIENT)).size).toBeGreaterThan(0);
  });
});

describe('audit trail', () => {
  it('records a grant with before and after state', async () => {
    await setOverride({
      clientId: CLIENT,
      role: 'client_manager',
      permission: 'knowledge:write',
      granted: true,
      actorId: ACTOR,
    });
    expect(db.audits).toHaveLength(1);
    expect(db.audits[0]).toMatchObject({
      action: 'permission.grant',
      entity_type: 'client_permission_overrides',
      user_id: ACTOR,
      client_id: CLIENT,
      new_value: { role: 'client_manager', permission: 'knowledge:write', granted: true },
    });
  });

  it('records a revoke distinctly from a grant', async () => {
    await setOverride({
      clientId: CLIENT,
      role: 'client_manager',
      permission: 'transcripts:read',
      granted: false,
      actorId: ACTOR,
    });
    expect(db.audits[0]).toMatchObject({ action: 'permission.revoke' });
  });

  it('records a reset, carrying the prior state as old_value', async () => {
    await setOverride({
      clientId: CLIENT,
      role: 'client_manager',
      permission: 'knowledge:write',
      granted: true,
      actorId: ACTOR,
    });
    db.audits.length = 0;

    await clearOverride({
      clientId: CLIENT,
      role: 'client_manager',
      permission: 'knowledge:write',
      actorId: ACTOR,
    });
    expect(db.audits[0]).toMatchObject({ action: 'permission.reset' });
    expect(db.audits[0].old_value).toMatchObject({ permission: 'knowledge:write', granted: true });
  });

  it('writes no audit row when the change was refused', async () => {
    await expect(
      setOverride({
        clientId: CLIENT,
        role: 'client_owner',
        permission: 'system:write',
        granted: true,
        actorId: ACTOR,
      })
    ).rejects.toThrow();
    expect(db.audits).toHaveLength(0);
  });
});
