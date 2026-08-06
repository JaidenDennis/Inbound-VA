/**
 * Roles come in two families. The split is on tenancy: platform roles belong to
 * Gravvia staff (users.client_id IS NULL) and may act across tenants; client
 * roles belong to a single tenant. A user can never hold a role from the other
 * family — migration 016 asserts this, and userService.create enforces it.
 */
export type RoleScope = 'platform' | 'client';

export const PLATFORM_ROLES = ['super_admin', 'support_agent', 'analyst'] as const;
export const CLIENT_ROLES = ['client_owner', 'client_manager', 'client_viewer'] as const;

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
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

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
