import { supabase } from '../db/index.js';
import { logger } from '../utils/index.js';
import type { Permission, UserRole } from '../types/index.js';

/**
 * Resolves role → permissions from the `permissions` table.
 *
 * Every authenticated request needs this, so it is cached in process. The TTL is
 * the revocation window: change a role's grants and the change is live within
 * CACHE_TTL_MS on every instance, without anyone re-issuing tokens. Sixty seconds
 * is short enough to be operationally safe and long enough that the DB sees at
 * most one query per role per minute per instance.
 */
const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  permissions: Set<Permission>;
  loadedAt: number;
}

const cache = new Map<UserRole, CacheEntry>();

/** Drop cached grants. Call after any write to `permissions` or `roles`. */
export function invalidatePermissionCache(role?: UserRole): void {
  if (role) cache.delete(role);
  else cache.clear();
}

async function loadPermissions(role: UserRole): Promise<Set<Permission>> {
  const { data, error } = await supabase
    .from('roles')
    .select('permissions(permission)')
    .eq('name', role)
    .maybeSingle();

  if (error) {
    // Fail closed. A DB blip must not hand out permissions the caller may not
    // have; the request 403s and the caller retries.
    logger.error({ err: error, role }, 'Failed to load role permissions — denying');
    return new Set();
  }

  const rows = (data?.permissions ?? []) as Array<{ permission: string }>;
  return new Set(rows.map((r) => r.permission as Permission));
}

export async function getRolePermissions(role: UserRole): Promise<Set<Permission>> {
  const hit = cache.get(role);
  if (hit && Date.now() - hit.loadedAt < CACHE_TTL_MS) return hit.permissions;

  const permissions = await loadPermissions(role);
  // An empty set is cached too — otherwise an unknown role hammers the DB on
  // every request. It expires like any other entry.
  cache.set(role, { permissions, loadedAt: Date.now() });
  return permissions;
}

export async function roleHasPermission(role: UserRole, permission: Permission): Promise<boolean> {
  return (await getRolePermissions(role)).has(permission);
}

/** All grants for a role, as an array — used by GET /auth/me to drive the UI. */
export async function listRolePermissions(role: UserRole): Promise<Permission[]> {
  return [...(await getRolePermissions(role))].sort();
}
