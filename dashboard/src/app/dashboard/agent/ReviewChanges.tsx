'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, ArrowRight, Check, Loader2, X } from 'lucide-react';
import { api } from '@/lib/api';

/**
 * Read what a change does, then publish it.
 *
 * Saving used to be one button that wrote settings and re-provisioned the agent
 * in the same breath. That is fine for renaming the agent and wrong for
 * everything else: a client raising their booking buffer from 0 to 30 has just
 * removed most of tomorrow's availability, and nothing on the screen said so.
 *
 * This panel is the pause. It stages the edit as a draft, shows the field
 * changes grouped by what they affect, and only writes when someone presses
 * publish having read them.
 */

type DiffKind = 'added' | 'removed' | 'changed';

interface DiffEntry {
  path: string;
  label: string;
  kind: DiffKind;
  before: unknown;
  after: unknown;
  consequence?: string;
  area?: string;
}

interface ConfigDiff {
  entries: DiffEntry[];
  areas: Array<{ area: string; label: string; fields: string[] }>;
  hasChanges: boolean;
}

interface DraftState {
  diff: ConfigDiff;
  fresh: boolean;
  draft: { updated_at: string } | null;
}

/** Render a stored value the way someone reading a review would say it aloud. */
function display(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Not set';
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'Empty';
    // Short lists read better in full; long ones read better as a count, and a
    // wall of forty FAQ objects reads as nothing at all.
    if (value.every((v) => typeof v === 'string') && value.length <= 3) return value.join(', ');
    return `${value.length} ${value.length === 1 ? 'entry' : 'entries'}`;
  }
  if (typeof value === 'object') return 'Updated';
  const text = String(value);
  return text.length > 90 ? `${text.slice(0, 90)}…` : text;
}

const KIND_LABEL: Record<DiffKind, string> = {
  added: 'Added',
  removed: 'Removed',
  changed: 'Changed',
};

const KIND_CLS: Record<DiffKind, string> = {
  added: 'border-lamp-good-rim bg-lamp-good-wash text-lamp-good-ink',
  removed: 'border-lamp-bad-rim bg-lamp-bad-wash text-lamp-bad-ink',
  changed: 'border-panel-200 bg-panel-50 text-panel-700',
};

