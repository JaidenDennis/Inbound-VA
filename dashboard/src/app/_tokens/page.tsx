/**
 * TOKEN SHEET — throwaway. Deleted at the end of Phase 3.
 *
 * Renders the raw token layer and the base atoms so the world can be
 * judged before 21 primitives are rebuilt on top of it. Not linked from
 * anywhere and not part of the product.
 */
'use client';

import { Suspense, useEffect, useState, useSyncExternalStore } from 'react';
import { useSearchParams } from 'next/navigation';
import { Phone, Users, Calendar, TrendingUp } from 'lucide-react';
import { KPICard } from '@/components/KPICard';
import { Table, TableShell, TBody, TD, TH, THead, TR } from '@/components/Table';
import { VolumeChart, type VolumePoint } from '@/components/charts/VolumeChart';
import { OutcomeChart, type OutcomePoint } from '@/components/charts/OutcomeChart';
import { PageHeader } from '@/components/PageHeader';
import { Tabs } from '@/components/Tabs';
import { Badge } from '@/components/Badge';
import { StatusPill } from '@/components/StatusPill';
import { FilterBar } from '@/components/FilterBar';
import { Drawer } from '@/components/Drawer';
import { ConfirmDialog } from '@/components/ConfirmDialog';

// Sample data for the two real chart components rendered below — this page
// is unauthenticated, so it is the only place their rendered output (as
// opposed to the plain colour swatches above) can be checked without a login.
const SAMPLE_VOLUME: VolumePoint[] = [
  { bucket: '2026-08-01', answered: 18, voicemail: 6, total: 24 },
  { bucket: '2026-08-02', answered: 22, voicemail: 4, total: 26 },
  { bucket: '2026-08-03', answered: 15, voicemail: 9, total: 24 },
  { bucket: '2026-08-04', answered: 27, voicemail: 5, total: 32 },
  { bucket: '2026-08-05', answered: 20, voicemail: 7, total: 27 },
  { bucket: '2026-08-06', answered: 24, voicemail: 3, total: 27 },
  { bucket: '2026-08-07', answered: 19, voicemail: 8, total: 27 },
];

const SAMPLE_OUTCOMES: OutcomePoint[] = [
  { outcome: 'appointment_booked', count: 42 },
  { outcome: 'lead_captured', count: 31 },
  { outcome: 'transferred', count: 18 },
  { outcome: 'question_answered', count: 54 },
  { outcome: 'voicemail', count: 12 },
  { outcome: 'abandoned', count: 6 },
];

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

// Same key, same DOM attribute, same event names as ThemeToggle.tsx and the
// pre-paint THEME_BOOT script in layout.tsx. This page previously kept a
// private `useState` copy of "am I dark" that never touched
// localStorage[gravvia_theme] or dispatched `theme-change` — so toggling
// theme here did nothing to the rest of the app's theme state, and toggling
// it via the real ThemeToggle elsewhere did nothing to this page. Reading
// through useSyncExternalStore against the same DOM attribute ThemeToggle
// writes is what makes this page reflect the real theme system instead of a
// disconnected copy of it.
const THEME_KEY = 'gravvia_theme';

function subscribeTheme(cb: () => void) {
  window.addEventListener('storage', cb);
  window.addEventListener('theme-change', cb);
  return () => {
    window.removeEventListener('storage', cb);
    window.removeEventListener('theme-change', cb);
  };
}

