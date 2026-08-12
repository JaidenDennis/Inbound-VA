/**
 * TOKEN SHEET — throwaway. Deleted at the end of Phase 3.
 *
 * Renders the raw token layer and the base atoms so the world can be
 * judged before 21 primitives are rebuilt on top of it. Not linked from
 * anywhere and not part of the product.
 */
'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

// Tailwind scans source text, so interpolated class names are purged.
// This literal array is never rendered; it exists to be scanned. The
// leading underscore satisfies this repo's no-unused-vars convention
// (see eslint.config.mjs varsIgnorePattern), so no eslint-disable is needed.
const _SAFELIST = [
  'bg-panel-25', 'bg-panel-50', 'bg-panel-100', 'bg-panel-200', 'bg-panel-300', 'bg-panel-400',
  'bg-panel-500', 'bg-panel-600', 'bg-panel-700', 'bg-panel-800', 'bg-panel-900', 'bg-panel-950',
  'bg-lamp-good', 'bg-lamp-fair', 'bg-lamp-bad', 'bg-lamp-off',
  'text-lamp-good-ink', 'text-lamp-fair-ink', 'text-lamp-bad-ink', 'text-lamp-off-ink',
  'bg-action-50', 'bg-action-100', 'bg-action-200', 'bg-action-800',
];

const NEUTRALS = [25, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
const LAMPS = ['good', 'fair', 'bad', 'off'] as const;

function Row({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-hairline py-8">
      <h2 className="label-instrument mb-4">{title}</h2>
      <div className="flex flex-wrap items-end gap-3">{children}</div>
    </section>
  );
}

export default function TokenSheet() {
  // useSearchParams bails the route out of static rendering unless it's
  // wrapped in Suspense — Next's static prerender otherwise fails the
  // build with "useSearchParams() should be wrapped in a suspense
  // boundary". A null fallback is fine here: hydration is fast and this
  // is a throwaway internal page, not a user-facing loading state to polish.
  return (
    <Suspense fallback={null}>
      <TokenSheetInner />
    </Suspense>
  );
}

function TokenSheetInner() {
  // `useSearchParams` (not a raw `window.location` read) so the value is
  // identical on the server-rendered HTML and the client's first render —
  // reading `window` directly in a useState initializer would diverge from
  // SSR (which has no `window`) and trip a React hydration-mismatch error.
  // This also supports both interactive toggling and a `?theme=dark` URL
  // param on first paint, so headless screenshots can force a theme without
  // simulating a click.
  const searchParams = useSearchParams();
  const [dark, setDark] = useState(() => searchParams.get('theme') === 'dark');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }, [dark]);

  const toggle = () => setDark((prev) => !prev);

  return (
    <div className="min-h-screen bg-surface px-8 py-10 text-text">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-baseline justify-between">
          <div>
            <p className="label-instrument">Gravvia Engage</p>
            <h1 className="mt-1 font-heading text-4xl font-medium">Token sheet</h1>
          </div>
          <button
            onClick={toggle}
            className="border border-action bg-action px-4 py-2 font-mono text-2xs uppercase tracking-[0.16em] text-[rgb(var(--action-contrast-rgb))] transition-colors hover:bg-transparent hover:text-action"
          >
            {dark ? 'Light' : 'Dark'}
          </button>
        </div>

        <Row title="Neutral ramp — inverts between themes">
          {NEUTRALS.map((n) => (
            <div key={n} className="text-center">
              <div className={`h-14 w-14 border border-hairline bg-panel-${n}`} />
              <p className="mt-1 font-mono text-2xs text-text-muted">{n}</p>
            </div>
          ))}
        </Row>

        <Row title="Action — cobalt">
          {(['bg-action-50', 'bg-action-100', 'bg-action-200', 'bg-action', 'bg-action-800'] as const).map((c) => (
            <div key={c} className="text-center">
              <div className={`h-14 w-14 border border-hairline ${c}`} />
              <p className="mt-1 font-mono text-2xs text-text-muted">{c.replace('bg-', '')}</p>
            </div>
          ))}
        </Row>

        <Row title="Lamps — chroma is state, and only state">
          {LAMPS.map((l) => (
            <div key={l} className="flex items-center gap-2 border border-hairline px-3 py-2">
              <span className={`h-3 w-3 rounded-full bg-lamp-${l}`} />
              <span className={`font-mono text-2xs uppercase tracking-[0.16em] text-lamp-${l}-ink`}>{l}</span>
            </div>
          ))}
        </Row>

        <Row title="Surfaces">
          <div className="h-20 w-40 border border-hairline bg-surface p-2 font-mono text-2xs">surface</div>
          <div className="h-20 w-40 border border-hairline bg-surface-raised p-2 font-mono text-2xs">raised</div>
          <div className="h-20 w-40 border border-hairline bg-surface-inset p-2 font-mono text-2xs">inset</div>
          <div className="h-20 w-40 bg-surface-dark p-2 font-mono text-2xs text-text-on-dark">dark</div>
          <div className="h-20 w-40 bg-surface-dark p-2 font-mono text-2xs text-text-on-dark">
            <div className="h-full w-full bg-tint-on-dark/[0.08] p-2">tint-on-dark</div>
          </div>
        </Row>

        <Row title="Type — DM Sans / DM Mono">
          <div className="w-full space-y-2">
            <p className="font-heading text-5xl font-light">Display 300 · 49px</p>
            <p className="font-heading text-2xl font-medium">Heading 500 · 25px</p>
            <p className="text-base">Body 400 · 15px — the voice answers, the system decides.</p>
            <p className="text-sm text-text-secondary">Secondary 13px</p>
            <p className="font-mono text-2xs uppercase tracking-[0.16em] text-text-muted">Mono micro-label · 11px</p>
            <p className="font-mono text-sm tabular-nums">0123456789 · tabular figures</p>
          </div>
        </Row>

        <Row title="Controls">
          <button className="border border-action bg-action px-5 py-2.5 text-sm font-medium text-[rgb(var(--action-contrast-rgb))] transition-colors duration-150 hover:bg-transparent hover:text-action">
            Primary
          </button>
          <button className="border border-rule px-5 py-2.5 text-sm font-medium transition-colors duration-150 hover:border-action hover:text-action">
            Secondary
          </button>
          <input
            placeholder="you@company.com"
            className="border border-rule bg-surface-raised px-3 py-2.5 text-sm placeholder:text-text-muted focus:border-action focus:outline-none"
          />
        </Row>

        <Row title="Elevation — hard offsets, no blur">
          <div className="lift cursor-pointer border border-hairline bg-surface-raised px-6 py-8 text-sm">
            .lift — hover me
          </div>
          <div className="border border-edge bg-surface-raised px-6 py-8 text-sm shadow-cobalt">
            shadow-cobalt
          </div>
          <div className="border border-hairline bg-surface-raised px-6 py-8 text-sm shadow-lg">
            shadow-lg (ink)
          </div>
        </Row>

        <Row title="Chart series — cobalt + ink, texture not hue">
          <div className="viz-root flex w-full items-end gap-2" style={{ height: 120 }}>
            {[70, 45, 90, 30, 60].map((h, i) => (
              <div key={i} className="flex-1" style={{ height: `${h}%`, background: 'var(--series-1)' }} />
            ))}
            {[40, 55, 25].map((h, i) => (
              <div key={`b${i}`} className="flex-1" style={{ height: `${h}%`, background: 'var(--series-2)' }} />
            ))}
          </div>
        </Row>
      </div>
    </div>
  );
}
