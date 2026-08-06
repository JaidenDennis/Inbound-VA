'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { ChartCard, ChartTable } from '@/components/charts/ChartCard';
import { VolumeChart, type VolumePoint } from '@/components/charts/VolumeChart';
import { OutcomeChart, OUTCOME_LABELS, type OutcomePoint } from '@/components/charts/OutcomeChart';
import { Drawer } from '@/components/Drawer';
import { StatusPill } from '@/components/StatusPill';
import { useSession } from '@/lib/SessionProvider';
import { type Milestone } from '@/lib/onboarding';
import {
  PhoneCall, PhoneIncoming, UserPlus, CalendarCheck, Clock, Lock,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface Kpis {
  callsAnswered: number;
  missedCallsRecovered: number;
  leadsRecaptured: number;
  appointmentsBooked: number;
  avgCallDurationSeconds: number;
  totalCalls: number;
}

interface CallRow {
  id: string;
  from_number: string | null;
  started_at: string;
  duration_seconds: number | null;
  outcome: string;
  user_sentiment: string | null;
  has_transcript: boolean;
}

interface TranscriptTurn {
  role: string;
  content: string;
}

type RangeKey = '7' | '30' | '90';

const RANGES: { key: RangeKey; label: string }[] = [
  { key: '7', label: 'Last 7 days' },
  { key: '30', label: 'Last 30 days' },
  { key: '90', label: 'Last 90 days' },
];

const KPI_CARDS: { key: keyof Kpis; label: string; icon: LucideIcon; format?: (n: number) => string }[] = [
  { key: 'callsAnswered', label: 'Calls answered', icon: PhoneCall },
  { key: 'missedCallsRecovered', label: 'Missed calls recovered', icon: PhoneIncoming },
  { key: 'leadsRecaptured', label: 'Leads captured', icon: UserPlus },
  { key: 'appointmentsBooked', label: 'Appointments booked', icon: CalendarCheck },
  {
    key: 'avgCallDurationSeconds',
    label: 'Average call length',
    icon: Clock,
    format: (s) => `${Math.floor(s / 60)}m ${s % 60}s`,
  },
];

function ReportsPageInner() {
  const { can } = useSession();
  const canReadTranscripts = can('transcripts:read');

  const [range, setRange] = useState<RangeKey>('30');
  const [milestones, setMilestones] = useState<Milestone[] | null>(null);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [volume, setVolume] = useState<VolumePoint[]>([]);
  const [bucket, setBucket] = useState<'day' | 'week'>('day');
  const [outcomes, setOutcomes] = useState<OutcomePoint[]>([]);
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [selected, setSelected] = useState<CallRow | null>(null);
  const [transcript, setTranscript] = useState<TranscriptTurn[] | null>(null);
  const [transcriptError, setTranscriptError] = useState('');

  useEffect(() => {
    api.get('/onboarding').then((r) => setMilestones(r.data.data ?? [])).catch(() => setMilestones([]));
  }, []);

  // Reporting is empty until the agent is live, which is correct rather than an
  // error — a pre-launch client has no calls to report on.
  const isLive = !!milestones?.find((m) => m.stage_key === 'go_live' && m.status === 'complete');

  const load = useCallback(() => {
    const from = new Date(Date.now() - Number(range) * 24 * 60 * 60 * 1000).toISOString();
    const to = new Date().toISOString();
    const params = { from, to };

    setLoading(true);
    setError('');
    Promise.all([
      api.get('/reports/kpis', { params }),
      api.get('/reports/volume', { params }),
      api.get('/reports/outcomes', { params }),
      api.get('/reports/calls', { params: { ...params, limit: 25 } }),
    ])
      .then(([k, v, o, c]) => {
        setKpis(k.data);
        setVolume(v.data.data ?? []);
        setBucket(v.data.bucket ?? 'day');
        setOutcomes(o.data.data ?? []);
        setCalls(c.data.data ?? []);
      })
      .catch((e) => setError(e?.response?.data?.error ?? 'Could not load your reports'))
      .finally(() => setLoading(false));
  }, [range]);

  useEffect(() => {
    if (isLive) load();
    else setLoading(false);
  }, [isLive, load]);

  const openCall = async (row: CallRow) => {
    setSelected(row);
    setTranscript(null);
    setTranscriptError('');
    if (!row.has_transcript || !canReadTranscripts) return;
    try {
      const r = await api.get(`/reports/calls/${row.id}/transcript`);
      setTranscript(r.data.transcript ?? []);
    } catch {
      setTranscriptError('Could not load the transcript for this call.');
    }
  };

  if (!isLive && milestones !== null) {
    return (
      <div>
        <PageHeader title="Reports" description="Your call performance." />
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
          <p className="text-lg text-gray-600">Reporting starts when your agent goes live</p>
          <p className="mt-1 text-sm text-gray-400">
            Finish onboarding and your calls will appear here automatically.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Reports"
        description="What your AI agent did on your calls."
        action={
          <div className="flex gap-1 rounded-lg border border-gray-200 bg-white p-1">
            {RANGES.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => setRange(r.key)}
                aria-pressed={range === r.key}
                className={`cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 ${
                  range === r.key ? 'bg-primary-50 text-primary-700' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        }
      />

      {error && (
        <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* KPI row — five headline numbers are stat tiles, not a bar chart. */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {KPI_CARDS.map(({ key, label, icon: Icon, format }) => (
          <div key={key} className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="mb-2 flex items-center gap-2">
              <Icon className="h-4 w-4 text-gray-400" aria-hidden />
              <p className="text-xs font-medium text-gray-500">{label}</p>
            </div>
            {loading ? (
              <div className="h-8 w-16 animate-pulse rounded bg-gray-100" />
            ) : (
              <p className="text-2xl font-bold text-gray-900">
                {format ? format(kpis?.[key] ?? 0) : (kpis?.[key] ?? 0).toLocaleString()}
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartCard
          title="Call volume"
          subtitle={`Answered and voicemail, by ${bucket}`}
          table={
            <ChartTable
              headers={['Period', 'Answered', 'Voicemail', 'Total']}
              rows={volume.map((v) => [
                new Date(v.bucket).toLocaleDateString(),
                v.answered,
                v.voicemail,
                v.total,
              ])}
            />
          }
        >
          {loading ? (
            <div className="h-64 animate-pulse rounded-lg bg-gray-50" />
          ) : (
            <VolumeChart data={volume} bucket={bucket} />
          )}
        </ChartCard>

        <ChartCard
          title="Call outcomes"
          subtitle="Where each call ended up"
          table={
            <ChartTable
              headers={['Outcome', 'Calls']}
              rows={outcomes.map((o) => [OUTCOME_LABELS[o.outcome] ?? o.outcome, o.count])}
            />
          }
        >
          {loading ? (
            <div className="h-64 animate-pulse rounded-lg bg-gray-50" />
          ) : (
            <OutcomeChart data={outcomes} />
          )}
        </ChartCard>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-5 py-4">
          <h2 className="font-heading text-base font-semibold text-gray-900">Recent calls</h2>
          <p className="mt-0.5 text-sm text-gray-500">The most recent 25 calls in this period.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <caption className="sr-only">Recent calls</caption>
            <thead className="bg-gray-50">
              <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase tracking-wide text-gray-700">
                <th scope="col" className="px-5 py-3">Caller</th>
                <th scope="col" className="px-5 py-3">When</th>
                <th scope="col" className="px-5 py-3">Length</th>
                <th scope="col" className="px-5 py-3">Outcome</th>
                <th scope="col" className="px-5 py-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {calls.map((c) => (
                <tr key={c.id} className="text-sm transition-colors hover:bg-gray-50">
                  <td className="px-5 py-3 font-mono text-xs text-gray-700">{c.from_number ?? 'Unknown'}</td>
                  <td className="px-5 py-3 text-gray-600">{new Date(c.started_at).toLocaleString()}</td>
                  <td className="px-5 py-3 tabular-nums text-gray-600">
                    {c.duration_seconds != null
                      ? `${Math.floor(c.duration_seconds / 60)}m ${c.duration_seconds % 60}s`
                      : '—'}
                  </td>
                  <td className="px-5 py-3 text-gray-700">{OUTCOME_LABELS[c.outcome] ?? c.outcome}</td>
                  <td className="px-5 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => openCall(c)}
                      className="cursor-pointer rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      Details
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && calls.length === 0 && (
                <tr><td colSpan={5} className="px-5 py-10 text-center text-gray-400">No calls in this period</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Drawer
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.from_number ?? 'Call'}
      >
        {selected && (
          <div className="space-y-5 text-sm">
            <dl className="grid grid-cols-2 gap-4">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">When</dt>
                <dd className="mt-1 text-gray-800">{new Date(selected.started_at).toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Outcome</dt>
                <dd className="mt-1 text-gray-800">{OUTCOME_LABELS[selected.outcome] ?? selected.outcome}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Length</dt>
                <dd className="mt-1 text-gray-800">
                  {selected.duration_seconds != null
                    ? `${Math.floor(selected.duration_seconds / 60)}m ${selected.duration_seconds % 60}s`
                    : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Sentiment</dt>
                <dd className="mt-1 text-gray-800">{selected.user_sentiment ?? '—'}</dd>
              </div>
            </dl>

            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Transcript</p>

              {!canReadTranscripts ? (
                <div className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-gray-600">
                  <Lock className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
                  <p>
                    Call transcripts contain caller personal details, so they are limited to account
                    owners and managers. Ask an owner if you need access.
                  </p>
                </div>
              ) : !selected.has_transcript ? (
                <p className="text-gray-400">No transcript was recorded for this call.</p>
              ) : transcriptError ? (
                <p role="alert" className="text-red-600">{transcriptError}</p>
              ) : transcript === null ? (
                <div className="h-32 animate-pulse rounded-lg bg-gray-50" />
              ) : (
                <div className="space-y-2">
                  {transcript.map((turn, i) => (
                    <div key={i} className={turn.role === 'agent' ? 'flex justify-end' : 'flex'}>
                      <div
                        className={`max-w-sm rounded-xl px-3 py-2 ${
                          turn.role === 'agent' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        <p className={`mb-0.5 text-xs ${turn.role === 'agent' ? 'text-primary-100' : 'text-gray-500'}`}>
                          {turn.role === 'agent' ? 'Agent' : 'Caller'}
                        </p>
                        {turn.content}
                      </div>
                    </div>
                  ))}
                  {transcript.length === 0 && <p className="text-gray-400">The transcript is empty.</p>}
                </div>
              )}
            </div>

            {selected.has_transcript && canReadTranscripts && (
              <StatusPill tone="info" label="Call audio is available to Gravvia support for troubleshooting" />
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}

export default function ReportsPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-gray-100" />}>
      <ReportsPageInner />
    </Suspense>
  );
}