function getThemeSnapshot(): 'light' | 'dark' {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function getThemeServerSnapshot(): 'light' | 'dark' {
  return 'light';
}

function TokenSheetInner() {
  // `useSearchParams` (not a raw `window.location` read) so the value is
  // identical on the server-rendered HTML and the client's first render —
  // reading `window` directly would diverge from SSR (which has no
  // `window`) and trip a React hydration-mismatch error. `?theme=dark` on
  // first paint lets headless screenshots force a theme without simulating
  // a click; seeding it into the same `gravvia_theme` key the rest of the
  // app reads is theme state, not authentication.
  const searchParams = useSearchParams();
  const urlTheme = searchParams.get('theme');

  useEffect(() => {
    if (urlTheme !== 'dark' && urlTheme !== 'light') return;
    document.documentElement.setAttribute('data-theme', urlTheme);
    try { localStorage.setItem(THEME_KEY, urlTheme); } catch { /* private mode */ }
    window.dispatchEvent(new Event('theme-change'));
    // Runs once per mount against a fixed URL param; re-firing on every
    // snapshot change would fight a manual toggle click.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const theme = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getThemeServerSnapshot);
  const dark = theme === 'dark';

  const toggle = () => {
    const next = dark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* private mode */ }
    window.dispatchEvent(new Event('theme-change'));
  };

  // Closed by default so the main sheet renders in full (both overlays are
  // fixed/portalled and would otherwise cover the rest of the page). Open
  // via the buttons below the chart rows for a dedicated capture of each
  // component's open state.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

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

        <Row title="PageHeader — with eyebrow">
          <div className="w-full border border-hairline bg-surface-raised p-6">
            <PageHeader
              eyebrow="Client · Bare Beauty"
              title="Calls"
              description="Every inbound call across this client's numbers, newest first."
              breadcrumbs={[{ label: 'Clients', href: '#' }, { label: 'Bare Beauty' }]}
              action={
                <button className="border border-action bg-action px-4 py-2 text-sm font-medium text-[rgb(var(--action-contrast-rgb))] transition-colors hover:bg-transparent hover:text-action">
                  Export
                </button>
              }
            />
          </div>
        </Row>

        <Row title="PageHeader — without eyebrow">
          <div className="w-full border border-hairline bg-surface-raised p-6">
            <PageHeader title="Settings" description="Business information, agent configuration, and notification routing." />
          </div>
        </Row>

        <Row title="Tabs — selection lives in the URL">
          <div className="w-full">
            <Tabs
              tabs={[
                { key: 'overview', label: 'Overview' },
                { key: 'transcript', label: 'Transcript' },
                { key: 'summary', label: 'Summary' },
              ]}
              paramKey="tokensheet_tab"
            />
          </div>
        </Row>

        <Row title="Badge — achromatic by default, never a status carrier">
          <Badge label="Dentist" variant="gray" />
          <Badge label="Plan · Growth" variant="primary" />
          <Badge label="Owner" variant="secondary" />
          <Badge label="Success" variant="success" />
          <Badge label="Warning" variant="warning" />
          <Badge label="Error" variant="error" />
        </Row>

        <Row title="StatusPill — lamp + icon + word, never colour alone">
          <StatusPill tone="critical" label="Fatal" />
          <StatusPill tone="error" label="Failed" />
          <StatusPill tone="warning" label="Degraded" />
          <StatusPill tone="success" label="Healthy" />
          <StatusPill tone="info" label="Info" />
          <StatusPill tone="pending" label="Syncing" />
          <StatusPill tone="neutral" label="Not provisioned" />
        </Row>

        <Row title="FilterBar — filters live in the URL, not component state">
          <div className="w-full">
            <FilterBar
              filters={[
                {
                  key: 'tokensheet_outcome',
                  label: 'Outcome',
                  type: 'select',
                  options: [
                    { value: 'booked', label: 'Booked' },
                    { value: 'transferred', label: 'Transferred' },
                  ],
                },
                { key: 'tokensheet_search', label: 'Caller', type: 'search', placeholder: 'Search phone number' },
                { key: 'tokensheet_since', label: 'Since', type: 'date' },
              ]}
            />
          </div>
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

        <Row title="KPI — the site's .kpi, cobalt-rimmed well on a cobalt wash">
          <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KPICard label="Calls" value="1,284" icon={Phone} color="primary" trend={12} trendLabel="vs last week" />
            <KPICard label="Leads captured" value="342" icon={Users} color="primary" trend={-4} trendLabel="vs last week" />
            <KPICard label="Appointments" value="96" icon={Calendar} color="primary" subtitle="booked this week" />
            <KPICard label="Conversion" value="26.6%" icon={TrendingUp} color="primary" trend={3} />
          </div>
        </Row>

        <Row title="Table — the site's .log, mono heads, hairline rows, cobalt hover">
          <TableShell className="w-full">
            <Table caption="Recent calls">
              <THead>
                <TH>Caller</TH>
                <TH>Outcome</TH>
                <TH align="right">Duration</TH>
              </THead>
              <TBody>
                {[
                  { caller: '(415) 555-0182', outcome: 'Booked', duration: '4m 12s' },
                  { caller: '(212) 555-0143', outcome: 'FAQ answered', duration: '1m 48s' },
                  { caller: '(646) 555-0119', outcome: 'Transferred', duration: '6m 02s' },
                ].map((row) => (
                  <TR key={row.caller}>
                    <TD mono>{row.caller}</TD>
                    <TD>{row.outcome}</TD>
                    <TD align="right" numeric>{row.duration}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableShell>
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

        <Row title="VolumeChart — stacked area, hatch on the second series">
          <div className="viz-root w-full border border-hairline bg-surface-raised p-5">
            <VolumeChart data={SAMPLE_VOLUME} bucket="day" />
          </div>
        </Row>

        <Row title="OutcomeChart — single series, horizontal bars, square ends">
          <div className="viz-root w-full border border-hairline bg-surface-raised p-5">
            <OutcomeChart data={SAMPLE_OUTCOMES} />
          </div>
        </Row>

        <Row title="Sidebar — NOT renderable here">
          <p className="max-w-[70ch] text-sm leading-relaxed text-text-secondary">
            <code className="font-mono text-2xs">Sidebar.tsx</code> calls <code className="font-mono text-2xs">useSession()</code>{' '}
            from <code className="font-mono text-2xs">@/lib/SessionProvider</code>, which this unauthenticated page has no
            provider for and cannot fake without either mocking a session (out of scope for a token sheet) or standing up
            real auth. Rather than build mock-auth scaffolding to force it in, the nav rail is left unrendered here — it was
            visually verified once by the controller through a real screenshot at Task 5 review, and is due another real,
            authenticated screenshot at whatever gate this project runs behind a real login.
          </p>
        </Row>

        <Row title="Drawer / ConfirmDialog — open via these buttons (both are fixed/portalled overlays)">
          <div className="flex gap-3">
            <button
              id="tokensheet-open-drawer"
              onClick={() => setDrawerOpen(true)}
              className="border border-rule px-4 py-2 text-sm font-medium transition-colors hover:border-action hover:text-action"
            >
              Open drawer
            </button>
            <button
              id="tokensheet-open-dialog"
              onClick={() => setDialogOpen(true)}
              className="border border-rule px-4 py-2 text-sm font-medium transition-colors hover:border-action hover:text-action"
            >
              Open confirm dialog
            </button>
          </div>
        </Row>
      </div>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="Call detail">
        <p className="text-sm text-text-secondary">
          The real Drawer component, imported — not redrawn. Right-hand panel, hard left border,
          focus trapped, Escape and the scrim both close it.
        </p>
      </Drawer>

      <ConfirmDialog
        open={dialogOpen}
        title="Revoke access for jamie@bareb.co?"
        body="Removes their login immediately. They can be re-invited later, but any session they hold right now ends on their next request."
        confirmLabel="Revoke access"
        onConfirm={() => setDialogOpen(false)}
        onCancel={() => setDialogOpen(false)}
      />
    </div>
  );
}
