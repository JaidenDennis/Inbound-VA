import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { Permission, UserRole } from '../../types/index.js';

const here = dirname(fileURLToPath(import.meta.url));
export const MIGRATION_016 = resolve(here, '../../../../supabase/migrations/016_rbac_role_families.sql');

/**
 * Role → permissions, parsed out of migration 016 rather than duplicated here.
 *
 * The migration is what actually runs in production, so deriving the fixture
 * from it means a grant can never be changed in SQL while the tests keep
 * asserting the old behaviour — the failure mode this whole phase exists to fix.
 */
export function grantsFromMigration(): Map<UserRole, Set<Permission>> {
  const sql = readFileSync(MIGRATION_016, 'utf8');
  const grants = new Map<UserRole, Set<Permission>>();

  // Each grant block looks like:
  //   INSERT INTO permissions (role_id, permission)
  //   SELECT ... CROSS JOIN (VALUES ('a:b'), ('c:d')) AS p(permission)
  //   WHERE r.name = 'role_name';
  for (const block of sql.split('INSERT INTO permissions').slice(1)) {
    const statement = block.split(';')[0] ?? '';
    const role = statement.match(/r\.name\s*=\s*'([a-z_]+)'/)?.[1] as UserRole | undefined;
    if (!role) continue;
    const permissions = [...statement.matchAll(/\('([a-z]+:[a-z]+)'\)/g)].map((m) => m[1] as Permission);
    grants.set(role, new Set(permissions));
  }

  return grants;
}

export const ROLE_GRANTS = grantsFromMigration();

export function permissionsFor(role: UserRole): Set<Permission> {
  return ROLE_GRANTS.get(role) ?? new Set();
}

/**
 * Drop-in mock for the permission service, so route tests exercise the real
 * middleware against the real grant table without touching Supabase.
 *
 * Usage:
 *   vi.mock('../services/permission.service.js', () => permissionServiceMock());
 */
export function permissionServiceMock() {
  return {
    getRolePermissions: async (role: UserRole) => permissionsFor(role),
    roleHasPermission: async (role: UserRole, permission: Permission) =>
      permissionsFor(role).has(permission),
    listRolePermissions: async (role: UserRole) => [...permissionsFor(role)].sort(),
    invalidatePermissionCache: () => {},
  };
}
