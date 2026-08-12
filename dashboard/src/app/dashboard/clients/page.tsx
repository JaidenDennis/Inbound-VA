'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { Plus, Search, Pencil, Archive, RotateCcw, Building2 } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { StatusPill } from '@/components/StatusPill';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Table, TableEmpty, TableShell, TBody, TD, TH, THead, TR } from '@/components/Table';
import { useSession } from '@/lib/SessionProvider';

/**
 * The client list.
 *
 * Edit and Delete used to be icons with no click handler — they looked like
 * controls and did nothing. Edit now routes to the client record, and Delete is
 * Archive, which is what the backend can actually honour: a client owns calls,
 * transcripts and audit rows, so it is deactivated and hidden rather than
 * destroyed, and can be restored from the archived view.
 */

interface Client {
  id: string;
  name: string;
  industry: string | null;
  status: string;
  phone_numbers: string[] | null;
  created_at: string;
}

export default function ClientsPage() {
  const { can } = useSession();
  const canWrite = can('clients:write');

  const [clients, setClients] = useState<Client[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [pendingArchive, setPendingArchive] = useState<Client | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError('');
    api
      .get('/clients', { params: showArchived ? { includeArchived: 'true' } : {} })
      .then((r) => {
        setClients(r.data.data ?? []);
        setTotal(r.data.count ?? 0);
      })
      .catch((e) => setError(e?.response?.data?.error ?? 'Could not load clients'))
      .finally(() => setLoading(false));
  }, [showArchived]);

  useEffect(load, [load]);

  const archive = async () => {
    if (!pendingArchive) return;
    setBusy(true);
    try {
      await api.delete(`/clients/${pendingArchive.id}`);
      toast.success(`${pendingArchive.name} archived`);
      setPendingArchive(null);
      load();
    } catch (e) {
      toast.error((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Could not archive that client');
    } finally {
      setBusy(false);
    }
  };

  const restore = async (client: Client) => {
    try {
      await api.patch(`/clients/${client.id}`, { status: 'active' });
      toast.success(`${client.name} restored`);
      load();
    } catch (e) {
      toast.error((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Could not restore that client');
    }
  };

  const term = query.trim().toLowerCase();
  const filtered = clients.filter(
    (c) =>
      !term ||
      c.name.toLowerCase().includes(term) ||
      (c.industry ?? '').toLowerCase().includes(term) ||
      (c.phone_numbers ?? []).some((p) => p.includes(term))
  );

  return (
    <div>
      <PageHeader
        title="Clients"
        description="Every account on the platform, and the numbers routed to each."
        breadcrumbs={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Clients' }]}
        action={
          canWrite && (
            <Link
              href="/dashboard/clients/new"
              className="inline-flex cursor-pointer items-center gap-2 bg-action px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-action-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600 focus-visible:ring-offset-2"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Add client
            </Link>
          )
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-4 border border-panel-200 bg-surface-raised p-4">
        <div className="flex min-w-[16rem] flex-1 flex-col gap-1.5">
          <label htmlFor="client-search" className="text-2xs font-semibold uppercase tracking-[0.07em] text-panel-500">
            Search
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-panel-400" aria-hidden />
            <input
              id="client-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name, industry, or phone"
              className="w-full border border-panel-300 bg-surface-raised py-2 pl-9 pr-3 text-sm text-ink-900 placeholder:text-panel-400 transition-colors duration-150 hover:border-panel-400 focus:border-signal-600 focus:outline-none focus:ring-2 focus:ring-signal-600/25"
            />
          </div>
        </div>

        <label className="flex cursor-pointer items-center gap-2 pb-2 text-sm text-panel-600">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => { setLoading(true); setShowArchived(e.target.checked); }}
            className="h-4 w-4 cursor-pointer border-panel-300 text-ink-800 focus:ring-2 focus:ring-signal-600"
          />
          Show archived
        </label>
      </div>

      {error && (
        <div role="alert" className="mb-4 border border-lamp-bad-rim bg-lamp-bad-wash px-4 py-3 text-sm text-lamp-bad-ink">
          {error}
        </div>
      )}

      {loading ? (
        <div className="h-64 animate-pulse bg-panel-100" />
      ) : filtered.length === 0 ? (
        <TableEmpty
          icon={<Building2 className="h-8 w-8 text-panel-300" aria-hidden />}
          title={term ? 'Nothing matched that search' : 'No clients yet'}
          body={term ? 'Try a shorter search, or clear it to see everyone.' : 'Add your first client to provision an agent for them.'}
        />
      ) : (
        <>
          <TableShell>
            <Table caption="Client accounts">
              <THead sticky>
                <TH>Name</TH>
                <TH>Industry</TH>
                <TH>Phone numbers</TH>
                <TH>Status</TH>
                <TH>Created</TH>
                <TH srOnly>Actions</TH>
              </THead>
              <TBody>
                {filtered.map((c) => {
                  const archived = c.status === 'inactive';
                  return (
                    <TR key={c.id} className={archived ? 'opacity-60' : undefined}>
                      <TD>
                        <Link
                          href={`/dashboard/clients/${c.id}`}
                          className="font-medium text-signal-700 underline decoration-signal-200 underline-offset-2 transition-colors hover:decoration-signal-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600"
                        >
                          {c.name}
                        </Link>
                      </TD>
                      <TD className="capitalize text-panel-600">{c.industry ?? '—'}</TD>
                      <TD mono>
                        {(c.phone_numbers ?? []).length > 0 ? (c.phone_numbers ?? []).join(', ') : '—'}
                      </TD>
                      <TD>
                        <StatusPill
                          tone={c.status === 'active' ? 'success' : archived ? 'neutral' : 'warning'}
                          label={archived ? 'Archived' : c.status}
                        />
                      </TD>
                      <TD className="whitespace-nowrap text-panel-600">
                        {new Date(c.created_at).toLocaleDateString()}
                      </TD>
                      <TD align="right">
                        {canWrite && (
                          <div className="flex justify-end gap-1">
                            {archived ? (
                              <button
                                type="button"
                                onClick={() => restore(c)}
                                className="flex cursor-pointer items-center gap-1.5 px-2 py-1 text-xs font-medium text-signal-700 transition-colors hover:bg-signal-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600"
                              >
                                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                                Restore
                              </button>
                            ) : (
                              <>
                                <Link
                                  href={`/dashboard/clients/${c.id}`}
                                  aria-label={`Edit ${c.name}`}
                                  className="flex cursor-pointer items-center gap-1.5 px-2 py-1 text-xs font-medium text-panel-600 transition-colors hover:bg-panel-50 hover:text-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600"
                                >
                                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                                  Edit
                                </Link>
                                <button
                                  type="button"
                                  onClick={() => setPendingArchive(c)}
                                  aria-label={`Archive ${c.name}`}
                                  className="flex cursor-pointer items-center gap-1.5 px-2 py-1 text-xs font-medium text-panel-600 transition-colors hover:bg-lamp-bad-wash hover:text-lamp-bad-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lamp-bad"
                                >
                                  <Archive className="h-3.5 w-3.5" aria-hidden />
                                  Archive
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </TableShell>

          <p className="mt-3 text-xs text-panel-500" role="status">
            Showing {filtered.length} of {total} client{total === 1 ? '' : 's'}.
          </p>
        </>
      )}

      <ConfirmDialog
        open={pendingArchive !== null}
        title={`Archive ${pendingArchive?.name ?? 'this client'}?`}
        body="Their agent stops taking calls and the account is hidden from this list. Calls, transcripts and history are kept, and you can restore the client at any time."
        confirmLabel="Archive client"
        busy={busy}
        onConfirm={archive}
        onCancel={() => setPendingArchive(null)}
      />
    </div>
  );
}
