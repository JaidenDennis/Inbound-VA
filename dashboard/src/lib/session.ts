// Client-side view of the signed-in user, derived by DECODING (not verifying)
// the JWT in localStorage. The backend verifies the signature on every API
// call — this is only used to choose what UI to show (e.g. client vs admin
// nav), never as a security boundary.
export type UserRole = 'super_admin' | 'admin' | 'agent' | 'viewer';

export interface Session {
  sub: string;
  email: string;
  role: UserRole;
  clientId: string | null;
  exp: number;
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
      role: (payload.role as UserRole) ?? 'viewer',
      clientId: payload.clientId ?? null,
      exp: payload.exp ?? 0,
    };
  } catch {
    return null;
  }
}

/** Platform staff (no tenant) vs a client-scoped user. */
export function isPlatformUser(session: Session | null): boolean {
  return !!session && (session.clientId === null || session.clientId === undefined);
}
