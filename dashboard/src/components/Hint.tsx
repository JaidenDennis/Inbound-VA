'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { HelpCircle } from 'lucide-react';
import clsx from 'clsx';

/**
 * Progressive disclosure for a term the interface cannot avoid using.
 *
 * Deliberately NOT a hover tooltip. Hover has no keyboard equivalent, no touch
 * equivalent, and disappears the moment a pointer drifts — so the one group of
 * users most likely to need a definition is the group least able to reach it.
 * This is a real button: clickable, focusable, Escape-dismissable, and wired to
 * the panel with `aria-describedby` so a screen reader reads the definition
 * whether or not the panel is visible.
 *
 * Help lives here rather than in a docs site because the question ("what counts
 * as fatal?") occurs while looking at the row, and a link away from the row is a
 * context switch the operator will not make.
 */
export function Hint({
  term,
  children,
  align = 'left',
}: {
  /** Names what is being explained, for the button's accessible name. */
  term: string;
  children: string;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onPointer = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };

    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open]);

  return (
    <span ref={wrapRef} className="relative inline-flex align-middle">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-describedby={id}
        aria-label={`What does ${term} mean?`}
        className={clsx(
          'inline-flex h-4 w-4 cursor-pointer items-center justify-center rounded-full',
          'text-panel-400 transition-colors duration-150 hover:text-ink-700',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600',
          open && 'text-ink-800'
        )}
      >
        <HelpCircle className="h-3.5 w-3.5" aria-hidden strokeWidth={1.75} />
      </button>

      {/* Always in the accessibility tree; only painted when open. Hiding the
          text from screen readers until a click would defeat the purpose. */}
      <span
        id={id}
        role="note"
        className={clsx(
          open
            ? [
                'absolute top-6 z-30 w-64 rounded-xl border border-panel-200 bg-white p-3',
                'text-xs font-normal normal-case leading-relaxed tracking-normal text-panel-700 shadow-lg',
                align === 'right' ? 'right-0' : 'left-0',
              ]
            : 'sr-only'
        )}
      >
        {children}
      </span>
    </span>
  );
}

/**
 * A column heading that carries its own definition.
 *
 * Use on headings whose term is product-internal (Severity, Fingerprint,
 * Status). Plain headings stay plain — a hint on every column is noise, and
 * noise is what made the help invisible in the first place.
 */
export function HintedHeading({
  children,
  term,
  hint,
  align = 'left',
}: {
  children: React.ReactNode;
  term: string;
  hint: string;
  align?: 'left' | 'right';
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {children}
      <Hint term={term} align={align}>
        {hint}
      </Hint>
    </span>
  );
}
