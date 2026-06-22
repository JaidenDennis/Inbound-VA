'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Building2, Phone, Calendar,
  BarChart2, Settings, Database, Users, LifeBuoy, ListChecks, LogOut,
  ChevronDown,
} from 'lucide-react';
import clsx from 'clsx';
import { getSession, isPlatformUser, type Session } from '@/lib/session';

const staffNav = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/dashboard/clients', label: 'Clients', icon: Building2 },
  { href: '/dashboard/calls', label: 'Calls', icon: Phone },
  { href: '/dashboard/bookings', label: 'Bookings', icon: Calendar },
  { href: '/dashboard/analytics', label: 'Analytics', icon: BarChart2 },
  { href: '/dashboard/crm', label: 'CRM', icon: Database },
  { href: '/dashboard/users', label: 'Users', icon: Users },
  { href: '/dashboard/support', label: 'Support', icon: LifeBuoy },
  { href: '/dashboard/settings', label: 'Settings', icon: Settings },
];

const clientNav = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/dashboard/onboarding', label: 'Onboarding', icon: ListChecks },
  { href: '/dashboard/stats', label: 'Performance', icon: BarChart2 },
  { href: '/dashboard/support', label: 'Support', icon: LifeBuoy },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => setSession(getSession()), []);
  const nav = session === undefined ? [] : isPlatformUser(session) ? staffNav : clientNav;

  const handleLogout = () => {
    localStorage.removeItem('gravvia_token');
    document.cookie = 'gravvia_token=; max-age=0; path=/';
    window.location.href = '/login';
  };

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  return (
    <nav className="w-64 bg-white border-r border-gray-200 flex flex-col min-h-screen shadow-sm">
      {/* Logo Section */}
      <div className="px-6 py-6 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-primary-600 to-primary-700 rounded-lg flex items-center justify-center">
            <span className="font-heading font-bold text-white text-lg">GE</span>
          </div>
          <div>
            <p className="font-heading font-semibold text-gray-900 leading-tight">Gravvia Engage</p>
            <p className="text-xs text-gray-500">Platform</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <ul className="flex-1 py-6 space-y-1 px-3 overflow-y-auto">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          return (
            <li key={href}>
              <Link
                href={href}
                className={clsx(
                  'flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer',
                  active
                    ? 'bg-primary-50 text-primary-700 shadow-sm border border-primary-200'
                    : 'text-gray-600 hover:bg-gray-50 border border-transparent'
                )}
              >
                <Icon className={clsx('w-5 h-5 flex-shrink-0', active ? 'text-primary-600' : 'text-gray-400')} />
                <span className="flex-1">{label}</span>
                {active && <div className="w-1.5 h-1.5 bg-primary-600 rounded-full flex-shrink-0" />}
              </Link>
            </li>
          );
        })}
      </ul>

      {/* Divider */}
      <div className="border-t border-gray-100" />

      {/* User Section */}
      <div className="p-4">
        <button
          onClick={handleLogout}
          className={clsx(
            'flex items-center gap-3 px-4 py-3 w-full rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer',
            'text-gray-600 hover:bg-red-50 hover:text-red-700 border border-transparent hover:border-red-200'
          )}
        >
          <LogOut className="w-5 h-5 flex-shrink-0" />
          <span className="flex-1 text-left">Sign Out</span>
        </button>
      </div>
    </nav>
  );
}
