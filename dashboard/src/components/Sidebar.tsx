'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Building2, Phone, Calendar,
  BarChart2, Settings, Database, Users, LogOut,
} from 'lucide-react';
import clsx from 'clsx';

const nav = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/dashboard/clients', label: 'Clients', icon: Building2 },
  { href: '/dashboard/calls', label: 'Calls', icon: Phone },
  { href: '/dashboard/bookings', label: 'Bookings', icon: Calendar },
  { href: '/dashboard/analytics', label: 'Analytics', icon: BarChart2 },
  { href: '/dashboard/crm', label: 'CRM', icon: Database },
  { href: '/dashboard/users', label: 'Users', icon: Users },
  { href: '/dashboard/settings', label: 'Settings', icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();

  const handleLogout = () => {
    localStorage.removeItem('gravvia_token');
    document.cookie = 'gravvia_token=; max-age=0; path=/';
    window.location.href = '/login';
  };

  return (
    <nav className="w-60 bg-white border-r border-gray-200 flex flex-col min-h-screen">
      <div className="px-6 py-5 border-b border-gray-100">
        <span className="font-bold text-lg text-brand-600">Gravvia Engage</span>
      </div>
      <ul className="flex-1 py-4 space-y-1 px-3">
        {nav.map(({ href, label, icon: Icon }) => (
          <li key={href}>
            <Link
              href={href}
              className={clsx(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition',
                pathname === href || pathname.startsWith(href + '/')
                  ? 'bg-brand-50 text-brand-600'
                  : 'text-gray-600 hover:bg-gray-100'
              )}
            >
              <Icon className="w-4 h-4" />
              {label}
            </Link>
          </li>
        ))}
      </ul>
      <div className="p-3 border-t border-gray-100">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2 w-full rounded-lg text-sm text-gray-500 hover:bg-gray-100 transition"
        >
          <LogOut className="w-4 h-4" />
          Sign Out
        </button>
      </div>
    </nav>
  );
}
