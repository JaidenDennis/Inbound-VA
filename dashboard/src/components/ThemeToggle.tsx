'use client';

import { useEffect, useState } from 'react';
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
 */
const KEY = 'gravvia_theme';

export function ThemeToggle() {
  // Starts null so the first render matches what the boot script already
  // painted; reading localStorage during render would desync hydration.
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null);

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem(KEY) : null;
    setTheme(stored === 'dark' ? 'dark' : 'light');
  }, []);

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(KEY, next); } catch { /* private mode */ }
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
