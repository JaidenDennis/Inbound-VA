import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ALL_PERMISSIONS, ALL_ROLES, PLATFORM_ROLES, CLIENT_ROLES, roleScope } from '../types/index.js';
import { ROLE_GRANTS, MIGRATION_016 } from './helpers/rbac.js';

const migration = readFileSync(MIGRATION_016, 'utf8');

describe('permission vocabulary', () => {
  // The bug this guards: before migration 016, `tickets:read` and
  // `tickets:write` existed in code but were never seeded, and nothing failed —
  // because the seeded table was not what the middleware consulted. Now it is.
  it('every permission used in code is granted to at least one role', () => {
    const granted = new Set([...ROLE_GRANTS.values()].flatMap((s) => [...s]));
    const ungranted = ALL_PERMISSIONS.filter((p) => !granted.has(p));
    expect(ungranted).toEqual([]);
  });

  it('every permission seeded in the migration exists in the code vocabulary', () => {
    const known = new Set<string>(ALL_PERMISSIONS);
    const seeded = new Set([...ROLE_GRANTS.values()].flatMap((s) => [...s]));
    const unknown = [...seeded].filter((p) => !known.has(p));
    expect(unknown).toEqual([]);
  });

  it('seeds a grant for every role the code knows about', () => {
    for (const role of ALL_ROLES) {
      expect(ROLE_GRANTS.get(role)?.size ?? 0).toBeGreaterThan(0);
    }
  });

  it('grants no permissions to roles the code does not know about', () => {
    const known = new Set<string>(ALL_ROLES);
    expect([...ROLE_GRANTS.keys()].filter((r) => !known.has(r))).toEqual([]);
  });
});

describe('role families', () => {
  it('classifies every role into exactly one family', () => {
    for (const role of PLATFORM_ROLES) expect(roleScope(role)).toBe('platform');
    for (const role of CLIENT_ROLES) expect(roleScope(role)).toBe('client');
    expect(PLATFORM_ROLES.length + CLIENT_ROLES.length).toBe(ALL_ROLES.length);
  });

  it('super_admin holds the entire vocabulary', () => {
    const grants = ROLE_GRANTS.get('super_admin')!;
    expect([...ALL_PERMISSIONS].filter((p) => !grants.has(p))).toEqual([]);
  });

  it('no client role can reach recordings, agent config, or the system console', () => {
    for (const role of CLIENT_ROLES) {
      const grants = ROLE_GRANTS.get(role)!;
      expect(grants.has('recordings:read')).toBe(false);
      expect(grants.has('agents:write')).toBe(false);
      expect(grants.has('system:read')).toBe(false);
      expect(grants.has('system:write')).toBe(false);
      expect(grants.has('clients:write')).toBe(false);
    }
  });

  it('no client role can triage tickets, but all can raise them', () => {
    for (const role of CLIENT_ROLES) {
      const grants = ROLE_GRANTS.get(role)!;
      expect(grants.has('tickets:triage')).toBe(false);
      expect(grants.has('tickets:write')).toBe(true);
    }
  });

  it('transcripts reach owners and managers but never viewers', () => {
    expect(ROLE_GRANTS.get('client_owner')!.has('transcripts:read')).toBe(true);
    expect(ROLE_GRANTS.get('client_manager')!.has('transcripts:read')).toBe(true);
    expect(ROLE_GRANTS.get('client_viewer')!.has('transcripts:read')).toBe(false);
  });

  it('recordings reach only super_admin and support_agent', () => {
    const holders = ALL_ROLES.filter((r) => ROLE_GRANTS.get(r)?.has('recordings:read'));
    expect(holders.sort()).toEqual(['super_admin', 'support_agent']);
  });

  it('analyst is read-only', () => {
    const writes = [...ROLE_GRANTS.get('analyst')!].filter((p) => !p.endsWith(':read'));
    expect(writes).toEqual([]);
  });

  it('only client_owner may administer users inside a tenant', () => {
    expect(ROLE_GRANTS.get('client_owner')!.has('users:write')).toBe(true);
    expect(ROLE_GRANTS.get('client_manager')!.has('users:write')).toBe(false);
    expect(ROLE_GRANTS.get('client_viewer')!.has('users:write')).toBe(false);
  });
});

describe('migration 016 safety', () => {
  it('backfills every legacy role name', () => {
    for (const legacy of ['super_admin', 'admin', 'agent', 'viewer']) {
      expect(migration).toContain(`role = '${legacy}'`);
    }
  });

  it('replaces the users.role check constraint with the new role set', () => {
    expect(migration).toContain('DROP CONSTRAINT IF EXISTS users_role_check');
    for (const role of ALL_ROLES) {
      expect(migration).toContain(`'${role}'`);
    }
  });

  it('aborts rather than half-applying if any user lands in the wrong scope', () => {
    expect(migration).toContain('RAISE EXCEPTION');
    expect(migration).toMatch(/wrong scope for their client_id/);
  });
});
