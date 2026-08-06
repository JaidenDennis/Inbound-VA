'use client';

import { useEffect, useState } from 'react';
import { StatusPill } from '@/components/StatusPill';
import { CheckCircle2 } from 'lucide-react';

/**
 * Time remaining against the first-response deadline.
 *
 * State is carried by icon and words — "Breached", "Due in 12m" — not by colour.
 * A red row alone is invisible to a colour-blind reader and meaningless in a
 * greyscale screenshot, and this is precisely the field people screenshot.
 *
 * `now` lives in state rather than being read during render: reading the clock
 * mid-render is impure, and it also meant the countdown froze at whatever the
 * first paint said. A queue left open on a wall display would have shown "due in
 * 40m" indefinitely. The interval keeps it honest.
 */
const TICK_MS = 30_000;

export function SlaCountdown({
  dueAt,
  firstResponseAt,
  breachedAt,
  resolvedAt,
}: {
  dueAt: string | null;
  firstResponseAt: string | null;
  breachedAt?: string | null;
  resolvedAt?: string | null;
}) {
  // null until mounted, so the server and first client render agree.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  if (resolvedAt) return <StatusPill tone="success" label="Closed" icon={CheckCircle2} />;
  if (firstResponseAt) return <StatusPill tone="success" label="Responded" icon={CheckCircle2} />;
  if (breachedAt) return <StatusPill tone="critical" label="Breached" />;
  if (!dueAt) return <StatusPill tone="neutral" label="No target" />;
  if (now === null) return <StatusPill tone="pending" label="Open" />;

  const remainingMs = new Date(dueAt).getTime() - now;
  if (remainingMs <= 0) return <StatusPill tone="critical" label="Breached" />;

  const minutes = Math.floor(remainingMs / 60000);
  const label =
    minutes < 60
      ? `Due in ${minutes}m`
      : minutes < 60 * 24
        ? `Due in ${Math.floor(minutes / 60)}h`
        : `Due in ${Math.floor(minutes / (60 * 24))}d`;

  // Inside the last hour is the point where someone should act now.
  return <StatusPill tone={minutes <= 60 ? 'warning' : 'pending'} label={label} />;
}
