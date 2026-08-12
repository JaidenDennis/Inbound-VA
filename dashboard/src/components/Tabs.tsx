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
    <div className="mb-6 border-b border-hairline">
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
                'cursor-pointer whitespace-nowrap px-4 py-3 transition-colors',
                'focus:outline-none focus:ring-2 focus:ring-action focus:ring-offset-1',
                selected
                  ? 'border-b-2 border-action font-mono text-2xs uppercase tracking-[0.16em] text-action'
                  : 'border-b-2 border-transparent font-mono text-2xs uppercase tracking-[0.16em] text-text-muted hover:border-rule hover:text-text'
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
