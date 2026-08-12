'use client';

import { useState } from 'react';
import { AlertTriangle, BookOpen, Bot, CheckCircle2, Sparkles, UserCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { StatusPill, type Tone } from '@/components/StatusPill';

/**
 * AI review of one call.
 *
 * Run on demand rather than automatically on every call: analysis costs a model
 * call per transcript, and most calls are unremarkable. The operator asks for it
 * on the ones that look worth reading.
 */

interface Analysis {
  summary: string;
  caller_intent: string;
  outcome: string;
  sentiment: string;
  went_well: string[];
  went_wrong: string[];
  suggested_fixes: Array<{ fix: string; where: string }>;
  needs_human_followup: boolean;
}

const SENTIMENT_TONES: Record<string, Tone> = {
  positive: 'success',
  neutral: 'neutral',
  frustrated: 'warning',
  angry: 'error',
};

const OUTCOME_TONES: Record<string, Tone> = {
  resolved: 'success',
  booked: 'success',
  lead_captured: 'success',
  transferred: 'info',
  abandoned: 'error',
  unresolved: 'warning',
};

/** Where a fix belongs decides who acts on it, so it gets its own affordance. */
const FIX_ROUTES: Record<string, { label: string; icon: typeof BookOpen }> = {
  knowledge: { label: 'Knowledge base', icon: BookOpen },
  agent_config: { label: 'Agent settings', icon: Bot },
  staff_followup: { label: 'Someone should call back', icon: UserCheck },
  none: { label: 'No change needed', icon: CheckCircle2 },
};

export function CallIntelligence({ callId }: { callId: string }) {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.post(`/ai/calls/${callId}/analyze`);
      setAnalysis(data);
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? 'Could not analyse this call.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="mb-4 border border-panel-200 bg-surface-raised">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-panel-200 px-5 py-3.5">
        <div>
          <h2 className="flex items-center gap-2 font-heading text-sm font-semibold text-ink-900">
            <Sparkles className="h-4 w-4 text-panel-500" aria-hidden /> AI review
          </h2>
          <p className="mt-0.5 text-xs text-panel-500">
            What happened on this call, and what to change so the next one goes better.
          </p>
        </div>
        {!analysis && (
          <button
            type="button"
            onClick={run}
            disabled={loading}
            className="flex cursor-pointer items-center gap-2 bg-action px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-action-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600 focus-visible:ring-offset-2 disabled:opacity-50"
          >
            <Sparkles className="h-4 w-4" aria-hidden />
            {loading ? 'Reading the transcript…' : 'Review this call'}
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="px-5 py-4 text-sm text-lamp-bad-ink">{error}</p>
      )}

      {loading && !analysis && (
        <div className="space-y-2 p-5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-3.5 animate-pulse bg-panel-100" style={{ width: `${90 - i * 15}%` }} />
          ))}
        </div>
      )}

      {analysis && (
        <div className="space-y-5 p-5">
          <div className="flex flex-wrap gap-2">
            <StatusPill tone={OUTCOME_TONES[analysis.outcome] ?? 'neutral'} label={analysis.outcome.replace(/_/g, ' ')} />
            <StatusPill tone={SENTIMENT_TONES[analysis.sentiment] ?? 'neutral'} label={`caller ${analysis.sentiment}`} />
            {analysis.needs_human_followup && <StatusPill tone="warning" label="Needs follow-up" />}
          </div>

          <div>
            <p className="mb-1 text-2xs font-semibold uppercase tracking-[0.07em] text-panel-500">
              What happened
            </p>
            <p className="text-sm leading-relaxed text-ink-800">{analysis.summary}</p>
            <p className="mt-1.5 text-xs text-panel-600">
              Caller wanted: {analysis.caller_intent}
            </p>
          </div>

          {analysis.went_well.length > 0 && (
            <div>
              <p className="mb-1.5 text-2xs font-semibold uppercase tracking-[0.07em] text-panel-500">
                Went well
              </p>
              <ul className="space-y-1">
                {analysis.went_well.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-ink-800">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-lamp-good" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {analysis.went_wrong.length > 0 && (
            <div>
              <p className="mb-1.5 text-2xs font-semibold uppercase tracking-[0.07em] text-panel-500">
                Went wrong
              </p>
              <ul className="space-y-1">
                {analysis.went_wrong.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-ink-800">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-lamp-fair" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {analysis.suggested_fixes.length > 0 && (
            <div>
              <p className="mb-1.5 text-2xs font-semibold uppercase tracking-[0.07em] text-panel-500">
                What to change
              </p>
              <ul className="space-y-2">
                {analysis.suggested_fixes.map((fix, i) => {
                  const route = FIX_ROUTES[fix.where] ?? FIX_ROUTES.none;
                  const Icon = route.icon;
                  return (
                    <li key={i} className="border border-panel-200 bg-panel-25 p-3">
                      <p className="text-sm text-ink-800">{fix.fix}</p>
                      <p className="mt-1 flex items-center gap-1.5 text-2xs text-panel-500">
                        <Icon className="h-3 w-3" aria-hidden /> {route.label}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <p className="border-t border-panel-100 pt-3 text-2xs text-panel-400">
            Generated from this call&apos;s transcript. Check anything you plan to act on.
          </p>
        </div>
      )}
    </section>
  );
}
