import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockHttp = {
  defaults: { baseURL: '', headers: { common: {} as Record<string, string> } },
  interceptors: { response: { use: vi.fn() } },
  post: vi.fn(),
  put: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
};

vi.mock('axios', () => ({
  default: { create: vi.fn(() => mockHttp), post: vi.fn() },
}));

import { goHighLevelPlugin } from '../crm/adapters/gohighlevel.adapter.js';
import { noopPlugin } from '../crm/adapters/noop.adapter.js';

const adapter = () =>
  goHighLevelPlugin.factory({ accessToken: 'tok', locationId: 'loc_1', calendarId: 'cal_1' });

beforeEach(() => {
  mockHttp.get.mockReset();
  mockHttp.put.mockReset();
  mockHttp.delete.mockReset();
});

describe('GoHighLevel calendar-booking methods (canonical types)', () => {
  it('getAvailability flattens the free-slots response across days, sorted', async () => {
    mockHttp.get.mockResolvedValue({
      data: {
        '2026-08-02': { slots: ['2026-08-02T15:00:00-04:00'] },
        '2026-08-01': { slots: ['2026-08-01T14:00:00-04:00', '2026-08-01T15:00:00-04:00'] },
        traceId: 'trace-1',
      },
    });
    const slots = await adapter().getAvailability!({
      startDate: '2026-08-01T00:00:00.000Z',
      endDate: '2026-08-02T23:59:59.000Z',
      timezone: 'America/New_York',
    });
    expect(slots.map((s) => s.start)).toEqual([
      '2026-08-01T14:00:00-04:00',
      '2026-08-01T15:00:00-04:00',
      '2026-08-02T15:00:00-04:00',
    ]);
    const [url, cfg] = mockHttp.get.mock.calls[0];
    expect(url).toBe('/calendars/cal_1/free-slots');
    expect(cfg.params.timezone).toBe('America/New_York');
    expect(typeof cfg.params.startDate).toBe('number'); // GHL wants epoch ms
    expect(cfg.headers.Version).toBe('2021-04-15'); // calendars API version
  });

  it('getAvailability returns [] when no calendar is configured', async () => {
    const noCal = goHighLevelPlugin.factory({ accessToken: 'tok', locationId: 'loc_1' });
    expect(await noCal.getAvailability!({ startDate: 'a', endDate: 'b', timezone: 'UTC' })).toEqual([]);
    expect(mockHttp.get).not.toHaveBeenCalled();
  });

  it('updateBooking PUTs new times with slot-bypass + assignee for round-robin', async () => {
    mockHttp.put.mockResolvedValue({ data: {} });
    const withAssignee = goHighLevelPlugin.factory({
      accessToken: 'tok',
      locationId: 'loc_1',
      calendarId: 'cal_1',
      assignedUserId: 'user_7',
    });
    const res = await withAssignee.updateBooking!('evt_9', {
      startTime: new Date('2026-08-01T18:00:00.000Z'),
      endTime: new Date('2026-08-01T18:30:00.000Z'),
    });
    expect(res.success).toBe(true);
    const [url, body, cfg] = mockHttp.put.mock.calls[0];
    expect(url).toBe('/calendars/events/appointments/evt_9');
    expect(body.startTime).toBe('2026-08-01T18:00:00.000Z');
    // Both verified live: a reschedule to a non-slot time otherwise 422s
    // ("assignedUserId is missing") on round-robin calendars and is rejected by
    // GHL's free-slot rules.
    expect(body.ignoreFreeSlotValidation).toBe(true);
    expect(body.assignedUserId).toBe('user_7');
    expect(cfg.headers.Version).toBe('2021-04-15');
  });

  it('cancelBooking DELETEs the calendar event and reports failures as results', async () => {
    mockHttp.delete.mockResolvedValue({ data: {} });
    const ok = await adapter().cancelBooking!('evt_9');
    expect(ok.success).toBe(true);
    expect(mockHttp.delete.mock.calls[0][0]).toBe('/calendars/events/evt_9');

    mockHttp.delete.mockRejectedValue(new Error('410 gone'));
    const bad = await adapter().cancelBooking!('evt_9');
    expect(bad.success).toBe(false);
    expect(bad.error).toMatch(/410/);
  });
});

describe('noop adapter stubs the full interface including calendar booking', () => {
  const noop = noopPlugin.factory({});
  it('every method succeeds without side effects', async () => {
    expect((await noop.createOrUpdateContact({ firstName: 'a', lastName: 'b', phone: '1' })).success).toBe(true);
    expect((await noop.createLead({ contactId: 'x', title: 't' } as never)).success).toBe(true);
    expect(await noop.getAvailability!({ startDate: 'a', endDate: 'b', timezone: 'UTC' })).toEqual([]);
    expect((await noop.createBooking!({ contactId: 'x', title: 't', startTime: new Date(), endTime: new Date() })).success).toBe(true);
    expect((await noop.updateBooking!('e1', {})).success).toBe(true);
    expect((await noop.cancelBooking!('e1')).success).toBe(true);
    expect(await noop.testConnection()).toBe(true);
  });
});
