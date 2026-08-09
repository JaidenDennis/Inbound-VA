import { supabase } from '../db/index.js';
import { logger } from '../utils/index.js';
import { isClientSafePermission, type Permission, type UserRole } from '../types/index.js';

/**
 * Resolves a caller's grants.
 *
 * Two layers:
 *
 *   BASE     `roles` → `permissions`. Global, one set per role. Seeded by
 *            migrations 016 and 022.
 *   OVERLAY  `client_permission_overrides`. Per tenant, per role. Lets an
 *            enterprise buyer be given a variation without shipping a new role
 *            for every request.
 *
 * effective = base ∪ {granted overrides} − {revoked overrides}
 *
 * Platform users (client_id IS NULL) never touch the overlay. There is no
 * tenant to scope it to, and a platform grant must not be reachable from
 * tenant-editable data — see the escalation note on CLIENT_SAFE_PERMISSIONS.
 *
 * Every authenticated request needs this, so it is cached in process. The TTL is
 * the revocation window: change a grant and the change is live within
 * CACHE_TTL_MS on every instance, without anyone re-issuing tokens. Sixty seconds
 * is short enough to be operationally safe and long enough that the DB sees at
 * most one query per key per minute per instance.
 */
const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  permissions: Set<Permission>;
  loadedAt: number;
}

/** Keyed by role for base grants, and by `role|clientId` for effective ones. */
const cache = new Map<string, CacheEntry>();

const effectiveKey = (role: UserRole, clientId: string): string => `${role}|${clientId}`;

/**
 * Drop cached grants.
 *
 * Call after any write to `permissions`, `roles`, or `client_permission_overrides`.
 * With no argument it clears everything, which is what a `permissions` write
 * needs — a base-grant change invalidates every tenant's effective set too.
 */
export function invalidatePermissionCache(role?: UserRole, clientId?: string): void {
  if (!role) {
    cache.clear();
    return;
  }
  if (clientId) {
    cache.delete(effectiveKey(role, clientId));
    return;
  }
  // A role-level change invalidates that role's base entry and every tenant
  // overlay derived from it.
  cache.delete(role);
  for (const key of cache.keys()) {
    if (key.startsWith(`${role}|`)) cache.delete(key);
  }
}

async function loadBase(role: UserRole): Promise<Set<Permission>> {
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

/** Base grants for a role, before any tenant overlay. */
export async function getRolePermissions(role: UserRole): Promise<Set<Permission>> {
  const hit = cache.get(role);
  if (hit && Date.now() - hit.loadedAt < CACHE_TTL_MS) return hit.permissions;

  const permissions = await loadBase(role);
  // An empty set is cached too — otherwise an unknown role hammers the DB on
  // every request. It expires like any other entry.
  cache.set(role, { permissions, loadedAt: Date.now() });
  return permissions;
}

async function loadOverlay(
  role: UserRole,
  clientId: string
): Promise<Array<{ permission: string; granted: boolean }>> {
  const { data, error } = await supabase
    .from('client_permission_overrides')
    .select('permission, granted')
    .eq('client_id', clientId)
    .eq('role', role);

  if (error) {
    // Fail closed on the ADDITIVE half only. Returning [] here means the caller
    // falls back to base grants, which is the safe direction for a grant but the
    // UNSAFE direction for a revoke — a tenant that revoked transcripts:read
    // would silently get it back during an outage. So a failed overlay read is
    // treated as "deny everything beyond the intersection": we surface the error
    // and hand back an empty effective set rather than guessing.
    logger.error({ err: error, role, clientId }, 'Failed to load permission overlay — denying');
    throw new Error('permission-overlay-unavailable');
  }

  return (data ?? []) as Array<{ permission: string; granted: boolean }>;
}

/**
 * The grants a caller actually holds: base for platform users, base plus the
 * tenant overlay for client users.
 */
export async function getEffectivePermissions(
  role: UserRole,
  clientId: string | null | undefined
): Promise<Set<Permission>> {
  if (!clientId) return getRolePermissions(role);

  const key = effectiveKey(role, clientId);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.loadedAt < CACHE_TTL_MS) return hit.permissions;

  const base = await getRolePermissions(role);

  let overrides: Array<{ permission: string; granted: boolean }>;
  try {
    overrides = await loadOverlay(role, clientId);
  } catch {
    // Fail closed; do NOT cache a failure, so the next request retries.
    return new Set();
  }

  const effective = new Set(base);
  for (const { permission, granted } of overrides) {
    // Re-check the allowlist on READ as well as on write. A row that predates a
    // constraint change, or arrived by direct SQL, must not grant anything the
    // tenant boundary forbids.
    if (granted && isClientSafePermission(permission)) {
      effective.add(permission as Permission);
    } else if (!granted) {
      // Revokes are honoured unconditionally: taking access away is always safe.
      effective.delete(permission as Permission);
    }
  }

  cache.set(key, { permissions: effective, loadedAt: Date.now() });
  return effective;
}

export async function roleHasPermission(role: UserRole, permission: Permission): Promise<boolean> {
  return (await getRolePermissions(role)).has(permission);
}

/** All effective grants for a caller, as an array — drives GET /auth/me and the UI. */
export async function listRolePermissions(
  role: UserRole,
  clientId?: string | null
): Promise<Permission[]> {
  return [...(await getEffectivePermissions(role, clientId))].sort();
}
