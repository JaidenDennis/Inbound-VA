'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Building2, Phone, Calendar,
  BarChart2, Settings, Database, Users, LifeBuoy, ListChecks, LogOut,
  Activity, Bot, BookOpen, ScrollText, Menu, X, Plug, Sparkles,
  Inbox, TrendingUp, BellRing,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { useSession } from '@/lib/SessionProvider';
import { clearSession, roleLabel, type Permission } from '@/lib/session';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Omitted for items every signed-in user of that shell may see. */
  permission?: Permission;
}

interface NavGroup {
  label: string | null;
  items: NavItem[];
}

// A flat list stops working past roughly seven entries and staff now has
// thirteen, so staff navigation is grouped by what the person is doing.
const staffNav: NavGroup[] = [
  {
    label: 'Operate',
    items: [
      { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
      { href: '/dashboard/assistant', label: 'Assistant', icon: Sparkles },
      // Above Calls deliberately: this is the list with things waiting on a
      // person, and it should be the second thing an operator looks at.
      { href: '/dashboard/queue', label: 'Work Queue', icon: Inbox, permission: 'flags:read' },
      { href: '/dashboard/calls', label: 'Calls', icon: Phone, permission: 'calls:read' },
      { href: '/dashboard/bookings', label: 'Bookings', icon: Calendar, permission: 'bookings:read' },
      { href: '/dashboard/support', label: 'Support', icon: LifeBuoy, permission: 'tickets:read' },
    ],
  },
  {
    label: 'Clients',
    items: [
      { href: '/dashboard/clients', label: 'Clients', icon: Building2, permission: 'clients:read' },
      { href: '/dashboard/agents', label: 'Agents', icon: Bot, permission: 'agents:read' },
      { href: '/dashboard/knowledge', label: 'Knowledge', icon: BookOpen, permission: 'knowledge:read' },
      { href: '/dashboard/onboarding', label: 'Onboarding', icon: ListChecks, permission: 'clients:read' },
      { href: '/dashboard/connections', label: 'Connections', icon: Plug, permission: 'crm:read' },
      { href: '/dashboard/crm', label: 'CRM Sync', icon: Database, permission: 'crm:read' },
      { href: '/dashboard/analytics', label: 'Analytics', icon: BarChart2, permission: 'analytics:read' },
      // Per-tenant by design — staff reach it through the client picker. It is
      // the view the client sees, which is exactly why staff need it too.
      { href: '/dashboard/business', label: 'Business', icon: TrendingUp, permission: 'analytics:read' },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/dashboard/system', label: 'System Health', icon: Activity, permission: 'system:read' },
      { href: '/dashboard/alerts', label: 'Alerts', icon: BellRing, permission: 'analytics:read' },
      { href: '/dashboard/users', label: 'Users', icon: Users, permission: 'users:read' },
      { href: '/dashboard/audit', label: 'Audit Log', icon: ScrollText, permission: 'system:read' },
      { href: '/dashboard/settings', label: 'Settings', icon: Settings, permission: 'settings:read' },
    ],
  },
];

const clientNav: NavGroup[] = [
  {
    label: null,
    items: [
      { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
      { href: '/dashboard/assistant', label: 'Assistant', icon: Sparkles },
      // Business before Reports: the owner cares what it is worth before what it
      // did. Reports stays as the call-by-call detail behind these figures.
      { href: '/dashboard/business', label: 'Business', icon: TrendingUp, permission: 'analytics:read' },
      { href: '/dashboard/queue', label: 'Work Queue', icon: Inbox, permission: 'flags:read' },
      { href: '/dashboard/reports', label: 'Reports', icon: BarChart2, permission: 'analytics:read' },
      // Analytics (cross-company roll-up) is platform-only — see staffNav.
      // A client's own numbers live on Business, above.
      { href: '/dashboard/agent', label: 'My Agent', icon: Bot, permission: 'knowledge:read' },
      { href: '/dashboard/knowledge', label: 'Knowledge', icon: BookOpen, permission: 'knowledge:read' },
      { href: '/dashboard/connections', label: 'Connections', icon: Plug, permission: 'crm:read' },
      { href: '/dashboard/support', label: 'Support', icon: LifeBuoy, permission: 'tickets:read' },
      { href: '/dashboard/onboarding', label: 'Onboarding', icon: ListChecks, permission: 'clients:read' },
      { href: '/dashboard/alerts', label: 'Alerts', icon: BellRing, permission: 'analytics:read' },
      { href: '/dashboard/team', label: 'Team', icon: Users, permission: 'users:write' },
    ],
  },
];

/** The monogram, drawn as geometry rather than set as two letters in a box. */
function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden focusable="false">
      {/* An aperture opening to the right: the panel listening, then routing. */}
      <circle cx="16" cy="16" r="11.5" fill="none" stroke="currentColor" strokeWidth="2.25"
        strokeLinecap="round" strokeDasharray="54 18" transform="rotate(-52 16 16)" />
      <circle cx="16" cy="16" r="4.25" fill="currentColor" />
    </svg>
  );
}

