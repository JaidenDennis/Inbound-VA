'use client';

import { useState } from 'react';
import { Lightbulb, Sparkles } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';

/**
 * Describe the problem in plain language; get a ticket support can act on.
 *
 * Clients report symptoms ("it's being weird"), which costs a round trip before
 * anyone can start. This drafts a subject, body, and priority from their
 * description plus their account's current state — sync status, recent failures
 * — so the technical context is attached before a human reads it.
 *
 * Two steps on purpose: the draft lands in the form, the client edits and
 * submits. Nothing is filed on their behalf, so a misread never becomes a
 * ticket they didn't write.
 */

interface Draft {
  subject: string;
  body: string;
  priority: string;
  category: string;
  likely_cause: string;
  self_serve_fix: string;
}

export function TicketComposer({
  clientId,
  onDraft,
}: {
  /** Omitted for a client user — the API pins them to their own tenant. */
  clientId?: string;
  onDraft: (draft: { subject: string; description: string; priority: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');

  const generate = async () => {
    if (description.trim().length < 10) {
      setError('Give me a sentence or two about what is going wrong.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { data } = await api.post('/ai/support/draft', {
        ...(clientId ? { clientId } : {}),
        description: description.trim(),
      });
      setDraft(data);
    } catch (e) {
      setError(
        errorMessage(e, 'Could not draft that right now — you can still write the ticket yourself.')
      );
    } finally {
      setLoading(false);
    }
  };

  const use = () => {
    if (!draft) return;
    onDraft({ subject: draft.subject, description: draft.body, priority: draft.priority });
    setOpen(false);
    setDraft(null);
    setDescription('');
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-4 flex cursor-pointer items-center gap-2 border border-rule bg-surface-raised px-3.5 py-2 text-sm font-medium text-text transition-colors hover:border-action hover:bg-surface-inset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
      >
        <Sparkles className="h-4 w-4 text-text-muted" aria-hidden />
        Describe it and I&apos;ll write the ticket
      </button>
    );
  }

  return (
    <section className="mb-4 border border-hairline bg-surface-raised">
      <div className="border-b border-hairline px-5 py-3.5">
        <h2 className="flex items-center gap-2 font-heading text-sm font-semibold text-text">
          <Sparkles className="h-4 w-4 text-text-muted" aria-hidden /> Describe the problem
        </h2>
        <p className="mt-0.5 text-xs text-text-muted">
          Say what you noticed in your own words. I&apos;ll add the technical detail from your
          account.
        </p>
      </div>

      <div className="space-y-3 p-5">
        <label htmlFor="ticket-desc" className="sr-only">What is going wrong</label>
        <textarea
          id="ticket-desc"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. People say they call and it just rings, but the dashboard shows my agent is live"
          className="w-full resize-y border border-rule bg-surface-raised px-3 py-2 text-sm text-text placeholder:text-text-faint transition-colors hover:border-action focus:border-action focus:outline-none focus:ring-2 focus:ring-action/25"
        />

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={generate}
            disabled={loading}
            className="cursor-pointer border border-action bg-action px-3.5 py-2 text-sm font-semibold text-[rgb(var(--action-contrast-rgb))] transition-colors duration-150 hover:bg-transparent hover:text-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 disabled:opacity-50"
          >
            {loading ? 'Writing it up…' : 'Draft the ticket'}
          </button>
          <button
            type="button"
            onClick={() => { setOpen(false); setDraft(null); setError(''); }}
            className="cursor-pointer border border-rule bg-surface-raised px-3.5 py-2 text-sm font-medium text-text transition-colors hover:border-action hover:bg-surface-inset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
          >
            Cancel
          </button>
        </div>

        {error && <p role="alert" className="text-sm text-lamp-bad-ink">{error}</p>}

        {draft && (
          <div className="space-y-3 border border-hairline bg-surface-inset p-4">
            {/* Surfaced above the draft: if they can fix it in 30 seconds, they
                should not be waiting on a support queue at all. */}
            {draft.self_serve_fix && (
              <div className="flex items-start gap-2 border border-lamp-good-rim bg-lamp-good-wash px-3 py-2.5">
                <Lightbulb className="mt-0.5 h-4 w-4 flex-shrink-0 text-lamp-good-ink" aria-hidden />
                <div>
                  <p className="text-xs font-semibold text-lamp-good-ink">You might be able to fix this yourself</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-lamp-good-ink">{draft.self_serve_fix}</p>
                </div>
              </div>
            )}

            <div>
              <p className="font-mono text-2xs uppercase tracking-[0.16em] text-text-muted">Subject</p>
              <p className="mt-0.5 text-sm font-medium text-text">{draft.subject}</p>
            </div>
            <div>
              <p className="font-mono text-2xs uppercase tracking-[0.16em] text-text-muted">Details</p>
              <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-text">{draft.body}</p>
            </div>
            <div className="flex flex-wrap gap-4 text-xs text-text-secondary">
              <span>Priority: <strong className="text-text">{draft.priority}</strong></span>
              <span>Category: <strong className="text-text">{draft.category.replace(/_/g, ' ')}</strong></span>
            </div>
            {draft.likely_cause && (
              <p className="text-xs leading-relaxed text-text-secondary">
                <span className="font-medium text-text">Likely cause:</span> {draft.likely_cause}
              </p>
            )}

            <button
              type="button"
              onClick={use}
              className="cursor-pointer border border-action bg-action px-3.5 py-2 text-sm font-semibold text-[rgb(var(--action-contrast-rgb))] transition-colors duration-150 hover:bg-transparent hover:text-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2"
            >
              Use this draft
            </button>
            <p className="text-2xs text-text-muted">
              Fills the form below. Edit anything that isn&apos;t right before you send it.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
