'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Eye, EyeOff, AlertCircle, ArrowRight } from 'lucide-react';
import { StatusLamp } from '@/components/StatusLamp';

/**
 * The gate to the console, built in the console's own language.
 *
 * The left panel states the product's actual architecture — Retell talks, the
 * backend decides, the database remembers, the CRM displays — as a signal chain
 * with a pulse running down it. This is a diagram of a real mechanism, not a
 * status readout: nothing here reports live state, because nothing is
 * authenticated yet, and nothing claims a customer, a certification, or a
 * number the repository cannot substantiate.
 */

const chain = [
  { stage: 'Retell', line: 'talks', detail: 'The voice layer answers, listens, and speaks.' },
  { stage: 'Backend', line: 'decides', detail: 'Every rule, workflow, and routing choice lives here.' },
  { stage: 'Database', line: 'remembers', detail: 'Calls, transcripts, bookings, and sync state persist.' },
  { stage: 'CRM', line: 'displays', detail: 'Contacts and outcomes land where your team works.' },
];

function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden focusable="false">
      <circle cx="16" cy="16" r="11.5" fill="none" stroke="currentColor" strokeWidth="2.25"
        strokeLinecap="round" strokeDasharray="54 18" transform="rotate(-52 16 16)" />
      <circle cx="16" cy="16" r="4.25" fill="currentColor" />
    </svg>
  );
}

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
      const secure = window.location.protocol === 'https:' ? '; Secure' : '';
      document.cookie = `gravvia_token=${data.token}; path=/; max-age=604800; SameSite=Lax${secure}`;
      router.push('/dashboard');
    } catch {
      setError('Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] bg-surface-raised">
      {/* ---- Mechanism panel ---- */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-surface-dark px-12 py-11 text-white lg:flex lg:w-[46%] xl:w-[48%]">
        <div className="flex items-center gap-3">
          <Mark className="h-9 w-9 text-white" />
          <div className="leading-tight">
            <p className="font-heading text-base font-semibold">Gravvia Engage</p>
            <p className="text-2xs uppercase tracking-[0.09em] text-panel-400">AI Voice Operations</p>
          </div>
        </div>

        <div className="max-w-md">
          <h2 className="font-heading text-3xl font-semibold leading-[1.14] tracking-[-0.022em] text-white xl:text-4xl">
            The voice answers.
            <br />
            The system decides.
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-panel-300">
            Business logic never lives in the phone line. It lives here, where you can
            read it, change it, and hold it to account.
          </p>

          {/* The signal chain. The pulse is staggered down the nodes so the
              sequence itself reads as propagation, which is the one thing this
              panel needs to communicate. */}
          <ol className="relative mt-10 space-y-6">
            <span
              aria-hidden
              className="absolute left-[5px] top-2 h-[calc(100%-1rem)] w-px bg-gradient-to-b from-white/25 via-white/12 to-transparent"
            />
            {chain.map(({ stage, line, detail }, i) => (
              <li key={stage} className="relative flex gap-4">
                <span className="relative z-10 mt-1.5 flex-shrink-0">
                  <StatusLamp level="good" size="sm" live delayMs={i * 300} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm">
                    <span className="font-semibold text-white">{stage}</span>
                    <span className="text-panel-400"> {line}</span>
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-panel-400">{detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <p className="text-xs text-panel-500">
          One console. Every client, every call, every sync.
        </p>
      </aside>

      {/* ---- Form ---- */}
      <main className="flex w-full flex-1 items-center justify-center px-5 py-12 sm:px-12">
        <div className="w-full max-w-[23rem] animate-rise">
          <div className="mb-9 flex items-center gap-3 lg:hidden">
            <Mark className="h-8 w-8 text-ink-800" />
            <p className="font-heading text-base font-semibold text-ink-900">Gravvia Engage</p>
          </div>

          <div className="mb-7">
            <h1 className="font-heading text-2xl font-semibold tracking-[-0.02em] text-ink-900">
              Sign in
            </h1>
            <p className="mt-1.5 text-sm text-panel-600">
              Operations console access.
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4" noValidate>
            <div>
              <label htmlFor="email" className="mb-1.5 block text-xs font-semibold text-ink-700">
                Work email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                autoFocus
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={!!error}
                aria-describedby={error ? 'signin-error' : undefined}
                className="w-full border border-panel-300 bg-surface-raised px-3 py-2.5 text-sm text-ink-900 transition-colors duration-150 placeholder:text-panel-400 hover:border-panel-400 focus:border-signal-600 focus:outline-none focus:ring-2 focus:ring-signal-600/25"
              />
            </div>

            <div>
              <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <label htmlFor="password" className="block text-xs font-semibold text-ink-700">
                  Password
                </label>
                <a
                  href="mailto:support@gravvia.com?subject=Password%20reset"
                  className="text-xs font-medium text-signal-700 underline decoration-signal-300 transition-colors hover:text-signal-800 hover:decoration-signal-600"
                >
                  Forgot password?
                </a>
              </div>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={!!error}
                  aria-describedby={error ? 'signin-error' : undefined}
                  className="w-full border border-panel-300 bg-surface-raised py-2.5 pl-3 pr-11 text-sm text-ink-900 transition-colors duration-150 placeholder:text-panel-400 hover:border-panel-400 focus:border-signal-600 focus:outline-none focus:ring-2 focus:ring-signal-600/25"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center text-panel-500 transition-colors hover:bg-panel-100 hover:text-ink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                </button>
              </div>
            </div>

            {error && (
              <p
                id="signin-error"
                role="alert"
                className="flex items-start gap-2 border border-lamp-bad-rim bg-lamp-bad-wash px-3 py-2.5 text-xs leading-relaxed text-lamp-bad-ink"
              >
                <AlertCircle className="mt-px h-4 w-4 flex-shrink-0" aria-hidden />
                <span>
                  That email and password do not match. Check both, or ask an
                  administrator to reset your access.
                </span>
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="group flex w-full cursor-pointer items-center justify-center gap-2 bg-action py-2.5 text-sm font-semibold text-white transition-all duration-150 ease-out hover:bg-action-800 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-panel-400"
            >
              {loading ? (
                <>
                  <span
                    aria-hidden
                    className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/35 border-t-white"
                  />
                  Signing in
                </>
              ) : (
                <>
                  Sign in
                  <ArrowRight
                    className="h-4 w-4 transition-transform duration-200 ease-out group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </>
              )}
            </button>
          </form>

          <p className="mt-7 border-t border-panel-200 pt-5 text-xs text-panel-600">
            Access is provisioned by your administrator.{' '}
            <a
              href="mailto:support@gravvia.com"
              className="font-medium text-signal-700 underline decoration-signal-300 transition-colors hover:text-signal-800 hover:decoration-signal-600"
            >
              Request an account
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}
