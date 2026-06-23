'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { type Milestone } from '@/lib/onboarding';
import { PageHeader } from '@/components/PageHeader';
import { PhoneCall, PhoneIncoming, UserPlus, CalendarCheck, Clock, BarChart2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface Stats {
  callsAnswered: number;
  missedCallsRecovered: number;
  leadsRecaptured: number;
  appointmentsBooked: number;
  avgCallDurationSeconds: number;
  period: { from: string; to: string };
}

type RangeKey = '7' | '30' | 'custom';

function fmtDuration(s: number): string {
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

const cardMeta: { key: keyof Stats; label: string; icon: LucideIcon; tint: string; ring: string }[] = [
  { key: 'callsAnswered', label: 'Calls Answered', icon: PhoneCall, tint: 'bg-primary-50 text-primary-600', ring: 'ring-primary-100' },
  { key: 'missedCallsRecovered', label: 'Missed Calls Recovered', icon: PhoneIncoming, tint: 'bg-emerald-50 text-emerald-600', ring: 'ring-emerald-100' },
  { key: 'leadsRecaptured', label: 'Leads Recaptured', icon: UserPlus, tint: 'bg-secondary-50 text-secondary-600', ring: 'ring-secondary-100' },
  { key: 'appointmentsBooked', label: 'Appointments Booked', icon: CalendarCheck, tint: 'bg-violet-50 text-violet-600', ring: 'ring-violet-100' },
  { key: 'avgCallDurationSeconds', label: 'Avg Call Duration', icon: Clock, tint: 'bg-amber-50 text-amber-600', ring: 'ring-amber-100' },
];

export default function StatsPage() {
  const [milestones, setMilestones] = useState<Milestone[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [range, setRange] = useState<RangeKey>('30');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  useEffect(() => {
    api.get('/onboarding').then((r) => setMilestones(r.data.data ?? [])).catch(() => setMilestones([]));
  }, []);

  const isLive = !!milestones?.find((m) => m.stage_key === 'go_live' && m.status === 'complete');

  const loadStats = useCallback(() => {
    let from: string | undefined;
    let to: string | undefined;
    if (range === 'custom') {
      if (!customFrom || !customTo) return;
      from = new Date(customFrom).toISOString();
      to = new Date(customTo).toISOString();
    } else {
      from = new Date(Date.now() - Number(range) * 24 * 60 * 60 * 1000).toISOString();
      to = new Date().toISOString();
    }
    api.get('/stats', { params: { from, to } }).then((r) => setStats(r.data));
  }, [range, customFrom, customTo]);

  useEffect(() => {
    if (isLive) loadStats();
  }, [isLive, loadStats]);

  if (milestones === null) {
    return (
      <div>
        <PageHeader title="Performance" description="Live results from your AI voice agent" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-xl bg-gray-200" />
          ))}
        </div>
      </div>
    );
  }

  if (!isLive) {
    return (
      <div>
        <PageHeader title="Performance" description="Live results from your AI voice agent" />
        <div className="card flex flex-col items-center px-6 py-16 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary-50">
            <BarChart2 className="h-7 w-7 text-primary-600" />
          </div>
          <p className="text-lg font-semibold text-gray-900">Your stats will appear here once you&apos;re live</p>
          <p className="mt-1.5 max-w-sm text-sm text-gray-500">
            We&apos;ll switch this on automatically the moment your &ldquo;Go Live&rdquo; stage is complete.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Performance" description="Live results from your AI voice agent" />

      {/* Range filter */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1 shadow-xs">
          {(['7', '30', 'custom'] as RangeKey[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`cursor-pointer rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors duration-200 ${
                range === r ? 'bg-primary-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {r === '7' ? 'Last 7 days' : r === '30' ? 'Last 30 days' : 'Custom'}
            </button>
          ))}
        </div>
        {range === 'custom' && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
            />
            <span className="text-sm text-gray-400">to</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
            />
          </div>
        )}
      </div>

      {!stats ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-xl bg-gray-200" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {cardMeta.map(({ key, label, icon: Icon, tint, ring }) => {
            const raw = stats[key] as number;
            const value = key === 'avgCallDurationSeconds' ? fmtDuration(raw) : raw.toLocaleString();
            return (
              <div
                key={key}
                className="card p-5 transition-shadow duration-200 hover:shadow-md"
              >
                <div className={`mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg ring-1 ${tint} ${ring}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <p className="text-3xl font-bold text-gray-900">{value}</p>
                <p className="mt-1 text-sm text-gray-500">{label}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