export function ReviewChanges({
  clientId,
  payload,
  onPublished,
  onClose,
}: {
  clientId: string;
  payload: Record<string, unknown>;
  onPublished: () => void;
  onClose: () => void;
}) {
  const [state, setState] = useState<DraftState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Stage the edit rather than diffing it in memory: a draft survives a reload,
  // and it is what the publish call checks its staleness against.
  const stage = useCallback(() => {
    setError(null);
    api
      .put('/my-agent/draft', payload, { params: { clientId } })
      .then((r) => setState(r.data))
      .catch((e) => {
        const data = (e as { response?: { data?: { error?: string } } })?.response?.data;
        setError(data?.error ?? 'Could not work out what these changes do.');
      });
    // `payload` is rebuilt on every render of the parent; staging once on open is
    // the intent, so it is deliberately not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  useEffect(stage, [stage]);

  const publish = async () => {
    setBusy(true);
    try {
      await api.post('/my-agent/draft/publish', {}, { params: { clientId } });
      toast.success('Published — your agent updates on new calls within about a minute');
      onPublished();
    } catch (e) {
      const res = (e as { response?: { status?: number; data?: { error?: string } } })?.response;
      // 409 is the stale-draft refusal. It is not a failure to report as one:
      // the change was not applied precisely so nothing got overwritten.
      if (res?.status === 409) {
        setError(res.data?.error ?? 'This agent changed while you were reviewing.');
        stage();
      } else {
        toast.error(res?.data?.error ?? 'Could not publish those changes');
      }
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    setBusy(true);
    try {
      await api.delete('/my-agent/draft', { params: { clientId } });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Review changes"
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/30 p-0 sm:items-center sm:p-6"
    >
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-xl border border-panel-200 bg-white shadow-xl sm:rounded-xl">
        <div className="flex items-start justify-between gap-4 border-b border-panel-200 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-ink-900">Review changes</h2>
            <p className="mt-0.5 text-sm text-panel-600">
              Nothing reaches your agent until you publish.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer rounded-md p-1.5 text-panel-500 transition-colors hover:bg-panel-50 hover:text-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {error && (
            <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-lamp-fair-rim bg-lamp-fair-wash px-4 py-3 text-sm text-lamp-fair-ink">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
              <p>{error}</p>
            </div>
          )}

          {!state && !error && (
            <div className="flex items-center gap-2 py-8 text-sm text-panel-500">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Working out what changes…
            </div>
          )}

          {state && !state.fresh && (
            <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-lamp-fair-rim bg-lamp-fair-wash px-4 py-3 text-sm text-lamp-fair-ink">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
              <p>
                Someone else changed this agent while you were editing. Close this, reload the
                page and make your change again so you don&apos;t undo theirs.
              </p>
            </div>
          )}

          {state?.diff.hasChanges === false && (
            <p className="py-8 text-center text-sm text-panel-500">
              Nothing here is different from what your agent is already using.
            </p>
          )}

          {state && state.diff.hasChanges && (
            <>
              {state.diff.areas.length > 0 && (
                <p className="mb-5 text-sm text-panel-700">
                  This affects{' '}
                  <span className="font-medium text-ink-800">
                    {state.diff.areas.map((a) => a.label.toLowerCase()).join(', ')}
                  </span>
                  .
                </p>
              )}

              <ul className="space-y-3">
                {state.diff.entries.map((entry) => (
                  <li key={entry.path} className="rounded-lg border border-panel-200 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-ink-900">{entry.label}</span>
                      <span className={`rounded border px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-[0.06em] ${KIND_CLS[entry.kind]}`}>
                        {KIND_LABEL[entry.kind]}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-panel-500 line-through">{display(entry.before)}</span>
                      <ArrowRight className="h-3.5 w-3.5 flex-shrink-0 text-panel-400" aria-hidden />
                      <span className="font-medium text-ink-900">{display(entry.after)}</span>
                    </div>

                    {entry.consequence && (
                      <p className="mt-2 text-xs leading-relaxed text-panel-600">{entry.consequence}</p>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-panel-200 bg-panel-25 px-6 py-4">
          <button
            type="button"
            onClick={publish}
            disabled={busy || !state?.diff.hasChanges || !state?.fresh}
            className="flex cursor-pointer items-center gap-2 rounded-md bg-ink-800 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Check className="h-4 w-4" aria-hidden /> {busy ? 'Publishing…' : 'Publish'}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="cursor-pointer rounded-md border border-panel-300 bg-white px-4 py-2 text-sm font-medium text-ink-800 transition-colors hover:border-panel-400 hover:bg-panel-25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600 disabled:cursor-not-allowed"
          >
            Keep editing
          </button>
          <button
            type="button"
            onClick={discard}
            disabled={busy}
            className="ml-auto cursor-pointer rounded-md px-3 py-2 text-sm font-medium text-panel-600 transition-colors hover:text-lamp-bad-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lamp-bad disabled:cursor-not-allowed"
          >
            Discard changes
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * What a client controls and what we do, with the reason attached.
 *
 * Served by the API rather than written here, so the explanation cannot drift
 * from what the service actually enforces. An unexplained missing field reads as
 * a product that cannot do the thing; a stated boundary reads as a guarantee,
 * and it is one.
 */
export function ManagedByGravvia() {
  const [boundary, setBoundary] = useState<{
    gravviaManaged: Array<{ field: string; label: string; why: string }>;
    requestPath: string;
  } | null>(null);

  useEffect(() => {
    api
      .get('/my-agent/boundary')
      .then((r) => setBoundary(r.data))
      .catch(() => setBoundary(null));
  }, []);

  if (!boundary) return null;

  return (
    <details className="mt-6 rounded-xl border border-panel-200 bg-panel-25 px-5 py-4">
      <summary className="cursor-pointer text-sm font-medium text-ink-800">
        What Gravvia manages for you
      </summary>
      <dl className="mt-4 space-y-4">
        {boundary.gravviaManaged.map((item) => (
          <div key={item.field}>
            <dt className="text-sm font-medium text-ink-800">{item.label}</dt>
            <dd className="mt-0.5 text-xs leading-relaxed text-panel-600">{item.why}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 border-t border-panel-200 pt-3 text-xs leading-relaxed text-panel-600">
        {boundary.requestPath}
      </p>
    </details>
  );
}
