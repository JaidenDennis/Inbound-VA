'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Phone, Users, Calendar, TrendingUp, Clock, ArrowRight, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { KPICard } from '@/components/KPICard';
import { StatusLamp, LampStatus, type LampLevel } from '@/components/StatusLamp';
import { useSession } from '@/lib/SessionProvider';
import type { Permission } from '@/lib/session';

interface Overview {
  totalCalls: number;
  leadsCapured: number;
  appointmentsBooked: number;
  avgCallDurationSeconds: number;
  conversionRate: string;
}

interface GroupedRow {
  fingerprint: string;
  errorName: string;
  message: string;
  route: string | null;
  severity: string;
  count: number;
  lastSeen: string;
}

/** Real counts by severity. Never a hardcoded "all systems green". */
interface Health {
  fatal: number;
  error: number;
  warn: number;
  worst: GroupedRow[];
}

/** Slow enough not to hammer a cross-tenant aggregate, fast enough to trust. */
const REFRESH_MS = 30_000;

/** How old a reading may get before the panel says so in words. */
const STALE_MS = 90_000;

function sinceLabel(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function timeAgo(iso: string, now: number): string {
  const seconds = Math.floor((now - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/**
 * The lamp field.
 *
 * This is the thesis of the surface: before reading a single figure, the
 * operator knows whether anything is wrong. Green is good, amber is fair, red
 * is bad, and every lamp here is lit by a real count from
 * /system/activity/grouped — nothing on this strip is decorative.
 */
function LampField({
  health,
  updatedAt,
  refreshing,
  onRefresh,
}: {
  health: Health;
  updatedAt: number | null;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  // The clock is state, not a render-time read. Reading Date.now() during
  // render is impure and leaves the age label frozen until the next
  // unrelated re-render.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const age = updatedAt ? now - updatedAt : null;
  const stale = age !== null && age > STALE_MS;

  const cells: Array<{ level: LampLevel; count: number; label: string; hint: string; href: string }> = [
    {
      level: health.fatal > 0 ? 'bad' : 'good',
      count: health.fatal,
      label: 'Fatal',
      hint: health.fatal > 0 ? 'Process-level failures' : 'None recorded',
      href: '/dashboard/system?severity=fatal',
    },
    {
      level: health.error > 0 ? 'bad' : 'good',
      count: health.error,
      label: 'Errors',
      hint: health.error > 0 ? 'Requests and jobs failing' : 'None recorded',
      href: '/dashboard/system?severity=error',
    },
    {
      level: health.warn > 0 ? 'fair' : 'good',
      count: health.warn,
      label: 'Warnings',
      hint: health.warn > 0 ? 'Degraded, not failing' : 'None recorded',
      href: '/dashboard/system?severity=warn',
    },
  ];

  const worstLevel: LampLevel =
    health.fatal + health.error > 0 ? 'bad' : health.warn > 0 ? 'fair' : 'good';
  const verdict =
    worstLevel === 'bad' ? 'Attention required'
      : worstLevel === 'fair' ? 'Degraded' : 'All clear';

  return (
    <section aria-labelledby="health-heading" className="mb-7">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-baseline gap-3">
          <h2 id="health-heading" className="label-instrument">System state</h2>
          {/* A reading is only as good as its age, so the age is never hidden. */}
          <span
            className={stale ? 'font-mono text-2xs uppercase tracking-[0.16em] text-lamp-fair-ink' : 'font-mono text-2xs uppercase tracking-[0.16em] text-text-muted'}
          >
            {age === null ? 'not yet read' : stale ? `stale · read ${sinceLabel(age)}` : `read ${sinceLabel(age)}`}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <LampStatus level={worstLevel} label={verdict} live={worstLevel === 'bad'} />
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="flex cursor-pointer items-center gap-1.5 border border-rule px-2.5 py-1.5 font-mono text-2xs uppercase tracking-[0.16em] text-text transition-colors duration-150 hover:border-action hover:text-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action disabled:opacity-60"
          >
            <RefreshCw
              className={refreshing ? 'h-3 w-3 animate-spin' : 'h-3 w-3'}
              aria-hidden
            />
            {refreshing ? 'Reading' : 'Refresh'}
          </button>
        </div>
      </div>
      {/* Screen readers get the state change without watching the lamps. */}
      <p className="sr-only" role="status">
        {`System state: ${verdict}. ${health.fatal} fatal, ${health.error} errors, ${health.warn} warnings.`}
      </p>

      <div className="grid grid-cols-1 border border-edge bg-surface-raised sm:grid-cols-3">
        {cells.map((cell, i) => (
          <Link
            key={cell.label}
            href={cell.href}
            className={[
              'group flex items-center gap-4 px-5 py-4 transition-colors duration-120 ease-out hover:bg-action-50',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-action',
              i > 0 ? 'border-t border-hairline sm:border-l sm:border-t-0' : '',
            ].join(' ')}
          >
            <StatusLamp
              level={cell.level}
              size="lg"
              live={cell.level === 'bad'}
              label={`${cell.label}: ${cell.level === 'good' ? 'good' : cell.level === 'fair' ? 'fair' : 'bad'}`}
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span
                  data-numeric
                  className="font-heading text-2xl font-medium tracking-[-0.02em] text-text"
                >
                  {cell.count}
                </span>
                <span className="font-mono text-2xs uppercase tracking-[0.16em] text-text-muted">
                  {cell.label}
                </span>
              </span>
              <span className="mt-0.5 block truncate text-xs text-text-muted">{cell.hint}</span>
            </span>
            <ArrowRight
              className="h-4 w-4 flex-shrink-0 text-text-faint transition-all duration-150 ease-out group-hover:translate-x-0.5 group-hover:text-text-muted"
              aria-hidden
            />
          </Link>
        ))}
      </div>
    </section>
  );
}

function WorstFirst({ rows, now }: { rows: GroupedRow[]; now: number }) {
  return (
    <section aria-labelledby="worst-heading">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 id="worst-heading" className="label-instrument">Worst first</h2>
        <Link
          href="/dashboard/system"
          className="font-mono text-2xs uppercase tracking-[0.16em] text-action underline decoration-action/40 underline-offset-2 transition-colors hover:decoration-action"
        >
          Open System Health
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="border border-hairline bg-surface-raised px-6 py-10 text-center">
          <StatusLamp level="good" size="lg" className="mx-auto mb-3" label="Good" />
          <p className="text-sm font-medium text-text">Nothing is failing</p>
          <p className="mt-1 text-xs text-text-muted">
            No grouped errors in the current window.
          </p>
        </div>
      ) : (
        <ul className="border border-hairline bg-surface-raised">
          {rows.map((row, i) => (
            <li key={row.fingerprint} className={i > 0 ? 'border-t border-hairline' : ''}>
              <Link
                href="/dashboard/system"
                className="group flex items-start gap-3 px-4 py-2.5 transition-colors duration-120 ease-out hover:bg-action-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-action"
              >
                <span className="mt-1.5">
                  <StatusLamp
                    level={row.severity === 'warn' ? 'fair' : 'bad'}
                    size="sm"
                    live={row.severity === 'fatal'}
                    label={row.severity === 'warn' ? 'Fair' : 'Bad'}
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-text">
                    {row.errorName}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-text-muted">
                    {row.message}
                  </span>
                </span>
                {row.route && (
                  <span className="hidden flex-shrink-0 font-mono text-2xs text-text-muted sm:block">
                    {row.route}
                  </span>
                )}
                <span
                  data-numeric
                  className="flex-shrink-0 border border-hairline px-1.5 py-0.5 font-mono text-2xs text-text-secondary"
                >
                  &times;{row.count}
                </span>
                <span className="hidden flex-shrink-0 text-2xs text-text-muted md:block">
                  {timeAgo(row.lastSeen, now)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Skeleton() {
  return (
    <div aria-hidden>
      <div className="mb-6 h-8 w-56 animate-pulse bg-panel-200" />
      <div className="mb-7 h-[5.5rem] animate-pulse bg-panel-200" />
      <div className="mb-7 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse bg-panel-200" />
        ))}
      </div>
      <div className="h-56 animate-pulse bg-panel-200" />
    </div>
  );
}

/**
 * The client landing page's content.
 *
 * Platform staff get the system lamps and the cross-tenant roll-up; a client
 * user gets neither (the roll-up endpoint is platform-only by design), so this
 * gives them somewhere to go instead of an empty screen. Deliberately no
 * figures: the only client-scoped numbers live on Business, and duplicating
 * them here would mean a second source that can disagree with it.
 */
function ClientSignposts({ can }: { can: (permission: Permission) => boolean }) {
  const all: Array<{ href: string; label: string; blurb: string; permission: Permission }> = [
    {
      href: '/dashboard/business',
      label: 'Business',
      blurb: 'Calls, leads and bookings for your account.',
      permission: 'analytics:read',
    },
    {
      href: '/dashboard/queue',
      label: 'Work Queue',
      blurb: 'Calls the agent flagged for a person to pick up.',
      permission: 'flags:read',
    },
    {
      href: '/dashboard/knowledge',
      label: 'Knowledge',
      blurb: 'What the agent tells callers — FAQs, services, policies, hours.',
      permission: 'knowledge:read',
    },
    {
      href: '/dashboard/support',
      label: 'Support',
      blurb: 'Raise something with us and track where it stands.',
      permission: 'tickets:read',
    },
  ];

  const links = all.filter((l) => can(l.permission));
  if (links.length === 0) return null;

  return (
    <section aria-labelledby="signpost-heading" className="mb-7">
      <h2 id="signpost-heading" className="label-instrument mb-3">Your account</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="lift group block border border-hairline bg-surface-raised px-5 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
          >
            <span className="flex items-start justify-between gap-3">
              <span>
                <span className="block font-heading text-base font-medium text-text">{l.label}</span>
                <span className="mt-1 block text-xs text-text-muted">{l.blurb}</span>
              </span>
              <ArrowRight
                className="mt-0.5 h-4 w-4 flex-shrink-0 text-text-faint transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

export default function DashboardPage() {
  const { can, isPlatform } = useSession();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  // Drives WorstFirst's relative timestamps ("2m ago"). Reading Date.now()
  // during render is impure, so the clock lives in state instead.
  const [now, setNow] = useState(() => Date.now());
  const aliveRef = useRef(true);

  const canSeeSystem = can('system:read');

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (mode === 'refresh') setRefreshing(true);

      const [ov, groups] = await Promise.all([
        // /analytics/overview is platform-only (requirePlatform in
        // analytics.route.ts) because it rolls up every tenant. This is the
        // CLIENT nav's landing page too, so calling it unconditionally meant
        // every client user hit a 403 here and got a permanent "analytics did
        // not respond" alert on the first screen they see. Same treatment as
        // health below: don't ask for what this user cannot have.
        isPlatform
          ? api.get('/analytics/overview').then((r) => r.data as Overview).catch(() => null)
          : Promise.resolve(null),
        // Health is staff-only; a client user must not trigger a 403 on load.
        canSeeSystem
          ? api
              .get('/system/activity/grouped')
              .then((r) => (r.data?.data ?? []) as GroupedRow[])
              .catch(() => null)
          : Promise.resolve(null),
      ]);

      if (!aliveRef.current) return;

      // On a refresh, a transient failure must not blank a panel that was
      // showing good data a second ago; keep the last good values and let the
      // staleness clock tell the operator the reading is aging.
      // `failed` means "we asked and got nothing back". A client user is never
      // asked, so it must stay false for them or the alert returns.
      if (ov) {
        setOverview(ov);
        setFailed(false);
      } else if (mode === 'initial' && isPlatform) {
        setFailed(true);
      }

      if (groups) {
        const tally = (s: string) =>
          groups.filter((g) => g.severity === s).reduce((n, g) => n + g.count, 0);
        setHealth({
          fatal: tally('fatal'),
          error: tally('error'),
          warn: tally('warn'),
          worst: [...groups]
            .sort((a, b) => {
              const rank = (s: string) => (s === 'fatal' ? 0 : s === 'error' ? 1 : 2);
              return rank(a.severity) - rank(b.severity) || b.count - a.count;
            })
            .slice(0, 5),
        });
      }

      if (ov || groups) setUpdatedAt(Date.now());
      setLoading(false);
      setRefreshing(false);
    },
    [canSeeSystem, isPlatform]
  );

  /**
   * A supervisory panel that reports a page-load snapshot forever is worse than
   * no panel: it manufactures confidence in state that may be an hour old. So it
   * polls, it stops polling while the tab is hidden (no point burning a request
   * nobody is reading), and it refreshes immediately on return so the first
   * thing a returning operator sees is current.
   */
  useEffect(() => {
    aliveRef.current = true;
    void load('initial');

    let timer: number | undefined;
    const start = () => {
      window.clearInterval(timer);
      timer = window.setInterval(() => void load('refresh'), REFRESH_MS);
    };
    const onVisibility = () => {
      if (document.hidden) {
        window.clearInterval(timer);
      } else {
        void load('refresh');
        start();
      }
    };

    start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      aliveRef.current = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load]);

  // Re-render the staleness clock without refetching, so "2m ago" stays true.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(t);
  }, []);

  if (loading) return <Skeleton />;

  const minutes = overview ? Math.floor(overview.avgCallDurationSeconds / 60) : 0;
  const seconds = overview ? overview.avgCallDurationSeconds % 60 : 0;

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow="Platform console"
        title="Overview"
        description={
          isPlatform
            ? 'System state first, then thirty days of call performance across every client.'
            : 'Where to go next. Your call figures live on the Business page.'
        }
      />

      {health && (
        <LampField
          health={health}
          updatedAt={updatedAt}
          refreshing={refreshing}
          onRefresh={() => void load('refresh')}
        />
      )}

      {failed ? (
        <div
          role="alert"
          className="border border-lamp-bad-rim bg-lamp-bad-wash px-5 py-4 text-sm text-lamp-bad-ink"
        >
          <p className="font-semibold">Performance figures did not load.</p>
          <p className="mt-1 text-xs leading-relaxed">
            The analytics service did not respond. System state above is unaffected.
            Reload to try again.
          </p>
        </div>
      ) : overview ? (
        <section aria-labelledby="perf-heading" className="mb-7">
          <h2 id="perf-heading" className="label-instrument mb-3">Last 30 days</h2>
          {/* No trend deltas: the analytics endpoint returns no prior-period
              figures, and inventing them would put fabricated numbers in front
              of an operator making real decisions. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <KPICard label="Calls" value={overview.totalCalls.toLocaleString()} icon={Phone} color="primary" />
            <KPICard label="Leads captured" value={overview.leadsCapured.toLocaleString()} icon={Users} color="primary" />
            <KPICard label="Appointments" value={overview.appointmentsBooked.toLocaleString()} icon={Calendar} color="primary" />
            <KPICard label="Conversion" value={`${overview.conversionRate}%`} icon={TrendingUp} color="primary" />
            <KPICard label="Avg duration" value={`${minutes}m ${seconds}s`} icon={Clock} color="primary" />
          </div>
        </section>
      ) : null}

      {/* A client user is not shown the cross-tenant roll-up above, so without
          this the landing page would be a heading and nothing else. Links only
          — no numbers are invented here, and each one is gated on the same
          permission the sidebar uses, so nothing appears that would 403. */}
      {!isPlatform && <ClientSignposts can={can} />}

      {health && <WorstFirst rows={health.worst} now={now} />}
    </div>
  );
}
