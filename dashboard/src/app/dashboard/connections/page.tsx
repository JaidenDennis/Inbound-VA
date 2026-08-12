'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, Calendar, Database, Link2, Lock, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { StatusPill } from '@/components/StatusPill';
import { LampStatus, type LampLevel } from '@/components/StatusLamp';
import { ClientPicker, ChooseClientPrompt, useClientScope } from '@/components/ClientPicker';
import { useSession } from '@/lib/SessionProvider';
import { GhlSettingsPanel } from './GhlSettingsPanel';

/**
 * Integrations for one client, in one place.
 *
 * These controls used to live inside the CRM page next to the sync log, which
 * conflated two jobs: connecting a system (rare, deliberate, per client) and
 * watching records move through it (constant, operational). They are separate
 * pages now — this one connects, /dashboard/crm watches.
 *
 * Providers whose sync path is not written yet are shown, disabled, and say so.
 * Hiding them would make the roadmap invisible; letting them connect would make
 * the console claim an integration that silently drops every record.
 */

interface Connection {
  id: string;
  name: string;
  category: 'crm' | 'calendar';
  description: string;
  authKind: 'oauth' | 'apiKey' | 'url';
  available: boolean;
  connected: boolean;
  isActiveCrm: boolean;
  lastSyncAt: string | null;
  lastUpdated: string | null;
  configuredWithoutCredential: boolean;
}

