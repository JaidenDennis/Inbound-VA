'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import clsx from 'clsx';

export interface TabSpec {
  key: string;
  label: string;
}

/**
 * Tabs whose selection lives in the URL.
 *
 * Same reasoning as FilterBar: a tab is a place. `scroll={false}` behaviour is
 * preserved by using router.replace, so switching tabs does not jump the page
 * back to the top.
 */
export function Tabs({ tabs, paramKey = 'tab' }: { tabs: TabSpec[]; paramKey?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = searchParams.get(paramKey) ?? tabs[0]?.key;

  const select = (key: string) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set(paramKey, key);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  return (
    <div className="mb-6 border-b border-gray-200">
      <div role="tablist" className="-mb-px flex flex-wrap gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          const selected = tab.key === active;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => select(tab.key)}
              className={clsx(
                'cursor-pointer whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors',
                'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1',
                selected
                  ? 'border-primary-600 text-primary-700'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Read the active tab outside the component that renders the strip. */
export function useActiveTab(tabs: TabSpec[], paramKey = 'tab'): string {
  const searchParams = useSearchParams();
  return searchParams.get(paramKey) ?? tabs[0]?.key ?? '';
}
