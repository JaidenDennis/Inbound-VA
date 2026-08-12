'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

/**
 * Right-hand detail panel.
 *
 * z-index follows the project scale (10 sticky, 20 drawer, 30 modal, 50 toast)
 * so overlays cannot fight each other. Escape closes, focus moves into the panel
 * on open and returns to the trigger on close, and background scroll is locked —
 * the three things a hand-rolled drawer normally gets wrong.
 */
export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = document.activeElement as HTMLElement;
    panelRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      // Focus moved in and returns on close, but Tab was never trapped, so a
      // keyboard operator tabbed straight out of an `aria-modal` panel into the
      // page behind it — which the modal claims is inert. Cycle instead.
      if (e.key !== 'Tab' || !panelRef.current) return;

      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (e.shiftKey && (active === first || active === panelRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = originalOverflow;
      previouslyFocused.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-20 flex justify-end">
      <div
        className="absolute inset-0 bg-scrim transition-opacity motion-reduce:transition-none"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative flex h-full w-full max-w-2xl flex-col border-l border-panel-200 bg-surface-raised shadow-xl focus:outline-none"
      >
        <div className="flex items-start justify-between gap-4 border-b border-panel-200 px-6 py-4">
          <h2 className="font-heading text-lg font-semibold text-ink-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="cursor-pointer p-1.5 text-panel-500 transition-colors hover:bg-panel-100 hover:text-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>

        {footer && <div className="border-t border-panel-200 px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}
