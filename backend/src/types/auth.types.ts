/**
 * Roles come in two families. The split is on tenancy: platform roles belong to
 * Gravvia staff (users.client_id IS NULL) and may act across tenants; client
 * roles belong to a single tenant. A user can never hold a role from the other
 * family — migration 016 asserts this, and userService.create enforces it.
 */
export type RoleScope = 'platform' | 'client';

export const PLATFORM_ROLES = ['super_admin', 'support_agent', 'analyst'] as const;
export const CLIENT_ROLES = [
  'client_owner',
  'client_admin',
  'client_manager',
  'client_viewer',
] as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[number];
export type ClientRole = (typeof CLIENT_ROLES)[number];
export type UserRole = PlatformRole | ClientRole;

export const ALL_ROLES: readonly UserRole[] = [...PLATFORM_ROLES, ...CLIENT_ROLES];

export function roleScope(role: UserRole): RoleScope {
  return (PLATFORM_ROLES as readonly string[]).includes(role) ? 'platform' : 'client';
}

/**
 * The full permission vocabulary. This list is the contract between code and the
 * `permissions` table — a permission referenced here that is not seeded in the DB
 * grants nothing, so `permissions.test.ts` asserts the two stay in step.
 */
export const ALL_PERMISSIONS = [
  'clients:read',
  'clients:write',
  'calls:read',
  'calls:write',
  'bookings:read',
  'bookings:write',
  'crm:read',
  'crm:write',
  'analytics:read',
  'settings:read',
  'settings:write',
  'users:read',
  'users:write',
  'tickets:read',
  'tickets:write',
  'tickets:triage',
  'transcripts:read',
  'recordings:read',
  'knowledge:read',
  'knowledge:write',
  'agents:read',
  'agents:write',
  'system:read',
  'system:write',
  // Added by migration 022 (enterprise dashboard).
  'flags:read',
  'flags:write',
  'callbacks:read',
  'callbacks:write',
  'exports:read',
  'configure:roles',
  'configure:alerts',
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

/**
 * Grants a tenant is allowed to hold, and therefore the only ones that may
 * appear in `client_permission_overrides`.
 *
 * This is defence 2 of 2 for the overlay's escalation boundary — the other is
 * the CHECK constraint in migration 022. Both exist because a single guard on a
 * privilege boundary is one edit away from being no guard: a later migration
 * that relaxes the CHECK still cannot open the hole while this list holds.
 *
 * Absences are deliberate. `recordings:read` (call audio is staff-only),
 * `system:*` (the cross-tenant console), `clients:write`, `users:*`,
 * `settings:write`, and `tickets:triage` are all platform territory, and a
 * tenant handing one to itself is exactly the failure being prevented.
 *
 * Keep in step with the `cpo_permission_is_client_safe` constraint;
 * `client-permission-overlay.test.ts` asserts the two match.
 */
export const CLIENT_SAFE_PERMISSIONS = [
  'clients:read',
  'calls:read',
  'bookings:read',
  'bookings:write',
  'analytics:read',
  'settings:read',
  'tickets:read',
  'tickets:write',
  'transcripts:read',
  'knowledge:read',
  'knowledge:write',
  'agents:read',
  'agents:write',
  'crm:read',
  'crm:write',
  'flags:read',
  'flags:write',
  'callbacks:read',
  'callbacks:write',
  'exports:read',
  'configure:roles',
  'configure:alerts',
] as const satisfies readonly Permission[];

export type ClientSafePermission = (typeof CLIENT_SAFE_PERMISSIONS)[number];

export function isClientSafePermission(p: string): p is ClientSafePermission {
  return (CLIENT_SAFE_PERMISSIONS as readonly string[]).includes(p);
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  client_id: string | null;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Permissions are deliberately NOT in the token. They are resolved per request
 * from the database (through a short-lived cache) so revoking a grant takes
 * effect within the cache TTL instead of waiting out a 7-day token.
 */
export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  clientId: string | null;
  iat: number;
  exp: number;
}

export interface ApiKey {
  id: string;
  client_id: string;
  name: string;
  key_hash: string;
  permissions: Permission[];
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}
