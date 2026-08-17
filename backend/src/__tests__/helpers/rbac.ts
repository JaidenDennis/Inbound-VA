import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { Permission, UserRole } from '../../types/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, '../../../../supabase/migrations');

export const MIGRATION_016 = resolve(migrationsDir, '016_rbac_role_families.sql');
export const MIGRATION_022 = resolve(migrationsDir, '022_permission_overlay.sql');
export const MIGRATION_037 = resolve(migrationsDir, '037_account_write_permission.sql');

/**
 * Migrations that seed grants, in run order.
 *
 * 016 rebuilds the table wholesale (it had drifted); 022 and 037 layer
 * additively on top. Applying them in order here reproduces what the database
 * actually holds.
 *
 * A migration that adds a grant MUST be added here, or the fixture describes a
 * database that no longer exists and the tests pass against a fiction.
 */
const GRANT_MIGRATIONS = [MIGRATION_016, MIGRATION_022, MIGRATION_037];

/**
 * The migration that most recently declared the overlay allowlist.
 *
 * 022 created the constraint; 037 re-declared it. Tests must read the LIVE
 * declaration rather than the one that happened to come first — otherwise they
 * keep asserting a boundary the database has since moved.
 */
export const OVERLAY_CONSTRAINT_MIGRATION = MIGRATION_037;

/**
 * Role → permissions, parsed out of the migrations rather than duplicated here.
 *
 * The migrations are what actually run in production, so deriving the fixture
 * from them means a grant can never be changed in SQL while the tests keep
 * asserting the old behaviour — the failure mode this whole phase exists to fix.
 */
export function grantsFromMigration(): Map<UserRole, Set<Permission>> {
  const grants = new Map<UserRole, Set<Permission>>();

  for (const file of GRANT_MIGRATIONS) {
    const sql = readFileSync(file, 'utf8');

    // Each grant block looks like:
    //   INSERT INTO permissions (role_id, permission)
    //   SELECT ... CROSS JOIN (VALUES ('a:b'), ('c:d')) AS p(permission)
    //   WHERE r.name = 'role_name';            -- 016, and some of 022
    //   WHERE r.name IN ('role_a', 'role_b');  -- 022, where a block serves several
    for (const block of sql.split('INSERT INTO permissions').slice(1)) {
      const statement = block.split(';')[0] ?? '';

      const single = statement.match(/r\.name\s*=\s*'([a-z_]+)'/)?.[1];
      const inList = statement.match(/r\.name\s+IN\s*\(([^)]+)\)/i)?.[1];
      const roles: UserRole[] = single
        ? [single as UserRole]
        : inList
          ? ([...inList.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]) as UserRole[])
          : [];
      if (roles.length === 0) continue;

      // Permission literals are the only `('word:word')` tuples in the block —
      // the role names in an IN list carry no colon, so they cannot collide.
      const permissions = [...statement.matchAll(/\('([a-z]+:[a-z]+)'\)/g)].map(
        (m) => m[1] as Permission
      );

      for (const role of roles) {
        const set = grants.get(role) ?? new Set<Permission>();
        for (const p of permissions) set.add(p);
        grants.set(role, set);
      }
    }
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
 * `getEffectivePermissions` resolves to base grants here: the overlay has its
 * own dedicated tests, and folding it in would make every unrelated route test
 * depend on overlay behaviour.
 *
 * Usage:
 *   vi.mock('../services/permission.service.js', () => permissionServiceMock());
 */
export function permissionServiceMock() {
  return {
    getRolePermissions: async (role: UserRole) => permissionsFor(role),
    getEffectivePermissions: async (role: UserRole) => permissionsFor(role),
    roleHasPermission: async (role: UserRole, permission: Permission) =>
      permissionsFor(role).has(permission),
    listRolePermissions: async (role: UserRole) => [...permissionsFor(role)].sort(),
    invalidatePermissionCache: () => {},
  };
}
