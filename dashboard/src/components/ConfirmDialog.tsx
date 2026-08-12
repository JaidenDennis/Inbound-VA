'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle } from 'lucide-react';
import clsx from 'clsx';
import { StatusLamp } from './StatusLamp';

/**
 * Confirmation for actions that cannot be undone.
 *
 * The console's destructive actions (revoking a user's access, clearing an
 * error group, re-queuing a job) sat one click away with no guard and no undo,
 * directly beside routine controls. Since none of them are reversible, the
 * cheapest correct fix is to make the operator state the intent.
 *
 * The dialog names the specific consequence rather than asking "Are you sure?",
 * because the consequence is the only thing the operator needs to weigh.
 *
 * Focus is trapped while open and returned to the invoking control on close, so
 * a keyboard operator is never dropped somewhere unrelated.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = true,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  /** State the consequence plainly. Not "Are you sure?". */
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  // The portal has no server equivalent, so gating on `typeof document` alone
  // makes the server render and the first client render disagree — a hydration
  // mismatch. Waiting for mount makes both render nothing, then the portal
  // attaches. Harmless in practice today because `open` is always false at
  // hydration, but it would bite the first time that stops being true.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;

    restoreRef.current = document.activeElement as HTMLElement | null;
    // Cancel takes initial focus, never the destructive button. The operator
    // arrived here by pressing something; if that keypress repeats, or they hit
    // Enter reflexively, the default outcome must be "nothing happened".
    const focusTimer = window.setTimeout(() => cancelRef.current?.focus(), 0);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;

      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = previousOverflow;
      restoreRef.current?.focus?.();
    };
  }, [open, onCancel]);

  if (!open || !mounted) return null;

  return createPortal(
    // z-40 sits above the drawer (20) and below toasts (50), so a confirmation
    // raised from inside the drawer still reads as the foreground decision.
    <div className="fixed inset-0 z-40 flex items-center justify-center px-4">
      <div
        className="absolute inset-0 bg-scrim"
        onClick={busy ? undefined : onCancel}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
        className="relative w-full max-w-sm animate-rise border border-panel-200 bg-surface-raised p-5 shadow-xl"
      >
        <div className="flex items-start gap-3">
          {destructive ? (
            <span className="mt-0.5 flex-shrink-0">
              <StatusLamp level="bad" size="md" label="Destructive action" />
            </span>
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-lamp-fair-ink" aria-hidden />
          )}
          <div className="min-w-0">
            <h2 id="confirm-title" className="font-heading text-base font-semibold text-ink-900">
              {title}
            </h2>
            <p id="confirm-body" className="mt-1.5 text-sm leading-relaxed text-panel-600">
              {body}
            </p>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="cursor-pointer border border-panel-300 bg-surface-raised px-3.5 py-2 text-sm font-semibold text-ink-800 transition-colors duration-150 hover:border-panel-400 hover:bg-panel-25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={clsx(
              'flex cursor-pointer items-center gap-2 px-3.5 py-2 text-sm font-semibold',
              'transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
              'disabled:cursor-not-allowed disabled:opacity-60',
              destructive
                ? 'bg-lamp-bad-ink hover:bg-lamp-bad focus-visible:ring-lamp-bad text-white'
                : 'bg-action hover:bg-action-800 focus-visible:ring-signal-600 text-[rgb(var(--action-contrast-rgb))]'
            )}
          >
            {busy && (
              <span
                aria-hidden
                className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current/35 border-t-current"
              />
            )}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
