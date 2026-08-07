'use client';

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { X } from 'lucide-react';

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterSpec {
  /** Querystring key. Also the input's id, so labels can point at it. */
  key: string;
  label: string;
  type: 'select' | 'search' | 'date';
  options?: FilterOption[];
  placeholder?: string;
}

/**
 * Filters held in the URL rather than component state.
 *
 * The point is that a filtered view is a place: it can be linked to a colleague,
 * survives a refresh, and the back button undoes a filter instead of leaving the
 * page. Local state gives up all three.
 */
export function useFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const get = useCallback((key: string) => searchParams.get(key) ?? '', [searchParams]);

  const set = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(searchParams.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      // Any filter change invalidates the current page of results.
      next.delete('page');
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const clear = useCallback(() => {
    router.replace(pathname, { scroll: false });
  }, [pathname, router]);

  return { get, set, clear, params: searchParams };
}

export function FilterBar({ filters }: { filters: FilterSpec[] }) {
  const { get, set, clear, params } = useFilters();
  const activeCount = filters.filter((f) => get(f.key)).length;

  const inputCls =
    'rounded-md border border-panel-300 bg-white px-3 py-2 text-sm text-ink-900 ' +
    'placeholder:text-panel-400 transition-colors duration-150 hover:border-panel-400 ' +
    'focus:outline-none focus:border-signal-600 focus:ring-2 focus:ring-signal-600/25';

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-panel-200 bg-white p-4">
      {filters.map((filter) => (
        <div key={filter.key} className="flex flex-col gap-1.5">
          <label
            htmlFor={filter.key}
            className="text-2xs font-semibold uppercase tracking-[0.07em] text-panel-500"
          >
            {filter.label}
          </label>
          {filter.type === 'select' ? (
            <select
              id={filter.key}
              className={`${inputCls} cursor-pointer`}
              value={get(filter.key)}
              onChange={(e) => set(filter.key, e.target.value)}
            >
              <option value="">All</option>
              {(filter.options ?? []).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={filter.key}
              type={filter.type === 'date' ? 'date' : 'search'}
              className={inputCls}
              placeholder={filter.placeholder}
              value={get(filter.key)}
              onChange={(e) => set(filter.key, e.target.value)}
            />
          )}
        </div>
      ))}

      {activeCount > 0 && (
        <button
          type="button"
          onClick={clear}
          className="flex cursor-pointer items-center gap-1.5 rounded-md border border-transparent px-3 py-2 text-sm font-medium text-panel-600 transition-colors duration-150 hover:border-panel-200 hover:bg-panel-50 hover:text-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600"
        >
          <X className="h-4 w-4" aria-hidden />
          Clear {activeCount} filter{activeCount > 1 ? 's' : ''}
        </button>
      )}

      {/* Announced to screen readers when results change, since the table
          contents update without any navigation. */}
      <span className="sr-only" role="status">
        {activeCount === 0 ? 'No filters applied' : `${activeCount} filters applied: ${params.toString()}`}
      </span>
    </div>
  );
}
