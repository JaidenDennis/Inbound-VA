'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';

interface CallDetail {
  call: Record<string, unknown>;
  transcript: { transcript: Array<{ role: string; content: string }> } | null;
  summary: { summary: string; sentiment: string; action_items: string[] } | null;
  conversation: Record<string, unknown> | null;
}

export default function CallDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<CallDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/admin/calls/${id}`).then((r) => setDetail(r.data)).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="text-gray-400 animate-pulse">Loading...</div>;
  if (!detail) return <div>Call not found</div>;

  const { call, transcript, summary } = detail;

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold mb-2">Call Detail</h1>
      <p className="text-gray-400 text-sm mb-6">{String(call.retell_call_id)}</p>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs text-gray-400 mb-1">From</p>
          <p className="font-mono font-semibold">{String(call.from_number)}</p>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs text-gray-400 mb-1">Duration</p>
          <p className="font-semibold">{call.duration_seconds != null ? `${Math.floor(Number(call.duration_seconds) / 60)}m ${Number(call.duration_seconds) % 60}s` : '—'}</p>
        </div>
      </div>

      {summary && (
        <div className="bg-white rounded-xl border p-4 mb-4">
          <h2 className="font-semibold mb-2">Summary</h2>
          <p className="text-gray-700 text-sm">{summary.summary}</p>
          {summary.action_items.length > 0 && (
            <ul className="mt-2 space-y-1 list-disc list-inside text-sm text-gray-600">
              {summary.action_items.map((item, i) => <li key={i}>{item}</li>)}
            </ul>
          )}
        </div>
      )}

      {transcript && (
        <div className="bg-white rounded-xl border p-4">
          <h2 className="font-semibold mb-3">Transcript</h2>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {transcript.transcript.map((turn, i) => (
              <div key={i} className={`flex gap-3 ${turn.role === 'agent' ? 'flex-row-reverse' : ''}`}>
                <div className={`px-3 py-2 rounded-xl text-sm max-w-sm ${turn.role === 'agent' ? 'bg-brand-500 text-white ml-auto' : 'bg-gray-100 text-gray-800'}`}>
                  {turn.content}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
