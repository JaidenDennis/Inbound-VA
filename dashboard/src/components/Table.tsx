'use client';

import { type ReactNode, type KeyboardEvent } from 'react';
import clsx from 'clsx';

/**
 * The one table implementation.
 *
 * The console had two: `DataTable`, which carried the chrome, sticky heads,
 * keyboard row activation, and a real empty state; and hand-rolled `<table>`
 * markup in system, users, and settings, which carried none of it. Same product,
 * two behaviours, and the accessible one was the one used least.
 *
 * `DataTable` is now a column-driven wrapper over these primitives, and a screen
 * that needs bespoke cells composes the primitives directly instead of forking
 * the chrome. Either way the borders, heading treatment, row affordances, and
 * keyboard behaviour come from here.
 */

export function TableShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx('overflow-hidden border border-panel-200 bg-surface-raised', className)}>
      {/* Horizontal escape hatch: dense tables must scroll inside their own
          container rather than pushing the page sideways. */}
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

export function Table({ children, caption }: { children: ReactNode; caption?: string }) {
  return (
    <table className="w-full">
      {caption && <caption className="sr-only">{caption}</caption>}
      {children}
    </table>
  );
}

export function THead({ children, sticky = false }: { children: ReactNode; sticky?: boolean }) {
  return (
    <thead className={clsx('bg-panel-50', sticky && 'sticky top-0 z-10')}>
      <tr className="border-b border-panel-200 text-left">{children}</tr>
    </thead>
  );
}

export function TH({
  children,
  width,
  align = 'left',
  srOnly = false,
}: {
  children: ReactNode;
  width?: string;
  align?: 'left' | 'right';
  /** For an actions column: keeps the column, hides the word. */
  srOnly?: boolean;
}) {
  return (
    <th
      scope="col"
      style={{ width }}
      className={clsx(
        'whitespace-nowrap px-5 py-3 text-2xs font-semibold uppercase tracking-[0.07em] text-panel-500',
        align === 'right' && 'text-right'
      )}
    >
      {srOnly ? <span className="sr-only">{children}</span> : children}
    </th>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-panel-100">{children}</tbody>;
}

export function TR({
  children,
  onActivate,
  className,
}: {
  children: ReactNode;
  /** Makes the row a real control: pointer, focusable, Enter/Space activated. */
  onActivate?: () => void;
  className?: string;
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (!onActivate) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onActivate();
    }
  };

  return (
    <tr
      onClick={onActivate}
      onKeyDown={onKeyDown}
      tabIndex={onActivate ? 0 : undefined}
      className={clsx(
        'text-sm transition-colors duration-150 ease-out',
        onActivate
          ? 'cursor-pointer hover:bg-panel-25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-signal-600'
          : 'hover:bg-panel-25',
        className
      )}
    >
      {children}
    </tr>
  );
}

export function TD({
  children,
  align = 'left',
  numeric = false,
  mono = false,
  className,
}: {
  children: ReactNode;
  align?: 'left' | 'right';
  /** Tabular figures, for anything that gets compared down a column. */
  numeric?: boolean;
  mono?: boolean;
  className?: string;
}) {
  return (
    <td
      {...(numeric ? { 'data-numeric': true } : {})}
      className={clsx(
        'px-5 py-3.5 text-ink-800',
        align === 'right' && 'text-right',
        mono && 'font-mono text-2xs text-panel-600',
        className
      )}
    >
      {children}
    </td>
  );
}

/**
 * Empty states distinguish "nothing exists" from "nothing matched", because the
 * next action is different: one is wait, the other is widen your filters.
 */
export function TableEmpty({
  title,
  body,
  icon,
}: {
  title: string;
  body: string;
  icon?: ReactNode;
}) {
  return (
    <div className="border border-panel-200 bg-surface-raised px-6 py-14 text-center">
      {icon && <div className="mb-3 flex justify-center">{icon}</div>}
      <p className="text-sm font-medium text-ink-800">{title}</p>
      <p className="mt-1 text-xs text-panel-500">{body}</p>
    </div>
  );
}
