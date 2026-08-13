'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import clsx from 'clsx';
import { api, errorMessage } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { ClientPicker, ChooseClientPrompt, useClientScope } from '@/components/ClientPicker';
import { useSession } from '@/lib/SessionProvider';

/**
 * The month a business actually runs on.
 *
 * Appointments arrive here from whichever CRM the client uses — GoHighLevel
 * today, others through the same adapter — via the booking service, so this
 * reads the same `/booking/appointments` the Bookings list does. It is a second
 * *view* of one source, not a second source: a calendar that could disagree
 * with the list would be worse than no calendar.
 *
 * Bookings stays as the chronological list. This answers the different question
 * an owner asks, which is what a week looks like, and where the gaps are.
 */

interface Appointment {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  status: string;
  timezone: string;
  service_type: string | null;
}

/** Cancelled appointments still occupy a slot in the reader's memory. */
const STATUS_STYLE: Record<string, string> = {
  confirmed: 'border-l-2 border-action bg-action-50 text-text',
  pending: 'border-l-2 border-lamp-fair bg-lamp-fair-wash text-lamp-fair-ink',
  cancelled: 'border-l-2 border-rule bg-surface-inset text-text-muted line-through',
  completed: 'border-l-2 border-lamp-good bg-lamp-good-wash text-lamp-good-ink',
};

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function CalendarBody() {
  const { isPlatform } = useSession();
  const { clientId, needsChoice } = useClientScope();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Date | null>(null);

  // State is set only after the request settles, never synchronously in the
  // effect body — a sync setState here triggers a cascading render, and the
  // cancelled flag stops a slow response for a previous client overwriting a
  // faster one for the client the user has since switched to.
  useEffect(() => {
    let cancelled = false;

    if (!clientId) {
      queueMicrotask(() => {
        if (cancelled) return;
        setAppointments([]);
        setLoading(false);
      });
      return () => {
        cancelled = true;
      };
    }

    api
      .get('/booking/appointments', { params: { clientId } })
      .then((r) => {
        if (cancelled) return;
        setAppointments(r.data.data ?? []);
        setError('');
      })
      .catch((e) => {
        if (cancelled) return;
        setAppointments([]);
        setError(errorMessage(e, 'Could not load the calendar'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [clientId]);

  // Monday-first, and always six rows: a grid that changes height as you page
  // through months makes the controls move under the cursor.
  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [month]);

  const byDay = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const a of appointments) {
      // A malformed timestamp must not take the whole calendar down with it.
      let day: string;
      try {
        day = format(parseISO(a.start_time), 'yyyy-MM-dd');
      } catch {
        continue;
      }
      const list = map.get(day);
      if (list) list.push(a);
      else map.set(day, [a]);
    }
    for (const list of map.values()) {
      list.sort((x, y) => x.start_time.localeCompare(y.start_time));
    }
    return map;
  }, [appointments]);

  const selectedItems = selected
    ? byDay.get(format(selected, 'yyyy-MM-dd')) ?? []
    : [];

  if (needsChoice) {
    return (
      <div>
        <PageHeader
          eyebrow="Platform console"
          title="Calendar"
          description="Appointments as they sit in the month."
          action={<ClientPicker />}
        />
        <ChooseClientPrompt what="The calendar" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow={isPlatform ? 'Platform console' : 'Schedule'}
        title="Calendar"
        description="Every appointment your agent booked, as it sits in the month. Synced from your CRM."
        action={isPlatform ? <ClientPicker /> : undefined}
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => setMonth((m) => addMonths(m, -1))}
            className="flex h-9 w-9 cursor-pointer items-center justify-center border border-rule text-text-muted transition-colors hover:border-action hover:text-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => setMonth((m) => addMonths(m, 1))}
            className="flex h-9 w-9 cursor-pointer items-center justify-center border border-rule text-text-muted transition-colors hover:border-action hover:text-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
          <h2 className="ml-3 font-heading text-xl font-medium text-text" aria-live="polite">
            {format(month, 'MMMM yyyy')}
          </h2>
        </div>

        <button
          type="button"
          onClick={() => setMonth(startOfMonth(new Date()))}
          className="cursor-pointer border border-rule px-3 py-2 font-mono text-2xs uppercase tracking-[0.16em] text-text-muted transition-colors hover:border-action hover:text-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
        >
          Today
        </button>
      </div>

      {error && (
        <p role="alert" className="mb-4 border border-lamp-bad-rim bg-lamp-bad-wash px-3 py-2.5 text-xs text-lamp-bad-ink">
          {error}
        </p>
      )}

      {loading ? (
        <div className="h-[32rem] animate-pulse bg-panel-100" />
      ) : (
        <div className="border border-edge bg-surface-raised">
          <div className="grid grid-cols-7 border-b border-rule">
            {WEEKDAYS.map((d) => (
              <div
                key={d}
                className="px-2 py-2.5 text-center font-mono text-2xs uppercase tracking-[0.16em] text-text-muted"
              >
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {days.map((day, i) => {
              const items = byDay.get(format(day, 'yyyy-MM-dd')) ?? [];
              const outside = !isSameMonth(day, month);
              const isSelected = selected && isSameDay(day, selected);

              return (
                <button
                  type="button"
                  key={day.toISOString()}
                  onClick={() => setSelected(isSelected ? null : day)}
                  aria-label={`${format(day, 'd MMMM yyyy')}, ${items.length} appointment${items.length === 1 ? '' : 's'}`}
                  aria-pressed={!!isSelected}
                  className={clsx(
                    'min-h-[6.5rem] cursor-pointer border-hairline p-1.5 text-left align-top transition-colors duration-120',
                    // Only right and bottom, so the grid draws one hairline
                    // between cells rather than two stacked.
                    i % 7 !== 6 && 'border-r',
                    i < days.length - 7 && 'border-b',
                    outside ? 'bg-surface-inset' : 'hover:bg-action-50',
                    isSelected && 'bg-action-50 ring-1 ring-inset ring-action',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-action'
                  )}
                >
                  <span
                    data-numeric
                    className={clsx(
                      'inline-flex h-6 min-w-6 items-center justify-center px-1 text-xs',
                      isToday(day) && 'bg-action font-medium text-[rgb(var(--action-contrast-rgb))]',
                      !isToday(day) && outside && 'text-text-faint',
                      !isToday(day) && !outside && 'text-text-secondary'
                    )}
                  >
                    {format(day, 'd')}
                  </span>

                  <span className="mt-1 block space-y-0.5">
                    {items.slice(0, 3).map((a) => (
                      <span
                        key={a.id}
                        title={`${format(parseISO(a.start_time), 'HH:mm')} · ${a.title}`}
                        className={clsx(
                          'block truncate px-1.5 py-0.5 text-2xs',
                          STATUS_STYLE[a.status] ?? 'border-l-2 border-rule bg-surface-inset text-text-muted'
                        )}
                      >
                        <span data-numeric className="font-mono">
                          {format(parseISO(a.start_time), 'HH:mm')}
                        </span>{' '}
                        {a.title}
                      </span>
                    ))}
                    {/* An overflowing day must say how many it is hiding, or the
                        calendar quietly under-reports a busy morning. */}
                    {items.length > 3 && (
                      <span className="block px-1.5 font-mono text-2xs text-text-muted">
                        +{items.length - 3} more
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {selected && (
        <div className="mt-5 border border-hairline bg-surface-raised">
          <div className="flex items-baseline justify-between gap-3 border-b border-hairline px-4 py-3">
            <h3 className="font-heading text-base font-medium text-text">
              {format(selected, 'EEEE d MMMM')}
            </h3>
            <span className="font-mono text-2xs uppercase tracking-[0.16em] text-text-muted">
              {selectedItems.length} appointment{selectedItems.length === 1 ? '' : 's'}
            </span>
          </div>

          {selectedItems.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <CalendarDays className="mx-auto mb-2 h-5 w-5 text-text-faint" aria-hidden strokeWidth={1.5} />
              <p className="text-sm text-text-muted">Nothing booked this day.</p>
            </div>
          ) : (
            <ul>
              {selectedItems.map((a, i) => (
                <li
                  key={a.id}
                  className={clsx('flex items-baseline gap-4 px-4 py-2.5', i > 0 && 'border-t border-hairline')}
                >
                  <span data-numeric className="font-mono text-2xs text-text-muted">
                    {format(parseISO(a.start_time), 'HH:mm')}–{format(parseISO(a.end_time), 'HH:mm')}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-text">{a.title}</span>
                  {a.service_type && (
                    <span className="hidden truncate text-xs text-text-muted sm:block">{a.service_type}</span>
                  )}
                  <span className="font-mono text-2xs uppercase tracking-[0.14em] text-text-muted">
                    {a.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default function CalendarPage() {
  // useClientScope and ClientPicker read search params.
  return (
    <Suspense fallback={<div className="h-96 animate-pulse bg-panel-100" />}>
      <CalendarBody />
    </Suspense>
  );
}
