'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { type Milestone } from '@/lib/onboarding';

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

  if (milestones === null) return <div className="text-gray-400 animate-pulse">Loading...</div>;

  if (!isLive) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold mb-2">Performance</h1>
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
          <p className="text-gray-600 font-medium">Your stats will appear here once you’re live.</p>
          <p className="text-gray-400 text-sm mt-1">
            We’ll switch this on automatically when your “Go Live” stage is complete.
          </p>
        </div>
      </div>
    );
  }

  const cards = stats
    ? [
        { label: 'Calls Answered', value: stats.callsAnswered, color: 'text-blue-600' },
        { label: 'Missed Calls Recovered', value: stats.missedCallsRecovered, color: 'text-emerald-600' },
        { label: 'Leads Recaptured', value: stats.leadsRecaptured, color: 'text-green-600' },
        { label: 'Appointments Booked', value: stats.appointmentsBooked, color: 'text-purple-600' },
        { label: 'Avg Call Duration', value: fmtDuration(stats.avgCallDurationSeconds), color: 'text-slate-700' },
      ]
    : [];

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold mb-4">Performance</h1>

      <div className="flex items-center gap-2 mb-6 flex-wrap">
        {(['7', '30', 'custom'] as RangeKey[]).map((r) => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
              range === r ? 'bg-brand-500 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {r === '7' ? 'Last 7 days' : r === '30' ? 'Last 30 days' : 'Custom'}
          </button>
        ))}
        {range === 'custom' && (
          <>
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
            />
            <span className="text-gray-400 text-sm">to</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
            />
          </>
        )}
      </div>

      {!stats ? (
        <div className="text-gray-400 animate-pulse">Loading stats...</div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {cards.map((c) => (
            <div key={c.label} className="bg-white rounded-xl border border-gray-200 p-5 text-center">
              <p className={`text-3xl font-bold ${c.color}`}>{c.value}</p>
              <p className="text-sm text-gray-500 mt-1">{c.label}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
