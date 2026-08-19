import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The booking rules a client can edit must actually govern scheduling.
 *
 * `advance_booking_hours`, `max_advance_booking_days` and `buffer_minutes` are
 * declared on BookingRules, editable in the dashboard, and were read by
 * nothing. internalAvailability consulted `working_hours` alone and generated
 * fixed 30-minute slots, so a 60-minute treatment was offered a 30-minute hole,
 * a caller could book five minutes from now, and turnover time between
 * appointments did not exist.
 *
 * These assert on the WINDOW the service asks the database for, not on a
 * hand-written answer, so the buffer has to reach the query rather than merely
 * being subtracted somewhere afterwards.
 */
const conflictWindows: Array<{ lt: string; gt: string }> = [];
let rules: Record<string, unknown> = {};
let services: Array<Record<string, unknown>> = [];

vi.mock('../db/index.js', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'client_settings') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: { booking_rules: rules, services } }),
            }),
          }),
        };
      }
      // appointments — record the window, report no conflicts.
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        not: () => q,
        neq: () => q,
        lt: (_c: string, v: string) => {
          (q as { _lt?: string })._lt = v;
          return q;
        },
        gt: (_c: string, v: string) => {
          conflictWindows.push({ lt: (q as { _lt?: string })._lt ?? '', gt: v });
          return Promise.resolve({ data: [] }) as never;
        },
      };
      return q;
    },
  },
}));

vi.mock('../events/index.js', () => ({ eventBus: { publish: vi.fn() } }));
vi.mock('../calendar/index.js', () => ({ getCalendarAdapter: vi.fn() }));
vi.mock('../queues/index.js', () => ({ crmSyncQueue: { add: vi.fn() } }));
vi.mock('../services/index.js', () => ({ crmConnectionService: { findActive: async () => null } }));

const { BookingService } = await import('../booking/booking.service.js');
const service = new BookingService();

/** A date far enough out that lead-time rules never trim it. */
function futureDate(daysAhead = 30): string {
  return new Date(Date.now() + daysAhead * 86_400_000).toISOString().slice(0, 10);
}

beforeEach(() => {
  conflictWindows.length = 0;
  services = [{ name: 'Botox', duration_minutes: 30 }, { name: 'Microneedling', duration_minutes: 60 }];
  rules = {
    working_hours: { monday: { open: '09:00', close: '17:00' }, tuesday: { open: '09:00', close: '17:00' },
      wednesday: { open: '09:00', close: '17:00' }, thursday: { open: '09:00', close: '17:00' },
      friday: { open: '09:00', close: '17:00' }, saturday: { open: '09:00', close: '17:00' },
      sunday: { open: '09:00', close: '17:00' } },
  };
});

describe('slot length follows the service', () => {
  it('offers a 60-minute slot for a 60-minute treatment', async () => {
    const slots = await service.getAvailability({
      clientId: 'c1', date: futureDate(), serviceType: 'Microneedling', timezone: 'UTC',
    });
    expect(slots.length).toBeGreaterThan(0);
    const minutes = (slots[0].end.getTime() - slots[0].start.getTime()) / 60_000;
    expect(minutes).toBe(60);
  });

  it('still uses 30 minutes when the service is unknown', async () => {
    const slots = await service.getAvailability({
      clientId: 'c1', date: futureDate(), serviceType: 'Nothing We Offer', timezone: 'UTC',
    });
    const minutes = (slots[0].end.getTime() - slots[0].start.getTime()) / 60_000;
    expect(minutes).toBe(30);
  });
});

describe('buffer_minutes keeps a gap after each appointment', () => {
  it('pads the conflict window on both sides so two bookings cannot touch', async () => {
    rules.buffer_minutes = 15;
    await service.getAvailability({ clientId: 'c1', date: futureDate(), serviceType: 'Botox', timezone: 'UTC' });

    expect(conflictWindows.length).toBeGreaterThan(0);
    const { lt, gt } = conflictWindows[0];
    // A trailing buffer on every appointment means any two must sit at least
    // `buffer` apart — which is exactly a symmetric padding of the overlap test.
    const span = (new Date(lt).getTime() - new Date(gt).getTime()) / 60_000;
    expect(span).toBe(30 + 15 * 2);
  });

  it('asks for an unpadded window when no buffer is configured', async () => {
    await service.getAvailability({ clientId: 'c1', date: futureDate(), serviceType: 'Botox', timezone: 'UTC' });
    const { lt, gt } = conflictWindows[0];
    expect((new Date(lt).getTime() - new Date(gt).getTime()) / 60_000).toBe(30);
  });
});

describe('lead time and booking horizon', () => {
  it('drops slots inside advance_booking_hours', async () => {
    rules.advance_booking_hours = 48;
    const slots = await service.getAvailability({
      clientId: 'c1', date: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
      serviceType: 'Botox', timezone: 'UTC',
    });
    // Tomorrow is inside a 48-hour notice window, so nothing is bookable.
    expect(slots.filter((s) => s.available)).toHaveLength(0);
  });

  it('drops slots beyond max_advance_booking_days', async () => {
    rules.max_advance_booking_days = 7;
    const slots = await service.getAvailability({
      clientId: 'c1', date: futureDate(60), serviceType: 'Botox', timezone: 'UTC',
    });
    expect(slots.filter((s) => s.available)).toHaveLength(0);
  });

  it('leaves a date inside both limits bookable', async () => {
    rules.advance_booking_hours = 24;
    rules.max_advance_booking_days = 60;
    const slots = await service.getAvailability({
      clientId: 'c1', date: futureDate(10), serviceType: 'Botox', timezone: 'UTC',
    });
    expect(slots.some((s) => s.available)).toBe(true);
  });
});
