'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useSession } from '@/lib/SessionProvider';

/**
 * Which client a staff-only page is acting on.
 *
 * Several pages are written once and serve two audiences: a client user, who has
 * exactly one tenant and should never see a picker, and staff, who have none and
 * must choose. Pages that forgot the second case simply sent no clientId, got a
 * 403, and rendered empty — which is what happened to Knowledge.
 *
 * The choice lives in the URL so a staff member can link a colleague straight to
 * "Bare Beauty's FAQs" rather than describing how to get there.
 */

export interface ClientOption {
  id: string;
  name: string;
}

/**
 * Returns the client id the page should use, or null while staff have not
 * chosen one yet. For a client user it is always their own tenant.
 */
export function useClientScope(): {
  clientId: string | null;
  needsChoice: boolean;
  ready: boolean;
} {
  const { auth, isPlatform, loading } = useSession();
  const searchParams = useSearchParams();
  const requested = searchParams.get('clientId');

  if (loading) return { clientId: null, needsChoice: false, ready: false };
  if (!isPlatform) return { clientId: auth?.clientId ?? null, needsChoice: false, ready: true };
  return { clientId: requested, needsChoice: !requested, ready: true };
}

export function ClientPicker({ label = 'Client' }: { label?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { isPlatform } = useSession();

  const [clients, setClients] = useState<ClientOption[]>([]);
  const [loading, setLoading] = useState(true);

  const selected = searchParams.get('clientId') ?? '';

  useEffect(() => {
    if (!isPlatform) return;
    api
      .get('/clients', { params: { limit: 200 } })
      .then((r) => setClients((r.data.data ?? []).map((c: ClientOption) => ({ id: c.id, name: c.name }))))
      .catch(() => setClients([]))
      .finally(() => setLoading(false));
  }, [isPlatform]);

  // A client user has nothing to choose between.
  if (!isPlatform) return null;

  const choose = (id: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (id) next.set('clientId', id);
    else next.delete('clientId');
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3 border border-panel-200 bg-surface-raised p-4">
      <div className="flex min-w-[16rem] flex-col gap-1.5">
        <label htmlFor="client-scope" className="text-2xs font-semibold uppercase tracking-[0.07em] text-panel-500">
          {label}
        </label>
        <select
          id="client-scope"
          value={selected}
          disabled={loading}
          onChange={(e) => choose(e.target.value)}
          className="cursor-pointer border border-panel-300 bg-surface-raised px-3 py-2 text-sm text-ink-900 transition-colors duration-150 hover:border-panel-400 focus:border-signal-600 focus:outline-none focus:ring-2 focus:ring-signal-600/25 disabled:cursor-wait disabled:bg-panel-50"
        >
          <option value="">{loading ? 'Loading clients…' : 'Choose a client…'}</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** Shown in place of the page body while staff have not picked a client. */
export function ChooseClientPrompt({ what }: { what: string }) {
  return (
    <div className="border border-panel-200 bg-surface-raised px-6 py-14 text-center">
      <p className="text-sm font-medium text-ink-800">Choose a client</p>
      <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-panel-500">
        {what} is configured per client. Pick one above to view or edit it.
      </p>
    </div>
  );
}