function NavRail({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { auth, loading, can, isPlatform } = useSession();

  const groups = (isPlatform ? staffNav : clientNav)
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.permission || can(item.permission)),
    }))
    // A heading with nothing under it reads as a broken page, so empty groups go.
    .filter((group) => group.items.length > 0);

  const handleLogout = () => {
    clearSession();
    window.location.href = '/login';
  };

  const isActive = (href: string) =>
    href === '/dashboard' ? pathname === href : pathname === href || pathname.startsWith(href + '/');

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-ink-900 text-panel-300">
      {/* Identity */}
      <div className="flex items-center gap-3 border-b border-white/[0.07] px-5 py-5">
        <Mark className="h-8 w-8 flex-shrink-0 text-white" />
        <div className="min-w-0 leading-tight">
          <p className="truncate font-heading text-sm font-semibold text-white">Gravvia Engage</p>
          {/* panel-400 is the floor that clears 4.5:1 on ink-900; anything
              darker looked right in isolation and failed on the panel. */}
          <p className="truncate text-2xs uppercase tracking-[0.09em] text-panel-400">
            {isPlatform ? 'Platform console' : 'Client console'}
          </p>
        </div>
      </div>

      {/* Navigation */}
      <div className="min-h-0 flex-1 overflow-y-auto py-4">
        {loading ? (
          // Reserve the space the nav will occupy so the rail does not jump
          // when permissions land.
          <ul className="space-y-1 px-3" aria-hidden>
            {Array.from({ length: 8 }).map((_, i) => (
              <li key={i} className="mx-1 my-1.5 h-9 animate-pulse rounded-md bg-white/[0.05]" />
            ))}
          </ul>
        ) : (
          groups.map((group) => (
            <div key={group.label ?? 'main'} className="mb-5 last:mb-0">
              {group.label && (
                <p className="px-5 pb-2 text-2xs font-semibold uppercase tracking-[0.09em] text-panel-400">
                  {group.label}
                </p>
              )}
              <ul className="space-y-0.5 px-3">
                {group.items.map(({ href, label, icon: Icon }) => {
                  const active = isActive(href);
                  return (
                    <li key={href}>
                      <Link
                        href={href}
                        onClick={onNavigate}
                        aria-current={active ? 'page' : undefined}
                        className={clsx(
                          // py-3 keeps the row at a >=44px touch target without
                          // costing a visible line of nav on a 13-item rail.
                          'group flex cursor-pointer items-center gap-3 rounded-md px-3 py-3 text-sm',
                          'transition-colors duration-150 ease-out',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900',
                          active
                            // A depressed key: seated, lit, and legible — not a
                            // coloured stripe bolted to the edge.
                            ? 'bg-white/[0.10] font-semibold text-white shadow-seat'
                            : 'font-medium text-panel-400 hover:bg-white/[0.05] hover:text-panel-100'
                        )}
                      >
                        <Icon
                          className={clsx(
                            'h-[18px] w-[18px] flex-shrink-0 transition-colors duration-150',
                            active ? 'text-white' : 'text-panel-400 group-hover:text-panel-200'
                          )}
                          aria-hidden
                          strokeWidth={1.75}
                        />
                        <span className="flex-1 truncate">{label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>

      {/* Operator */}
      <div className="border-t border-white/[0.07] p-3">
        {auth && (
          <div className="mb-1 px-3 py-2">
            <p className="truncate text-sm font-medium text-panel-100">{auth.name || auth.email}</p>
            <p className="truncate text-2xs uppercase tracking-[0.07em] text-panel-400">
              {roleLabel(auth.role)}
            </p>
          </div>
        )}
        <button
          onClick={handleLogout}
          className={clsx(
            'flex w-full cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium',
            'text-panel-400 transition-colors duration-150 ease-out',
            'hover:bg-lamp-bad/[0.14] hover:text-lamp-bad-rim',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900'
          )}
        >
          <LogOut className="h-[18px] w-[18px] flex-shrink-0" aria-hidden strokeWidth={1.75} />
          <span className="flex-1 text-left">Sign out</span>
        </button>
      </div>
    </div>
  );
}

export default function Sidebar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Escape closes the mobile rail; the body must not scroll behind it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  // A route change must close the rail, or the panel covers the page it opened.
  useEffect(() => { setOpen(false); }, [pathname]);

  return (
    <>
      {/* Desktop rail */}
      <nav aria-label="Main" className="hidden w-64 flex-shrink-0 lg:block">
        <div className="fixed inset-y-0 left-0 w-64">
          <NavRail />
        </div>
      </nav>

      {/* Mobile bar */}
      <div className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-3 border-b border-white/[0.07] bg-ink-900 px-4 lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
          aria-expanded={open}
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md text-panel-300 transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400"
        >
          <Menu className="h-5 w-5" aria-hidden strokeWidth={1.75} />
        </button>
        <Mark className="h-6 w-6 text-white" />
        <p className="font-heading text-sm font-semibold text-white">Gravvia Engage</p>
      </div>

      {/* Mobile rail */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
            className="absolute inset-0 cursor-default bg-ink-900/60"
          />
          <nav
            aria-label="Main"
            className="absolute inset-y-0 left-0 w-[17rem] max-w-[85vw] animate-rise shadow-xl"
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close navigation"
              className="absolute right-3 top-4 z-10 flex h-9 w-9 cursor-pointer items-center justify-center rounded-md text-panel-400 transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400"
            >
              <X className="h-5 w-5" aria-hidden strokeWidth={1.75} />
            </button>
            <NavRail onNavigate={() => setOpen(false)} />
          </nav>
        </div>
      )}
    </>
  );
}
