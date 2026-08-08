'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Sparkles, X } from 'lucide-react';
import { api } from '@/lib/api';

/**
 * Suggests FAQs the agent is missing, grounded in the client's own services.
 *
 * Every suggestion is a draft the operator adds one at a time — there is no
 * "add all". Drafts can contain [confirm price]-style placeholders precisely
 * because the model is told to leave specifics blank rather than invent them,
 * so each one genuinely needs a human to look at it before it reaches a caller.
 */

interface Draft {
  question: string;
  answer: string;
  category: string;
}

export function CopilotFaqs({
  clientId,
  onAdd,
}: {
  clientId: string;
  /** Persist one accepted draft. Resolves when saved. */
  onAdd: (draft: Draft) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(false);
  const [topic, setTopic] = useState('');
  const [adding, setAdding] = useState<number | null>(null);
  const [added, setAdded] = useState<Set<number>>(new Set());
  const [error, setError] = useState('');

  const generate = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.post('/ai/copilot/faqs', {
        clientId,
        ...(topic.trim() ? { topic: topic.trim() } : {}),
      });
      setDrafts(data.data ?? []);
      setAdded(new Set());
      if ((data.data ?? []).length === 0) {
        setError('No gaps found — this agent already covers the common questions.');
      }
    } catch (e) {
      setError(
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
          'Could not draft FAQs right now.'
      );
    } finally {
      setLoading(false);
    }
  };

  const accept = async (draft: Draft, index: number) => {
    setAdding(index);
    try {
      await onAdd(draft);
      setAdded((prev) => new Set(prev).add(index));
      toast.success('Added to your knowledge base');
    } catch {
      toast.error('Could not save that one');
    } finally {
      setAdding(null);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-4 flex cursor-pointer items-center gap-2 rounded-md border border-panel-300 bg-white px-3.5 py-2 text-sm font-medium text-ink-800 transition-colors hover:border-panel-400 hover:bg-panel-25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600"
      >
        <Sparkles className="h-4 w-4 text-panel-500" aria-hidden />
        Suggest FAQs
      </button>
    );
  }

  return (
    <section className="mb-4 rounded-xl border border-panel-200 bg-white">
      <div className="flex items-start justify-between gap-3 border-b border-panel-200 px-5 py-3.5">
        <div>
          <h2 className="flex items-center gap-2 font-heading text-sm font-semibold text-ink-900">
            <Sparkles className="h-4 w-4 text-panel-500" aria-hidden /> Suggested FAQs
          </h2>
          <p className="mt-0.5 text-xs text-panel-500">
            Based on your services and what your agent can already answer.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close suggestions"
          className="cursor-pointer rounded p-1 text-panel-500 transition-colors hover:bg-panel-50 hover:text-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-panel-100 px-5 py-4">
        <label htmlFor="copilot-topic" className="sr-only">Topic to focus on</label>
        <input
          id="copilot-topic"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Optional: focus on a topic, e.g. parking, insurance"
          className="min-w-[16rem] flex-1 rounded-md border border-panel-300 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-panel-400 transition-colors hover:border-panel-400 focus:border-signal-600 focus:outline-none focus:ring-2 focus:ring-signal-600/25"
        />
        <button
          type="button"
          onClick={generate}
          disabled={loading}
          className="cursor-pointer rounded-md bg-ink-800 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600 focus-visible:ring-offset-2 disabled:opacity-50"
        >
          {loading ? 'Thinking…' : drafts.length > 0 ? 'Suggest more' : 'Suggest'}
        </button>
      </div>

      {error && <p className="px-5 py-4 text-sm text-panel-600">{error}</p>}

      {loading && drafts.length === 0 && (
        <div className="space-y-3 p-5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-panel-100" />
          ))}
        </div>
      )}

      {drafts.length > 0 && (
        <>
          <ul className="divide-y divide-panel-100">
            {drafts.map((draft, i) => (
              <li key={i} className="flex items-start justify-between gap-4 px-5 py-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink-900">{draft.question}</p>
                  <p className="mt-1 text-sm leading-relaxed text-panel-600">{draft.answer}</p>
                  {draft.category && (
                    <p className="mt-1.5 text-2xs uppercase tracking-[0.07em] text-panel-400">
                      {draft.category}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => accept(draft, i)}
                  disabled={adding === i || added.has(i)}
                  className="flex flex-shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-panel-300 bg-white px-3 py-1.5 text-xs font-medium text-ink-800 transition-colors hover:border-panel-400 hover:bg-panel-25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  {added.has(i) ? 'Added' : adding === i ? 'Adding…' : 'Add'}
                </button>
              </li>
            ))}
          </ul>
          <p className="border-t border-panel-100 px-5 py-3 text-2xs text-panel-500">
            Read each one before adding it. Anything in [square brackets] needs a real value from
            you — the assistant leaves specifics blank rather than guessing.
          </p>
        </>
      )}
    </section>
  );
}
