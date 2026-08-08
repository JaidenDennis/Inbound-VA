'use client';

import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { api } from '@/lib/api';

/**
 * Draft opening lines in a few different registers.
 *
 * Picking one fills the editor rather than saving — the operator still reads it,
 * can edit it, and presses Save themselves. Every option is generated with the
 * recording disclosure included, because a client-written greeting replaces the
 * template's default wholesale and that disclosure is a legal requirement in
 * several states, not a stylistic default.
 */

interface Option {
  text: string;
  style: string;
}

export function GreetingSuggestions({
  clientId,
  onPick,
}: {
  clientId: string;
  onPick: (text: string) => void;
}) {
  const [options, setOptions] = useState<Option[]>([]);
  const [brief, setBrief] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);

  const generate = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.post('/ai/copilot/greeting', {
        clientId,
        ...(brief.trim() ? { brief: brief.trim() } : {}),
      });
      setOptions(data.data ?? []);
    } catch (e) {
      setError(
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
          'Could not draft greetings right now.'
      );
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { setOpen(true); generate(); }}
        className="flex cursor-pointer items-center gap-2 rounded-md border border-panel-300 bg-white px-3.5 py-2 text-sm font-medium text-ink-800 transition-colors hover:border-panel-400 hover:bg-panel-25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600"
      >
        <Sparkles className="h-4 w-4 text-panel-500" aria-hidden />
        Suggest an opening line
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-panel-200 bg-panel-25 p-4">
      <p className="mb-3 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.07em] text-panel-500">
        <Sparkles className="h-3.5 w-3.5" aria-hidden /> Suggested openings
      </p>

      <div className="mb-3 flex flex-wrap gap-2">
        <label htmlFor="greeting-brief" className="sr-only">What kind of greeting</label>
        <input
          id="greeting-brief"
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="Optional: how should it feel? e.g. warm and unhurried"
          className="min-w-[15rem] flex-1 rounded-md border border-panel-300 bg-white px-3 py-1.5 text-sm text-ink-900 placeholder:text-panel-400 transition-colors hover:border-panel-400 focus:border-signal-600 focus:outline-none focus:ring-2 focus:ring-signal-600/25"
        />
        <button
          type="button"
          onClick={generate}
          disabled={loading}
          className="cursor-pointer rounded-md border border-panel-300 bg-white px-3 py-1.5 text-xs font-medium text-ink-800 transition-colors hover:border-panel-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600 disabled:opacity-50"
        >
          {loading ? 'Thinking…' : 'Regenerate'}
        </button>
      </div>

      {error && <p className="text-sm text-lamp-bad-ink">{error}</p>}

      {loading && options.length === 0 && (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-md bg-panel-100" />
          ))}
        </div>
      )}

      <ul className="space-y-2">
        {options.map((option, i) => (
          <li key={i}>
            <button
              type="button"
              onClick={() => onPick(option.text)}
              className="w-full cursor-pointer rounded-md border border-panel-200 bg-white p-3 text-left transition-colors hover:border-panel-400 hover:bg-panel-25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600"
            >
              <span className="block text-2xs uppercase tracking-[0.07em] text-panel-400">
                {option.style}
              </span>
              <span className="mt-1 block text-sm leading-relaxed text-ink-800">{option.text}</span>
            </button>
          </li>
        ))}
      </ul>

      {options.length > 0 && (
        <p className="mt-3 text-2xs text-panel-500">
          Picking one fills the box above — review it, then save.
        </p>
      )}
    </div>
  );
}
