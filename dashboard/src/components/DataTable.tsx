'use client';

import { ReactNode } from 'react';
import { Table, TableEmpty, TableShell, TBody, TD, TH, THead, TR } from './Table';

interface Column<T> {
  key: keyof T;
  label: string;
  render?: (value: any, row: T) => ReactNode;
  width?: string;
  sortable?: boolean;
}

interface DataTableProps<T extends Record<string, any>> {
  columns: Column<T>[];
  data: T[];
  loading?: boolean;
  emptyState?: ReactNode;
  rowKey?: keyof T;
  onRowClick?: (row: T) => void;
  /** Announced to screen readers; the visible caption stays hidden. */
  caption?: string;
}

/**
 * The column-driven table. A thin wrapper over the primitives in Table.tsx, so
 * its chrome, heading treatment, row affordances, and keyboard behaviour are
 * literally the same code a bespoke table uses. Reach for the primitives
 * directly when cells need more than a `render` function.
 */
export function DataTable<T extends Record<string, any>>({
  columns,
  data,
  loading,
  emptyState,
  rowKey,
  onRowClick,
  caption,
}: DataTableProps<T>) {
  if (loading) {
    return (
      <TableShell>
        <Table caption="Loading results">
          <THead>
            {columns.map((col) => (
              <TH key={String(col.key)} width={col.width}>
                {col.label}
              </TH>
            ))}
          </THead>
          <tbody aria-hidden className="divide-y divide-panel-100">
            {[...Array(5)].map((_, i) => (
              <tr key={i}>
                {columns.map((col) => (
                  <td key={String(col.key)} className="px-5 py-4">
                    <div className="h-3.5 animate-pulse rounded bg-panel-200" style={{ width: '62%' }} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </Table>
        <span className="sr-only" role="status">
          Loading results
        </span>
      </TableShell>
    );
  }

  if (!data || data.length === 0) {
    if (emptyState) {
      return (
        <div className="rounded-xl border border-panel-200 bg-white px-6 py-14 text-center">
          {emptyState}
        </div>
      );
    }
    return (
      <TableEmpty
        title="No results"
        body="Nothing matched these filters. Widen the range or clear them."
      />
    );
  }

  return (
    <TableShell>
      <Table caption={caption}>
        <THead>
          {columns.map((col) => (
            <TH key={String(col.key)} width={col.width}>
              {col.label}
            </TH>
          ))}
        </THead>
        <TBody>
          {data.map((row, idx) => (
            <TR
              key={rowKey ? String(row[rowKey]) : idx}
              onActivate={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((col) => (
                <TD key={String(col.key)}>
                  {col.render ? col.render(row[col.key], row) : row[col.key]}
                </TD>
              ))}
            </TR>
          ))}
        </TBody>
      </Table>
    </TableShell>
  );
}
