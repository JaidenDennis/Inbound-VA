import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NormalizedEvent } from '../types/index.js';

// bookingService availability: CRM calendar (GHL) is the truth when an active
// connection + calendarId exist; otherwise the internal rules engine answers.

const ghlSlots = [{ start: '2026-08-01T14:00:00.000Z' }, { start: '2026-08-01T15:00:00.000Z' }];
const adapterMock = {
  getAvailability: vi.fn(() => Promise.resolve(ghlSlots)),
  updateBooking: vi.fn(() => Promise.resolve({ success: true })),
  cancelBooking: vi.fn(() => Promise.resolve({ success: true })),
};

let activeConn: Record<string, unknown> | null = {
  id: 'conn1',
  client_id: 'c1',
  crm_type: 'gohighlevel',
};

vi.mock('../crm/index.js', () => ({
  getCrmAdapter: vi.fn(() => adapterMock),
  resolveAdapterConfig: vi.fn(() => Promise.resolve({ accessToken: 't', locationId: 'l', calendarId: 'cal_1' })),
}));

vi.mock('../calendar/index.js', () => ({ getCalendarAdapter: vi.fn() }));

const published: Array<Pick<NormalizedEvent, 'type' | 'payload'>> = [];
vi.mock('../events/index.js', () => ({
  eventBus: {
    publish: vi.fn((e: NormalizedEvent) => {
      published.push({ type: e.type, payload: e.payload });
      return Promise.resolve(e);
    }),
  },
}));
vi.mock('../queues/index.js', () => ({ crmSyncQueue: { add: vi.fn() } }));

const waitlistInserts: Array<Record<string, unknown>> = [];
vi.mock('../db/index.js', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === 'crm_connections') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({ maybeSingle: vi.fn(() => Promise.resolve({ data: activeConn, error: null })) })),
            })),
          })),
        };
      }
      if (table === 'client_settings') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(() => Promise.resolve({ data: { booking_rules: { working_hours: {} } }, error: null })),
            })),
          })),
        };
      }
      if (table === 'waitlist_entries') {
        return {
          insert: vi.fn((row: Record<string, unknown>) => {
            waitlistInserts.push(row);
            return {
              select: vi.fn(() => ({ single: vi.fn(() => Promise.resolve({ data: { id: 'wl1' }, error: null })) })),
            };
          }),
        };
      }
      return { select: vi.fn(), insert: vi.fn() };
    }),
  },
}));

const { bookingService } = await import('../booking/booking.service.js');

describe('availability source of truth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    published.length = 0;
    activeConn = { id: 'conn1', client_id: 'c1', crm_type: 'gohighlevel' };
  });

  it('uses the CRM calendar when an active connection with a calendar exists', async () => {
    const slots = await bookingService.getAvailability({ clientId: 'c1', date: '2026-08-01', timezone: 'America/New_York' });
    expect(adapterMock.getAvailability).toHaveBeenCalledOnce();
    expect(slots).toHaveLength(2);
    expect(slots[0].start.toISOString()).toBe('2026-08-01T14:00:00.000Z');
    expect(slots.every((s) => s.available)).toBe(true);
  });

  it('respects an empty CRM answer (no fallback that would contradict the truth)', async () => {
    adapterMock.getAvailability.mockResolvedValueOnce([]);
    const slots = await bookingService.getAvailability({ clientId: 'c1', date: '2026-08-01' });
    expect(slots).toEqual([]);
  });

  it('falls back to the internal rules engine when no CRM connection exists', async () => {
    activeConn = null;
    const slots = await bookingService.getAvailability({ clientId: 'c1', date: '2026-08-01' });
    expect(adapterMock.getAvailability).not.toHaveBeenCalled();
    expect(slots).toEqual([]); // no working hours configured → no internal slots
  });

  it('falls back to the internal rules engine when the CRM call fails', async () => {
    adapterMock.getAvailability.mockRejectedValueOnce(new Error('GHL down'));
    const slots = await bookingService.getAvailability({ clientId: 'c1', date: '2026-08-01' });
    expect(slots).toEqual([]); // fallback ran instead of throwing
  });
});

describe('waitlist', () => {
  it('persists the entry and publishes waitlist.added', async () => {
    published.length = 0;
    const res = await bookingService.addToWaitlist({
      clientId: 'c1',
      contactId: 'ct1',
      service: 'Botox',
      preferredDays: ['monday', 'wednesday'],
      preferredTimes: 'mornings',
    });
    expect(res.id).toBe('wl1');
    expect(waitlistInserts[0]).toMatchObject({ client_id: 'c1', contact_id: 'ct1', service: 'Botox', status: 'waiting' });
    expect(published.map((e) => e.type)).toContain('waitlist.added');
  });
});
