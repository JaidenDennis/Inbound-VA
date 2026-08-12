'use client';

import { useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';

/**
 * Light/dark control.
 *
 * The key here MUST match the pre-paint THEME_BOOT script in layout.tsx.
 * That script is what prevents a bone flash on every dark-mode load; this
 * component only handles the change after the page is alive.
 *
 * Default is light — the marketing site's world, which is the point of
 * the whole facelift.
 *
 * The theme is external mutable state — a DOM attribute THEME_BOOT already
 * set before React hydrated, not component-owned state. useSyncExternalStore
 * reads that attribute directly instead of shadowing it in useState and
 * catching up via useEffect (which double-renders and desyncs from the DOM
 * whenever another tab or script changes it).
 */
const KEY = 'gravvia_theme';

function subscribe(cb: () => void) {
  window.addEventListener('storage', cb);
  window.addEventListener('theme-change', cb);
  return () => {
    window.removeEventListener('storage', cb);
    window.removeEventListener('theme-change', cb);
  };
}

function getSnapshot(): 'light' | 'dark' {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

// Matches THEME_BOOT's default when it has not run (SSR has no localStorage/DOM).
function getServerSnapshot(): 'light' | 'dark' {
  return 'light';
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(KEY, next); } catch { /* private mode */ }
    window.dispatchEvent(new Event('theme-change'));
  };

  const dark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 font-mono text-2xs uppercase tracking-[0.16em] text-text-on-dark-muted transition-colors duration-150 hover:bg-tint-on-dark/[0.05] hover:text-text-on-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
    >
      {dark
        ? <Sun className="h-[18px] w-[18px] flex-shrink-0" aria-hidden strokeWidth={1.75} />
        : <Moon className="h-[18px] w-[18px] flex-shrink-0" aria-hidden strokeWidth={1.75} />}
      <span className="flex-1 text-left">{dark ? 'Light' : 'Dark'}</span>
    </button>
  );
}
