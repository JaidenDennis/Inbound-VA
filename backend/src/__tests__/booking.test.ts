import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BookingService } from '../booking/booking.service.js';

// Mock Supabase
vi.mock('../db/index.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      insert: vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: mockAppointment, error: null }) })) })),
      update: vi.fn(() => ({ eq: vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: mockAppointment, error: null }) })) })) })),
      select: vi.fn(() => ({ eq: vi.fn(() => ({ not: vi.fn(() => ({ lt: vi.fn(() => ({ gt: vi.fn(() => ({ data: [] })) })) })), single: vi.fn().mockResolvedValue({ data: null }) })) })),
      upsert: vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: mockAppointment, error: null }) })) })),
    })),
  },
}));

vi.mock('../events/index.js', () => ({
  eventBus: { publish: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../calendar/index.js', () => ({
  getCalendarAdapter: vi.fn(),
}));

// booking.service imports crmSyncQueue; mock it so no real Redis connection is opened.
vi.mock('../queues/index.js', () => ({
  crmSyncQueue: { add: vi.fn().mockResolvedValue(undefined) },
}));

const mockAppointment = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  client_id: 'client-123',
  contact_id: 'contact-456',
  call_id: null,
  title: 'Test Appointment',
  start_time: new Date('2026-07-01T10:00:00Z').toISOString(),
  end_time: new Date('2026-07-01T10:30:00Z').toISOString(),
  timezone: 'America/New_York',
  status: 'pending',
  service_type: null,
  notes: null,
  reminder_sent: false,
  metadata: {},
  external_calendar_id: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe('BookingService', () => {
  let service: BookingService;

  beforeEach(() => {
    service = new BookingService();
    vi.clearAllMocks();
  });

  it('creates an appointment', async () => {
    const appt = await service.createAppointment({
      clientId: 'client-123',
      contactId: 'contact-456',
      title: 'Test Appointment',
      startTime: new Date('2026-07-01T10:00:00Z'),
      endTime: new Date('2026-07-01T10:30:00Z'),
      timezone: 'America/New_York',
    });
    expect(appt.title).toBe('Test Appointment');
    expect(appt.status).toBe('pending');
  });
});
