'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Database, Plug, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { StatusPill } from '@/components/StatusPill';
import { Table, TableEmpty, TableShell, TBody, TD, TH, THead, TR } from '@/components/Table';
import { ClientPicker, ChooseClientPrompt, useClientScope } from '@/components/ClientPicker';

/**
 * CRM sync monitoring.
 *
 * Connecting a CRM moved to /dashboard/connections. This page answers the other
 * question — is what the agent captured actually arriving? — and the two were
 * previously the same screen, which meant the operational view was buried under
 * setup controls nobody touches after the first week.
 */

interface SyncLog {
  id: string;
  entity_type: string;
  entity_id: string;
  operation: string;
  status: string;
  external_id: string | null;
  error_message: string | null;
  attempts: number;
  created_at: string;
}

function CrmPageInner() {
  const { clientId, needsChoice, ready } = useClientScope();
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (!clientId) return;
    setLoading(true);
    setError('');
    api
      .get(`/crm/${clientId}/logs`)
      .then((r) => setLogs(r.data ?? []))
      .catch((e) => setError(e?.response?.data?.error ?? 'Could not load sync logs'))
      .finally(() => setLoading(false));
  }, [clientId]);

  useEffect(load, [load]);

  const failures = logs.filter((l) => l.status !== 'success').length;

  return (
    <div>
      <PageHeader
        title="CRM Sync"
        description="Whether records the agent captured are reaching the connected CRM."
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

      <ClientPicker label="Sync log for" />

      {error && (
        <div role="alert" className="mb-4 border border-lamp-bad-rim bg-lamp-bad-wash px-4 py-3 text-sm text-lamp-bad-ink">
          {error}
        </div>
      )}

      {!ready ? (
        <div className="h-64 animate-pulse bg-panel-100" />
      ) : needsChoice || !clientId ? (
        <ChooseClientPrompt what="CRM sync history" />
      ) : loading ? (
        <div className="h-64 animate-pulse bg-panel-100" />
      ) : logs.length === 0 ? (
        <TableEmpty
          icon={<Database className="h-8 w-8 text-panel-300" aria-hidden />}
          title="No sync activity yet"
          body="Records appear here once the agent captures a lead or booking and pushes it to a connected CRM."
        />
      ) : (
        <>
          {failures > 0 && (
            <div
              role="alert"
              className="mb-4 border border-lamp-bad-rim bg-lamp-bad-wash px-4 py-3 text-sm text-lamp-bad-ink"
            >
              {failures} record{failures === 1 ? '' : 's'} did not reach the CRM. Each row below shows
              why and how many attempts were made.
            </div>
          )}

          <TableShell>
            <Table caption="CRM synchronisation log">
              <THead sticky>
                <TH>Entity</TH>
                <TH>Operation</TH>
                <TH>Status</TH>
                <TH align="right">Attempts</TH>
                <TH>When</TH>
              </THead>
              <TBody>
                {logs.map((log) => (
                  <TR key={log.id}>
                    <TD className="capitalize">{log.entity_type}</TD>
                    <TD className="capitalize text-panel-600">{log.operation}</TD>
                    <TD>
                      <StatusPill
                        tone={log.status === 'success' ? 'success' : 'error'}
                        label={log.status}
                      />
                      {log.error_message && (
                        <p className="mt-1 max-w-md text-xs text-lamp-bad-ink" title={log.error_message}>
                          {log.error_message}
                        </p>
                      )}
                    </TD>
                    <TD align="right" numeric>{log.attempts}</TD>
                    <TD className="whitespace-nowrap text-panel-600">
                      {new Date(log.created_at).toLocaleString()}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableShell>
        </>
      )}

      <p className="mt-6 text-xs text-panel-500">
        Looking to connect or change a CRM?{' '}
        <Link
          href={clientId ? `/dashboard/connections?clientId=${clientId}` : '/dashboard/connections'}
          className="inline-flex items-center gap-1 text-signal-700 underline decoration-signal-200 underline-offset-2 transition-colors hover:decoration-signal-600"
        >
          <Plug className="h-3 w-3" aria-hidden /> Connections
        </Link>
      </p>
    </div>
  );
}

export default function CrmPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse bg-panel-100" />}>
      <CrmPageInner />
    </Suspense>
  );
}
