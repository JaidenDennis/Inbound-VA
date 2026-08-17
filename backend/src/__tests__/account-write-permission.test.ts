import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ALL_PERMISSIONS,
  CLIENT_SAFE_PERMISSIONS,
  CLIENT_ROLES,
  isClientSafePermission,
} from '../types/index.js';
import { ROLE_GRANTS, MIGRATION_037 } from './helpers/rbac.js';

const migration037 = readFileSync(MIGRATION_037, 'utf8');

/**
 * `account:write` — a tenant editing its OWN account details.
 *
 * The bug: Settings gated the business profile and the billing notification
 * email on `settings:write`, which migration 022 deliberately makes
 * platform-only. A client_owner therefore could not change their own contact
 * name, address, or where their invoices go — the fields rendered disabled and
 * the PUT would have 403'd anyway.
 *
 * Granting `settings:write` to a tenant was never the fix: that one grant also
 * opens /admin/retry-job, tenant provisioning, and platform alert config. The
 * two things were conflated under one name, so they are separated here —
 * `settings:write` stays platform territory, `account:write` is the tenant's
 * own record.
 */
describe('account:write exists as a client-safe grant', () => {
  it('is in the permission vocabulary', () => {
    expect([...ALL_PERMISSIONS]).toContain('account:write');
  });

  it('is client-safe, so the overlay may grant it', () => {
    expect([...CLIENT_SAFE_PERMISSIONS]).toContain('account:write');
    expect(isClientSafePermission('account:write')).toBe(true);
  });
});

describe('who holds account:write', () => {
  // The roles that administer an account: the owner and the admin. Both already
  // hold settings:read, so both already SEE the page they could not save.
  it.each(['client_owner', 'client_admin'])('%s can edit their own account', (role) => {
    expect(ROLE_GRANTS.get(role as never)?.has('account:write')).toBe(true);
  });

  // Staff edit a client's profile through the client picker. super_admin held
  // settings:write and could do this before 037; it must not lose the ability.
  it('super_admin keeps it', () => {
    expect(ROLE_GRANTS.get('super_admin')?.has('account:write')).toBe(true);
  });

  // These two cannot reach Settings at all — they lack settings:read — so a
  // write grant would be dead weight that widens the blast radius for nothing.
  it.each(['client_manager', 'client_viewer'])('%s does not get it', (role) => {
    expect(ROLE_GRANTS.get(role as never)?.has('account:write')).toBe(false);
  });
});

describe('the platform boundary still holds', () => {
  // The whole point of splitting the grant. If this ever passes by way of a
  // client role gaining settings:write, the split has been undone.
  it('no client role gained settings:write', () => {
    for (const role of CLIENT_ROLES) {
      expect(ROLE_GRANTS.get(role)?.has('settings:write')).toBe(false);
    }
  });

  it('037 does not grant a platform-only permission to a client role', () => {
    const platformOnly = [
      'settings:write',
      'system:read',
      'system:write',
      'recordings:read',
      'clients:write',
      'tickets:triage',
    ];
    for (const role of CLIENT_ROLES) {
      const grants = ROLE_GRANTS.get(role) ?? new Set();
      for (const p of platformOnly) expect(grants.has(p as never)).toBe(false);
    }
  });

  it('aborts rather than half-applying', () => {
    expect(migration037).toContain('RAISE EXCEPTION');
  });
});
