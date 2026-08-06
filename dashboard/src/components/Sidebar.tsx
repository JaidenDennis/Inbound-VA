'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Building2, Phone, Calendar,
  BarChart2, Settings, Database, Users, LifeBuoy, ListChecks, LogOut,
  Activity, Bot, BookOpen, ScrollText,
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
      { href: '/dashboard/onboarding', label: 'Onboarding', icon: ListChecks, permission: 'clients:read' },
      { href: '/dashboard/crm', label: 'CRM', icon: Database, permission: 'crm:read' },
      { href: '/dashboard/analytics', label: 'Analytics', icon: BarChart2, permission: 'analytics:read' },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/dashboard/system', label: 'System Health', icon: Activity, permission: 'system:read' },
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
      { href: '/dashboard/reports', label: 'Reports', icon: BarChart2, permission: 'analytics:read' },
      { href: '/dashboard/knowledge', label: 'Knowledge', icon: BookOpen, permission: 'knowledge:read' },
      { href: '/dashboard/support', label: 'Support', icon: LifeBuoy, permission: 'tickets:read' },
      { href: '/dashboard/onboarding', label: 'Onboarding', icon: ListChecks, permission: 'clients:read' },
      { href: '/dashboard/team', label: 'Team', icon: Users, permission: 'users:write' },
    ],
  },
];

export default function Sidebar() {
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
    <nav className="flex min-h-screen w-64 flex-col border-r border-gray-200 bg-white shadow-sm">
      {/* Logo Section */}
      <div className="border-b border-gray-100 px-6 py-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-primary-600 to-primary-700">
            <span className="font-heading text-lg font-bold text-white">GE</span>
          </div>
          <div>
            <p className="font-heading font-semibold leading-tight text-gray-900">Gravvia Engage</p>
            <p className="text-xs text-gray-500">{isPlatform ? 'Platform' : 'Client'}</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto py-6">
        {loading ? (
          // Reserve the space the nav will occupy so the sidebar does not jump
          // when permissions land.
          <ul className="space-y-1 px-3" aria-hidden>
            {Array.from({ length: 8 }).map((_, i) => (
              <li key={i} className="mx-1 my-2 h-9 animate-pulse rounded-lg bg-gray-100" />
            ))}
          </ul>
        ) : (
          groups.map((group) => (
            <div key={group.label ?? 'main'} className="mb-6 last:mb-0">
              {group.label && (
                <p className="px-6 pb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
                  {group.label}
                </p>
              )}
              <ul className="space-y-1 px-3">
                {group.items.map(({ href, label, icon: Icon }) => {
                  const active = isActive(href);
                  return (
                    <li key={href}>
                      <Link
                        href={href}
                        aria-current={active ? 'page' : undefined}
                        className={clsx(
                          'flex cursor-pointer items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition-colors duration-200',
                          'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1',
                          active
                            ? 'border border-primary-200 bg-primary-50 text-primary-700 shadow-sm'
                            : 'border border-transparent text-gray-600 hover:bg-gray-50'
                        )}
                      >
                        <Icon
                          className={clsx('h-5 w-5 flex-shrink-0', active ? 'text-primary-600' : 'text-gray-400')}
                          aria-hidden
                        />
                        <span className="flex-1">{label}</span>
                        {active && <div className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary-600" aria-hidden />}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>

      <div className="border-t border-gray-100" />

      {/* User Section */}
      <div className="p-4">
        {auth && (
          <div className="mb-2 px-4">
            <p className="truncate text-sm font-medium text-gray-900">{auth.name || auth.email}</p>
            <p className="text-xs text-gray-500">{roleLabel(auth.role)}</p>
          </div>
        )}
        <button
          onClick={handleLogout}
          className={clsx(
            'flex w-full cursor-pointer items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition-colors duration-200',
            'border border-transparent text-gray-600 hover:border-red-200 hover:bg-red-50 hover:text-red-700',
            'focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1'
          )}
        >
          <LogOut className="h-5 w-5 flex-shrink-0" aria-hidden />
          <span className="flex-1 text-left">Sign Out</span>
        </button>
      </div>
    </nav>
  );
}
