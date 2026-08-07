'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { getSession, type AuthState, type Permission, type UserRole } from '@/lib/session';

interface SessionContextValue {
  auth: AuthState | null;
  /** True until /auth/me resolves. Render skeletons, not an empty nav. */
  loading: boolean;
  can: (permission: Permission) => boolean;
  isPlatform: boolean;
}

/** Exported so tests and visual harnesses can supply a session without a backend. */
export const SessionContext = createContext<SessionContextValue>({
  auth: null,
  loading: true,
  can: () => false,
  isPlatform: false,
});

/**
 * Loads the signed-in user's permissions once per session and shares them.
 *
 * Nav items and controls gate on `can()` so the UI matches what the API will
 * actually allow. Every route still re-checks server-side — hiding a button is
 * a usability decision, not a security one.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const session = getSession();
    if (!session) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    api
      .get('/auth/me')
      .then((r) => {
        if (cancelled) return;
        const me = r.data as {
          id: string;
          email: string;
          name: string;
          role: UserRole;
          client_id: string | null;
          permissions: Permission[];
        };
        setAuth({
          sub: me.id,
          email: me.email,
          name: me.name,
          role: me.role,
          clientId: me.client_id,
          exp: session.exp,
          permissions: me.permissions ?? [],
        });
      })
      .catch(() => {
        // A failed /auth/me leaves permissions empty, so the UI degrades to
        // "nothing available" rather than showing controls that will 403.
        if (!cancelled) setAuth(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<SessionContextValue>(() => {
    const granted = new Set(auth?.permissions ?? []);
    return {
      auth,
      loading,
      can: (permission: Permission) => granted.has(permission),
      isPlatform: !!auth && auth.clientId === null,
    };
  }, [auth, loading]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  return useContext(SessionContext);
}

/** Convenience for a single permission check. */
export function useCan(permission: Permission): boolean {
  return useSession().can(permission);
}
