'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import {
  Mail, Lock, Eye, EyeOff, AlertCircle, ArrowRight,
  ShieldCheck, PhoneCall, CalendarCheck, Building2,
} from 'lucide-react';

const highlights = [
  { icon: PhoneCall, title: 'AI handles every inbound call', body: 'Answer, qualify, and route 24/7 — no missed revenue.' },
  { icon: CalendarCheck, title: 'Booking on autopilot', body: 'Appointments scheduled directly into your calendar.' },
  { icon: Building2, title: 'Synced to your CRM', body: 'Contacts, notes, and transcripts pushed automatically.' },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { email, password });
      localStorage.setItem('gravvia_token', data.token);
      document.cookie = `gravvia_token=${data.token}; path=/; max-age=604800`;
      router.push('/dashboard');
    } catch {
      setError('Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-white">
      {/* Brand panel */}
      <aside className="relative hidden lg:flex lg:w-[46%] xl:w-1/2 flex-col justify-between overflow-hidden bg-gradient-to-br from-navy-900 via-navy-800 to-primary-900 p-12 text-white">
        <div className="absolute inset-0 bg-grid opacity-70" aria-hidden />
        <div
          className="absolute -top-24 -right-24 h-96 w-96 rounded-full bg-primary-500/20 blur-3xl"
          aria-hidden
        />
        <div
          className="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-secondary-500/10 blur-3xl"
          aria-hidden
        />

        {/* Logo */}
        <div className="relative flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20 backdrop-blur">
            <span className="font-heading text-lg font-bold tracking-tight">GE</span>
          </div>
          <div className="leading-tight">
            <p className="font-heading text-lg font-semibold">Gravvia Engage</p>
            <p className="text-xs text-white/60">AI Voice Operations</p>
          </div>
        </div>

        {/* Value proposition */}
        <div className="relative max-w-md">
          <h2 className="font-heading text-3xl font-bold leading-tight xl:text-4xl">
            The voice layer that runs your front desk.
          </h2>
          <p className="mt-4 text-white/70">
            Retell talks. The backend decides. Every call captured, qualified, and synced —
            built for teams that can&apos;t afford to miss a customer.
          </p>

          <ul className="mt-10 space-y-5">
            {highlights.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-4">
                <span className="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/15">
                  <Icon className="h-5 w-5 text-secondary-200" />
                </span>
                <div>
                  <p className="font-semibold text-white">{title}</p>
                  <p className="text-sm text-white/60">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Trust signal */}
        <div className="relative flex items-center gap-2 text-sm text-white/60">
          <ShieldCheck className="h-4 w-4 text-secondary-300" />
          Enterprise-grade security · SOC 2-aligned · Encrypted at rest
        </div>
      </aside>

      {/* Form panel */}
      <main className="flex w-full flex-1 items-center justify-center px-6 py-12 sm:px-12">
        <div className="w-full max-w-md animate-rise">
          {/* Mobile logo */}
          <div className="mb-10 flex items-center gap-3 lg:hidden">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-navy-800 to-primary-700 text-white">
              <span className="font-heading text-lg font-bold">GE</span>
            </div>
            <p className="font-heading text-lg font-semibold text-gray-900">Gravvia Engage</p>
          </div>

          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Welcome back</h1>
            <p className="mt-2 text-gray-500">Sign in to your operations dashboard.</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-gray-700">
                Work email
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white py-2.5 pl-11 pr-3 text-sm text-gray-900 placeholder:text-gray-400 transition-colors duration-200 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
                />
              </div>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                  Password
                </label>
                <a href="#" className="text-sm font-medium text-primary-600 transition-colors hover:text-primary-700">
                  Forgot password?
                </a>
              </div>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white py-2.5 pl-11 pr-11 text-sm text-gray-900 placeholder:text-gray-400 transition-colors duration-200 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="group flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-primary-600 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-primary-700 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary-500/40 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  Signing in…
                </>
              ) : (
                <>
                  Sign in
                  <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                </>
              )}
            </button>
          </form>

          <p className="mt-8 text-center text-sm text-gray-500">
            Need access?{' '}
            <a href="mailto:support@gravvia.com" className="font-medium text-primary-600 transition-colors hover:text-primary-700">
              Contact your administrator
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}
