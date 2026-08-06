'use client';

import { useState, type ReactNode } from 'react';
import { Table2 } from 'lucide-react';

/**
 * Shared shell for every chart on the reporting page.
 *
 * Carries the `viz-root` class that scopes the chart colour tokens defined in
 * globals.css, so both charts read colour by role and light/dark swap in one
 * place.
 *
 * Every chart also ships a table view. Colour is never the only channel: the
 * legend names each series, and the table carries every value for anyone the
 * chart does not serve.
 */
export function ChartCard({
  title,
  subtitle,
  children,
  table,
  actions,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** Accessible equivalent of the plotted data. */
  table?: ReactNode;
  actions?: ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);

  return (
    <section className="viz-root rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="font-heading text-base font-semibold text-gray-900">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-gray-500">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          {actions}
          {table && (
            <button
              type="button"
              onClick={() => setShowTable((s) => !s)}
              aria-pressed={showTable}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <Table2 className="h-3.5 w-3.5" aria-hidden />
              {showTable ? 'Show chart' : 'Show data'}
            </button>
          )}
        </div>
      </div>

      {showTable && table ? <div className="overflow-x-auto">{table}</div> : children}
    </section>
  );
}

/** Consistent table styling for the data view behind every chart. */
export function ChartTable({ headers, rows }: { headers: string[]; rows: (string | number)[][] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
          {headers.map((h) => (
            <th key={h} scope="col" className="px-3 py-2">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => (
              <td key={j} className={`px-3 py-2 ${j === 0 ? 'text-gray-800' : 'tabular-nums text-gray-600'}`}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
        {rows.length === 0 && (
          <tr><td colSpan={headers.length} className="px-3 py-6 text-center text-gray-400">No data</td></tr>
        )}
      </tbody>
    </table>
  );
}
