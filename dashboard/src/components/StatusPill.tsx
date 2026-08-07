'use client';

import {
  AlertOctagon, AlertTriangle, Info, CheckCircle2, Clock, RefreshCw, XCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { LampStatus, type LampLevel } from './StatusLamp';
import { severityTerm } from '@/lib/vocabulary';

/**
 * Status shown as lamp + icon + word, never colour alone.
 *
 * Severity and breach state are exactly the cases that get built as "make the
 * row red", which is invisible to a colour-blind reader and to anyone printing
 * or screenshotting in greyscale. The icon and the word carry the meaning; the
 * lamp is reinforcement.
 *
 * The API is unchanged from the previous enterprise-blue system so every route
 * that consumes it keeps working; only the rendering moved onto the lamps.
 * Tones that are genuinely status light a lamp. Tones that are merely
 * informational (info, neutral, pending) stay achromatic, because spending
 * chroma on them would dilute the only signal that matters.
 */

export type Tone = 'critical' | 'error' | 'warning' | 'info' | 'success' | 'neutral' | 'pending';

const TONE_MAP: Record<Tone, { level: LampLevel | null; icon: LucideIcon; live?: boolean }> = {
  critical: { level: 'bad', icon: AlertOctagon, live: true },
  error: { level: 'bad', icon: XCircle },
  warning: { level: 'fair', icon: AlertTriangle },
  success: { level: 'good', icon: CheckCircle2 },
  info: { level: null, icon: Info },
  pending: { level: null, icon: Clock },
  neutral: { level: null, icon: Info },
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
  const spec = TONE_MAP[tone];
  const Icon = IconOverride ?? spec.icon;

  // Informational tones: no lamp, no chroma — a quiet seated chip.
  if (spec.level === null) {
    return (
      <span
        className={clsx(
          'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border',
          'border-panel-200 bg-panel-100 px-2.5 py-1 text-xs font-medium text-panel-600',
          className
        )}
      >
        <Icon className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
        {label}
      </span>
    );
  }

  return (
    <LampStatus
      level={spec.level}
      label={label}
      icon={Icon}
      live={spec.live}
      seated
      className={className}
    />
  );
}

const SEVERITY_TONES: Record<string, Tone> = {
  fatal: 'critical',
  error: 'error',
  warn: 'warning',
};

export function SeverityPill({ severity }: { severity: string }) {
  // The label comes from the shared glossary, never the raw enum.
  return <StatusPill tone={SEVERITY_TONES[severity] ?? 'neutral'} label={severityTerm(severity).label} />;
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