function ConnectionCard({
  connection,
  clientId,
  canWrite,
  onChanged,
}: {
  connection: Connection;
  clientId: string;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const connect = async () => {
    if (connection.id !== 'gohighlevel') return;
    setBusy(true);
    try {
      const { data } = await api.get('/crm/gohighlevel/oauth/install', { params: { clientId } });
      window.location.href = data.url;
    } catch (e) {
      toast.error(
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
          'Could not start the GoHighLevel install flow.'
      );
      setBusy(false);
    }
  };

  const makeActive = async () => {
    setBusy(true);
    try {
      await api.post('/connections/active', { provider: connection.id }, { params: { clientId } });
      toast.success(`${connection.name} is now the active CRM`);
      onChanged();
    } catch (e) {
      toast.error(
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
          'Could not change the active CRM'
      );
    } finally {
      setBusy(false);
    }
  };

  const Icon = connection.category === 'calendar' ? Calendar : Database;

  return (
    <div
      className={`border bg-surface-raised p-5 transition-colors ${
 connection.available ? 'border-panel-200' : 'border-panel-200 opacity-70'
 }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Icon className="mt-0.5 h-5 w-5 flex-shrink-0 text-panel-500" aria-hidden strokeWidth={1.75} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-heading text-sm font-semibold text-ink-900">{connection.name}</h3>
              {connection.connected && <StatusPill tone="success" label="Connected" />}
              {connection.isActiveCrm && connection.available && (
                <StatusPill tone="info" label="Active CRM" />
              )}
              {!connection.available && <StatusPill tone="neutral" label="Not available yet" />}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-panel-500">{connection.description}</p>
            {connection.lastSyncAt && (
              <p className="mt-1 text-2xs text-panel-400">
                Last sync {new Date(connection.lastSyncAt).toLocaleString()}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-shrink-0 flex-col items-end gap-2">
          {!connection.available ? (
            <span
              title="The adapter is registered but its sync path is not built yet."
              className="flex items-center gap-1.5 border border-panel-200 bg-panel-50 px-3 py-2 text-xs font-medium text-panel-500"
            >
              <Lock className="h-3.5 w-3.5" aria-hidden /> Coming soon
            </span>
          ) : !connection.connected ? (
            canWrite && (
              <button
                type="button"
                onClick={connect}
                disabled={busy}
                className="flex cursor-pointer items-center gap-1.5 bg-action px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-action-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600 focus-visible:ring-offset-2 disabled:opacity-50"
              >
                <Link2 className="h-4 w-4" aria-hidden /> {busy ? 'Opening…' : 'Connect'}
              </button>
            )
          ) : (
            canWrite &&
            !connection.isActiveCrm &&
            connection.category === 'crm' && (
              <button
                type="button"
                onClick={makeActive}
                disabled={busy}
                className="cursor-pointer border border-panel-300 bg-surface-raised px-3 py-2 text-xs font-medium text-ink-800 transition-colors hover:border-panel-400 hover:bg-panel-25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600 disabled:opacity-50"
              >
                Make active
              </button>
            )
          )}
        </div>
      </div>

      {connection.configuredWithoutCredential && (
        <div
          role="alert"
          className="mt-4 flex items-start gap-2 border border-lamp-fair-rim bg-lamp-fair-wash px-3 py-2 text-xs text-lamp-fair-ink"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden />
          <p>
            Selected as this client&apos;s CRM but nothing is authenticated behind it, so no records
            are reaching it. Connect it, or switch the active CRM.
          </p>
        </div>
      )}

      {connection.id === 'gohighlevel' && connection.connected && (
        <GhlSettingsPanel clientId={clientId} canWrite={canWrite} />
      )}
    </div>
  );
}

interface ChannelHealth {
  id: string;
  label: string;
  status: 'ok' | 'failing' | 'stalled' | 'never';
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  note: string;
}

/**
 * A stored credential is not evidence that anything works.
 *
 * `connected` says someone authenticated once, possibly in January. These lamps
 * read the event stream instead, so a token that quietly stopped working shows
 * as bad rather than as a green tick above a silent integration.
 *
 * `never` is deliberately an unlit lamp, not a red one: an integration nobody
 * has used yet is not broken, and colouring it as a fault trains people to
 * ignore the ones that are.
 */
const HEALTH_LEVEL: Record<ChannelHealth['status'], { level: LampLevel; live?: boolean }> = {
  ok: { level: 'good' },
  failing: { level: 'bad', live: true },
  stalled: { level: 'fair' },
  never: { level: 'off' },
};

function HealthStrip({ health }: { health: ChannelHealth[] }) {
  return (
    <section>
      <h2 className="mb-3 text-2xs font-semibold uppercase tracking-[0.07em] text-panel-500">
        Is it working
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {health.map((c) => {
          const { level, live } = HEALTH_LEVEL[c.status];
          return (
            <div key={c.id} className="border border-panel-200 bg-surface-raised p-4">
              <LampStatus level={level} live={live} label={c.label} />
              <p className="mt-1.5 text-xs leading-relaxed text-panel-600">{c.note}</p>
              {c.lastSuccessAt && (
                <p className="mt-1 text-2xs text-panel-500">
                  Last succeeded {new Date(c.lastSuccessAt).toLocaleString()}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ConnectionsInner() {
  const { can } = useSession();
  const canWrite = can('crm:write');
  const { clientId, needsChoice, ready } = useClientScope();

  const [connections, setConnections] = useState<Connection[]>([]);
  const [health, setHealth] = useState<ChannelHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (!clientId) return;
    setLoading(true);
    setError('');
    api
      .get('/connections', { params: { clientId } })
      .then((r) => {
        setConnections(r.data.data ?? []);
        setHealth(r.data.health ?? []);
      })
      .catch((e) => setError(e?.response?.data?.error ?? 'Could not load connections'))
      .finally(() => setLoading(false));
  }, [clientId]);

  useEffect(load, [load]);

  // The OAuth callback bounces back here with an outcome flag.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ghl = params.get('ghl');
    if (ghl === 'connected') toast.success('GoHighLevel connected');
    if (ghl === 'error') toast.error(`GoHighLevel connection failed (${params.get('reason') ?? 'unknown'})`);
  }, []);

  const crm = connections.filter((c) => c.category === 'crm');
  const calendar = connections.filter((c) => c.category === 'calendar');

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Connections"
        description="The CRMs and calendars this client's agent writes to."
        action={
          clientId && (
            <button
              type="button"
              onClick={load}
              className="flex cursor-pointer items-center gap-1.5 border border-panel-300 bg-surface-raised px-3 py-2 text-sm font-medium text-ink-800 transition-colors hover:border-panel-400 hover:bg-panel-25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600"
            >
              <RefreshCw className="h-4 w-4" aria-hidden /> Refresh
            </button>
          )
        }
      />

      <ClientPicker label="Connections for" />

      {error && (
        <div role="alert" className="mb-4 border border-lamp-bad-rim bg-lamp-bad-wash px-4 py-3 text-sm text-lamp-bad-ink">
          {error}
        </div>
      )}

      {!ready ? (
        <div className="h-64 animate-pulse bg-panel-100" />
      ) : needsChoice || !clientId ? (
        <ChooseClientPrompt what="Connections" />
      ) : loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse bg-panel-100" />
          ))}
        </div>
      ) : (
        <div className="space-y-8">
          {health.length > 0 && <HealthStrip health={health} />}

          <section>
            <h2 className="mb-3 text-2xs font-semibold uppercase tracking-[0.07em] text-panel-500">
              CRM
            </h2>
            <div className="space-y-3">
              {crm.map((c) => (
                <ConnectionCard key={c.id} connection={c} clientId={clientId} canWrite={canWrite} onChanged={load} />
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-2xs font-semibold uppercase tracking-[0.07em] text-panel-500">
              Calendar
            </h2>
            <div className="space-y-3">
              {calendar.map((c) => (
                <ConnectionCard key={c.id} connection={c} clientId={clientId} canWrite={canWrite} onChanged={load} />
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default function ConnectionsPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse bg-panel-100" />}>
      <ConnectionsInner />
    </Suspense>
  );
}
