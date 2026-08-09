import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ALL_PERMISSIONS,
  ALL_ROLES,
  PLATFORM_ROLES,
  CLIENT_ROLES,
  CLIENT_SAFE_PERMISSIONS,
  roleScope,
} from '../types/index.js';
import { ROLE_GRANTS, MIGRATION_016, MIGRATION_022 } from './helpers/rbac.js';

const migration = readFileSync(MIGRATION_016, 'utf8');
const migration022 = readFileSync(MIGRATION_022, 'utf8');

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

  it('no client role can reach recordings, the system console, or tenant provisioning', () => {
    for (const role of CLIENT_ROLES) {
      const grants = ROLE_GRANTS.get(role)!;
      expect(grants.has('recordings:read')).toBe(false);
      expect(grants.has('system:read')).toBe(false);
      expect(grants.has('system:write')).toBe(false);
      expect(grants.has('clients:write')).toBe(false);
      expect(grants.has('settings:write')).toBe(false);
    }
  });

  // Migration 022 deliberately opened agent configuration to tenants: an admin
  // must be able to change hours, escalation and routing without Gravvia.
  // `agents:write` is therefore no longer the thing protecting agent BEHAVIOUR —
  // the prompt boundary in agent.service is (spec §6.3). This test records that
  // the guarantee moved rather than disappeared, so nobody re-reads the grant
  // table and concludes the prompt is client-editable.
  it('agent config is client-reachable only for owner and admin', () => {
    expect(ROLE_GRANTS.get('client_owner')!.has('agents:write')).toBe(true);
    expect(ROLE_GRANTS.get('client_admin')!.has('agents:write')).toBe(true);
    expect(ROLE_GRANTS.get('client_manager')!.has('agents:write')).toBe(false);
    expect(ROLE_GRANTS.get('client_viewer')!.has('agents:write')).toBe(false);
  });

  // The one grant separating Owner from Admin. If this ever stops being true,
  // the two roles are the same role and one of them should be deleted.
  it('configure:roles separates client_owner from client_admin', () => {
    const owner = ROLE_GRANTS.get('client_owner')!;
    const admin = ROLE_GRANTS.get('client_admin')!;
    expect(owner.has('configure:roles')).toBe(true);
    expect(admin.has('configure:roles')).toBe(false);

    // ...and it really is the ONLY configure-axis difference. `users:*` aside
    // (seat administration is owner-only by the same reasoning), the two roles
    // should otherwise match.
    const ignore = new Set(['configure:roles', 'users:read', 'users:write']);
    const ownerRest = [...owner].filter((p) => !ignore.has(p)).sort();
    const adminRest = [...admin].filter((p) => !ignore.has(p)).sort();
    expect(adminRest).toEqual(ownerRest);
  });

  it('client_viewer stays the read-only compliance role', () => {
    const grants = ROLE_GRANTS.get('client_viewer')!;
    for (const p of ['flags:write', 'callbacks:write', 'knowledge:write', 'agents:write', 'configure:roles']) {
      expect(grants.has(p as never)).toBe(false);
    }
    // Export is a read, so it is allowed; transcripts are not.
    expect(grants.has('exports:read')).toBe(true);
    expect(grants.has('transcripts:read')).toBe(false);
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

  it('aborts rather than half-applying if any user lands in the wrong scope', () => {
    expect(migration).toContain('RAISE EXCEPTION');
    expect(migration).toMatch(/wrong scope for their client_id/);
  });
});

describe('migration 022 safety', () => {
  // The users.role CHECK is re-stated by whichever migration last changed the
  // role set. That is 022 now, not 016 — asserting against 016 would pass only
  // until the next role is added, which is precisely when it needs to fail.
  it('replaces the users.role check constraint with the current role set', () => {
    expect(migration022).toContain('DROP CONSTRAINT IF EXISTS users_role_check');
    for (const role of ALL_ROLES) {
      expect(migration022).toContain(`'${role}'`);
    }
  });

  it('aborts rather than half-applying', () => {
    expect(migration022).toContain('RAISE EXCEPTION');
  });

  // The overlay's CHECK constraint and CLIENT_SAFE_PERMISSIONS are two halves of
  // one boundary. If they drift, the DB and the service disagree about what a
  // tenant may hold, and the looser of the two wins.
  it('the overlay allowlist matches CLIENT_SAFE_PERMISSIONS exactly', () => {
    const constraint = migration022.match(
      /CONSTRAINT cpo_permission_is_client_safe CHECK \(\s*permission IN \(([\s\S]*?)\)\s*\)/
    )?.[1];
    expect(constraint).toBeDefined();

    const inSql = [...constraint!.matchAll(/'([a-z]+:[a-z]+)'/g)].map((m) => m[1]).sort();
    expect(inSql).toEqual([...CLIENT_SAFE_PERMISSIONS].sort());
  });

  it('the overlay refuses platform roles at the database level', () => {
    const constraint = migration022.match(
      /CONSTRAINT cpo_role_is_client_scope CHECK \(\s*role IN \(([\s\S]*?)\)\s*\)/
    )?.[1];
    expect(constraint).toBeDefined();
    const inSql = [...constraint!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(inSql).toEqual([...CLIENT_ROLES].sort());
    for (const platform of PLATFORM_ROLES) expect(inSql).not.toContain(platform);
  });
});
