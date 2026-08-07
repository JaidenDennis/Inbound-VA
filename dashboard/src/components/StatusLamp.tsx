'use client';

import clsx from 'clsx';
import {
  AlertOctagon, AlertTriangle, CheckCircle2, Circle, Clock,
  Info, RefreshCw, XCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { severityTerm, REVIEW_STATE } from '@/lib/vocabulary';

/**
 * The supervisory lamp.
 *
 * Green is good, amber is fair, red is bad — the whole product's chroma budget,
 * spent here and nowhere else. Because interactive affordance is achromatic, a
 * lit lamp on this surface always means state and never means "clickable".
 *
 * Colour is reinforcement, never the carrier. A lamp that appears without a
 * visible word carries an `sr-only` one, so the meaning survives greyscale
 * printing, a screenshot pasted into a ticket, and every form of colour
 * blindness. That is why the lens is drawn with a highlight and a rim: the
 * three states differ in internal structure and brightness, not only hue.
 */

export type LampLevel = 'good' | 'fair' | 'bad' | 'off';

const LENS: Record<LampLevel, { core: string; rim: string; glow: string; word: string }> = {
  good: { core: '#1FA35F', rim: '#0E7042', glow: 'rgba(31, 163, 95, 0.30)', word: 'Good' },
  fair: { core: '#E0921A', rim: '#8A5600', glow: 'rgba(224, 146, 26, 0.32)', word: 'Fair' },
  bad:  { core: '#DC3B30', rim: '#A81E17', glow: 'rgba(220, 59, 48, 0.34)',  word: 'Bad'  },
  off:  { core: '#C2C8C8', rim: '#939D9D', glow: 'rgba(0, 0, 0, 0)',          word: 'No signal' },
};

const SIZES = { sm: 8, md: 11, lg: 16 } as const;

export function StatusLamp({
  level,
  size = 'md',
  live = false,
  delayMs = 0,
  label,
  className,
}: {
  level: LampLevel;
  size?: keyof typeof SIZES;
  /** Breathes. Reserve for a state that is actively wrong right now. */
  live?: boolean;
  /** Offsets the live breath, so a row of lamps reads as a travelling pulse. */
  delayMs?: number;
  /** Accessible name. Required when no visible word sits beside the lamp. */
  label?: string;
  className?: string;
}) {
  const lens = LENS[level];
  const px = SIZES[size];
  const unlit = level === 'off';

  return (
    <span className={clsx('relative inline-flex flex-shrink-0', className)} style={{ width: px, height: px }}>
      {/* Halo. Present only on a lit lamp, and sized so it never becomes a glow
          effect — it is the light the lens throws onto the panel around it. */}
      {!unlit && (
        <span
          aria-hidden
          className={clsx('absolute rounded-full', live && 'animate-lamp-live')}
          style={{
            inset: -Math.round(px * 0.45),
            background: `radial-gradient(circle, ${lens.glow} 0%, transparent 70%)`,
            animationDelay: delayMs ? `${delayMs}ms` : undefined,
          }}
        />
      )}
      {/* The lens: rim, body, and a specular highlight at the top-left, so the
          three states read apart by structure as well as by hue. */}
      <span
        aria-hidden
        className="relative rounded-full"
        style={{
          width: px,
          height: px,
          background: unlit
            ? `radial-gradient(circle at 32% 28%, #EDEFEF 0%, ${lens.core} 62%)`
            : `radial-gradient(circle at 32% 28%, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.28) 22%, ${lens.core} 58%)`,
          boxShadow: `inset 0 0 0 1px ${lens.rim}`,
        }}
      />
      {label && <span className="sr-only">{label}</span>}
    </span>
  );
}

/* ---------------------------------------------------------------------------
   Lamp + word. The default way status appears in a row.
   --------------------------------------------------------------------------- */

const TEXT: Record<LampLevel, string> = {
  good: 'text-lamp-good-ink',
  fair: 'text-lamp-fair-ink',
  bad: 'text-lamp-bad-ink',
  off: 'text-panel-500',
};

const SEATED: Record<LampLevel, string> = {
  good: 'bg-lamp-good-wash border-lamp-good-rim',
  fair: 'bg-lamp-fair-wash border-lamp-fair-rim',
  bad: 'bg-lamp-bad-wash border-lamp-bad-rim',
  off: 'bg-panel-100 border-panel-200',
};

export function LampStatus({
  level,
  label,
  icon: Icon,
  live = false,
  seated = false,
  className,
}: {
  level: LampLevel;
  label: string;
  icon?: LucideIcon;
  live?: boolean;
  /** Seats the pair in a tinted chip. Use in dense tables; skip in prose. */
  seated?: boolean;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-2 whitespace-nowrap text-xs font-medium',
        TEXT[level],
        seated && ['rounded-full border px-2.5 py-1', SEATED[level]],
        className
      )}
    >
      <StatusLamp level={level} size="sm" live={live} />
      {Icon && <Icon className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />}
      {label}
    </span>
  );
}

/* ---------------------------------------------------------------------------
   Mapping the product's existing vocabularies onto the three lamps.
   These vocabularies are fixed by the backend; only their presentation changes.
   --------------------------------------------------------------------------- */

/**
 * Lamp level and icon per severity. The *words* come from the shared glossary
 * (lib/vocabulary), so `warn` reads as "Warning" here and everywhere else, and
 * an unrecognised code is humanised rather than leaked raw.
 */
const SEVERITY_LEVEL: Record<string, { level: LampLevel; icon: LucideIcon; live?: boolean }> = {
  fatal: { level: 'bad', icon: AlertOctagon, live: true },
  error: { level: 'bad', icon: XCircle },
  warn: { level: 'fair', icon: AlertTriangle },
  info: { level: 'good', icon: Info },
};

export function SeverityLamp({ severity, seated = true }: { severity: string; seated?: boolean }) {
  const spec = SEVERITY_LEVEL[severity] ?? { level: 'off' as LampLevel, icon: Circle };
  return (
    <LampStatus
      level={spec.level}
      label={severityTerm(severity).label}
      icon={spec.icon}
      live={spec.live}
      seated={seated}
    />
  );
}

const SYNC: Record<string, { level: LampLevel; label: string; icon: LucideIcon }> = {
  synced: { level: 'good', label: 'Live', icon: CheckCircle2 },
  pending: { level: 'fair', label: 'Syncing', icon: RefreshCw },
  failed: { level: 'bad', label: 'Sync failed', icon: XCircle },
  never: { level: 'off', label: 'Not provisioned', icon: Circle },
};

export function SyncLamp({ state, seated = true }: { state: string | null | undefined; seated?: boolean }) {
  const spec = SYNC[state ?? 'never'] ?? SYNC.never;
  return <LampStatus level={spec.level} label={spec.label} icon={spec.icon} seated={seated} />;
}

export function ReviewLamp({ reviewedAt }: { reviewedAt: string | null }) {
  return reviewedAt
    ? <LampStatus level="good" label={REVIEW_STATE.reviewed.label} icon={CheckCircle2} seated />
    : <LampStatus level="fair" label={REVIEW_STATE.unreviewed.label} icon={Clock} seated />;
}
