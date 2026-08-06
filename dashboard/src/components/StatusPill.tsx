'use client';

import {
  AlertOctagon, AlertTriangle, Info, CheckCircle2, Clock, RefreshCw, XCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import clsx from 'clsx';

/**
 * Status shown as icon + text, never colour alone.
 *
 * Severity and breach state are exactly the cases that get built as "make the
 * row red" — which is invisible to a colour-blind reader and to anyone printing
 * or screenshotting in greyscale. The icon and the word carry the meaning; the
 * colour is reinforcement.
 */

export type Tone = 'critical' | 'error' | 'warning' | 'info' | 'success' | 'neutral' | 'pending';

const TONE_STYLES: Record<Tone, { className: string; icon: LucideIcon }> = {
  critical: { className: 'bg-red-100 text-red-800 border-red-300', icon: AlertOctagon },
  error: { className: 'bg-red-50 text-red-700 border-red-200', icon: XCircle },
  warning: { className: 'bg-amber-50 text-amber-800 border-amber-200', icon: AlertTriangle },
  info: { className: 'bg-blue-50 text-blue-700 border-blue-200', icon: Info },
  success: { className: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: CheckCircle2 },
  pending: { className: 'bg-gray-50 text-gray-700 border-gray-200', icon: Clock },
  neutral: { className: 'bg-gray-100 text-gray-700 border-gray-200', icon: Info },
};

export function StatusPill({
  tone = 'neutral',
  label,
  icon: IconOverride,
  className,
}: {
  tone?: Tone;
  label: string;
  icon?: LucideIcon;
  className?: string;
}) {
  const { className: toneCls, icon } = TONE_STYLES[tone];
  const Icon = IconOverride ?? icon;
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium',
        toneCls,
        className
      )}
    >
      <Icon className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
      {label}
    </span>
  );
}

const SEVERITY_TONES: Record<string, Tone> = {
  fatal: 'critical',
  error: 'error',
  warn: 'warning',
};

export function SeverityPill({ severity }: { severity: string }) {
  return <StatusPill tone={SEVERITY_TONES[severity] ?? 'neutral'} label={severity} />;
}

const SYNC_TONES: Record<string, { tone: Tone; label: string; icon?: LucideIcon }> = {
  synced: { tone: 'success', label: 'Live' },
  pending: { tone: 'pending', label: 'Syncing', icon: RefreshCw },
  failed: { tone: 'error', label: 'Sync failed' },
  never: { tone: 'neutral', label: 'Not provisioned' },
};

export function SyncBadge({ state }: { state: string | null | undefined }) {
  const spec = SYNC_TONES[state ?? 'never'] ?? SYNC_TONES.never;
  return <StatusPill tone={spec.tone} label={spec.label} icon={spec.icon} />;
}
