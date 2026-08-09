// Client-side view of the signed-in user.
//
// Identity (role, tenant) is DECODED — not verified — from the JWT in
// localStorage. Permissions come from GET /auth/me, which resolves them from the
// database. Neither is a security boundary: the backend verifies the signature
// and re-checks the permission on every request. This exists only to decide what
// UI to render, so a tampered token buys a broken-looking page and nothing more.

export type RoleScope = 'platform' | 'client';

export const PLATFORM_ROLES = ['super_admin', 'support_agent', 'analyst'] as const;
// client_admin arrived with migration 022 and was never added here, so the
// console typed it as an unknown role. Owner and Admin differ on exactly one
// grant: configure:roles.
export const CLIENT_ROLES = ['client_owner', 'client_admin', 'client_manager', 'client_viewer'] as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[number];
export type ClientRole = (typeof CLIENT_ROLES)[number];
export type UserRole = PlatformRole | ClientRole;

export type Permission =
  | 'clients:read'
  | 'clients:write'
  | 'calls:read'
  | 'calls:write'
  | 'bookings:read'
  | 'bookings:write'
  | 'crm:read'
  | 'crm:write'
  | 'analytics:read'
  | 'settings:read'
  | 'settings:write'
  | 'users:read'
  | 'users:write'
  | 'tickets:read'
  | 'tickets:write'
  | 'tickets:triage'
  | 'transcripts:read'
  | 'recordings:read'
  | 'knowledge:read'
  | 'knowledge:write'
  | 'agents:read'
  | 'agents:write'
  | 'system:read'
  | 'system:write'
  // Added by migration 022 for the enterprise dashboard: the manager work queue,
  // exports, and the two configure-axis grants.
  | 'flags:read'
  | 'flags:write'
  | 'callbacks:read'
  | 'callbacks:write'
  | 'exports:read'
  | 'configure:roles'
  | 'configure:alerts';

export interface Session {
  sub: string;
  email: string;
  role: UserRole;
  clientId: string | null;
  exp: number;
}

/** Session plus the permissions fetched from the API. */
export interface AuthState extends Session {
  name: string;
  permissions: Permission[];
}

const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  support_agent: 'Support',
  analyst: 'Analyst',
  client_owner: 'Owner',
  client_admin: 'Admin',
  client_manager: 'Manager',
  client_viewer: 'Viewer',
};

export function roleLabel(role: UserRole): string {
  return ROLE_LABELS[role] ?? role;
}

export function getSession(): Session | null {
  if (typeof window === 'undefined') return null;
  const token = localStorage.getItem('gravvia_token');
  if (!token) return null;
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    // UTF-8 safe base64 decode (handles non-ASCII names in the payload).
    const json = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join('')
    );
    const payload = JSON.parse(json) as Partial<Session>;
    if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) return null;
    if (!payload.sub) return null;
    return {
      sub: payload.sub,
      email: payload.email ?? '',
      role: (payload.role as UserRole) ?? 'client_viewer',
      clientId: payload.clientId ?? null,
      exp: payload.exp ?? 0,
    };
  } catch {
    return null;
  }
}

/** Platform staff (no tenant) vs a client-scoped user. */
export function isPlatformUser(session: Pick<Session, 'clientId'> | null): boolean {
  return !!session && (session.clientId === null || session.clientId === undefined);
}

export function scopeOf(session: Pick<Session, 'clientId'> | null): RoleScope {
  return isPlatformUser(session) ? 'platform' : 'client';
}

export function clearSession(): void {
  localStorage.removeItem('gravvia_token');
  document.cookie = 'gravvia_token=; max-age=0; path=/';
}
