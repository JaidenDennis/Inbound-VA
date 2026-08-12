'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { StatusPill, type Tone } from '@/components/StatusPill';
import { useSession } from '@/lib/SessionProvider';
import { CallIntelligence } from './CallIntelligence';

interface TranscriptTurn { role: string; content: string }

interface CallDetail {
  call: Record<string, unknown>;
  transcript: { transcript: TranscriptTurn[] } | null;
  summary: { summary: string; sentiment: string; action_items: string[] } | null;
  conversation: Record<string, unknown> | null;
}

const STATUS_TONES: Record<string, Tone> = {
  completed: 'success',
  in_progress: 'pending',
  failed: 'error',
  transferred: 'warning',
  no_answer: 'warning',
};

function formatNumber(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : '';
  if (!s) return '—';
  const digits = s.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return s;
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="border border-panel-200 bg-surface-raised p-4">
      <p className="text-2xs font-semibold uppercase tracking-[0.07em] text-panel-500">{label}</p>
      <p className={`mt-1 text-sm font-medium text-ink-900 ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  );
}

export default function CallDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const canReadTranscript = can('transcripts:read');

  const [detail, setDetail] = useState<CallDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get(`/admin/calls/${id}`)
      .then((r) => setDetail(r.data))
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="h-64 animate-pulse bg-panel-100" />;
  if (!detail) {
    return (
      <div role="alert" className="border border-lamp-bad-rim bg-lamp-bad-wash px-4 py-3 text-sm text-lamp-bad-ink">
        That call could not be found.
      </div>
    );
  }

  const { call, transcript, summary } = detail;
  const seconds = call.duration_seconds != null ? Number(call.duration_seconds) : null;
  const status = String(call.status ?? 'unknown');

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Call detail"
        description={call.started_at ? new Date(String(call.started_at)).toLocaleString() : undefined}
        breadcrumbs={[
          { label: 'Calls', href: '/dashboard/calls' },
          { label: formatNumber(call.from_number) },
        ]}
        action={<StatusPill tone={STATUS_TONES[status] ?? 'neutral'} label={status.replace(/_/g, ' ')} />}
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat label="From" value={formatNumber(call.from_number)} mono />
        <Stat label="To" value={formatNumber(call.to_number)} mono />
        <Stat
          label="Duration"
          value={seconds == null ? '—' : seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`}
        />
      </div>

      {canReadTranscript && <CallIntelligence callId={id} />}

      {summary && (
        <section className="mb-4 border border-panel-200 bg-surface-raised">
          <h2 className="border-b border-panel-200 px-5 py-3.5 font-heading text-sm font-semibold text-ink-900">
            Summary
          </h2>
          <div className="p-5">
            <p className="text-sm leading-relaxed text-ink-800">{summary.summary}</p>
            {summary.action_items?.length > 0 && (
              <ul className="mt-3 space-y-1">
                {summary.action_items.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-panel-700">
                    <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-panel-400" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {transcript && (
        <section className="border border-panel-200 bg-surface-raised">
          <h2 className="border-b border-panel-200 px-5 py-3.5 font-heading text-sm font-semibold text-ink-900">
            Transcript
          </h2>
          <div className="max-h-[32rem] space-y-3 overflow-y-auto p-5">
            {transcript.transcript.map((turn, i) => {
              const isAgent = turn.role === 'agent';
              return (
                <div key={i} className={isAgent ? 'flex justify-end' : 'flex justify-start'}>
                  <div className="max-w-md">
                    <p className={`mb-1 text-2xs font-semibold uppercase tracking-[0.07em] text-panel-500 ${isAgent ? 'text-right' : ''}`}>
                      {isAgent ? 'Agent' : 'Caller'}
                    </p>
                    <div
                      className={`px-3.5 py-2.5 text-sm leading-relaxed ${
 isAgent ? 'bg-surface-dark text-white' : 'bg-panel-100 text-ink-800'
 }`}
                    >
                      {turn.content}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
