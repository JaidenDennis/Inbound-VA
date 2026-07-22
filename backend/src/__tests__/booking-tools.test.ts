import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import CryptoJS from 'crypto-js';

// Retell booking-suite tool endpoints: find/reschedule/cancel/waitlist.

const clientObj = { id: 'c1', name: 'Glow', timezone: 'America/New_York' };
const IN_12_HOURS = new Date(Date.now() + 12 * 3_600_000).toISOString();

const settingsObj: Record<string, unknown> = {
  booking_enabled: true,
  notification_emails: [],
  services: [{ name: 'Botox', duration_minutes: 30 }],
  booking_rules: {
    working_hours: {},
    cancellation_notice_hours: 24,
    cancellation_policy: 'Cancellations with less than 24 hours notice incur a $50 fee.',
  },
};

vi.mock('../services/index.js', () => ({
  clientService: {
    findByPhoneNumber: vi.fn(() => Promise.resolve(clientObj)),
    findByAgentId: vi.fn(() => Promise.resolve(clientObj)),
    getSettings: vi.fn(() => Promise.resolve(settingsObj)),
  },
  contactService: {
    findByPhone: vi.fn(() => Promise.resolve({ id: 'ct1', first_name: 'Jane', last_name: 'Doe' })),
    upsertByPhone: vi.fn(() => Promise.resolve({ id: 'ct1', first_name: 'Jane', last_name: 'Doe' })),
  },
  callService: { findByRetellId: vi.fn(() => Promise.resolve({ id: 'call1', client_id: 'c1', contact_id: 'ct1' })) },
  knowledgeService: { settingsWithKnowledge: vi.fn((_id: string, s: unknown) => Promise.resolve(s)) },
}));

const appointment = {
  id: 'a0a0a0a0-0000-4000-8000-000000000001',
  client_id: 'c1',
  contact_id: 'ct1',
  start_time: IN_12_HOURS,
  end_time: new Date(new Date(IN_12_HOURS).getTime() + 30 * 60_000).toISOString(),
  status: 'confirmed',
  metadata: {},
};

const bookingMock = {
  getAppointment: vi.fn(() => Promise.resolve(appointment)),
  rescheduleAppointment: vi.fn(() =>
    Promise.resolve({ ...appointment, start_time: '2026-09-01T15:00:00.000Z' })
  ),
  cancelAppointment: vi.fn(() => Promise.resolve({ ...appointment, status: 'cancelled' })),
  addToWaitlist: vi.fn(() => Promise.resolve({ id: 'wl1' })),
  getAvailability: vi.fn(() => Promise.resolve([])),
  createAppointment: vi.fn(() => Promise.resolve({ id: 'appt1' })),
};
vi.mock('../booking/index.js', () => ({ bookingService: bookingMock }));
vi.mock('../queues/index.js', () => ({ notificationsQueue: { add: vi.fn() } }));

// Chainable appointments query for find_appointment; call_sessions → no session.
const upcomingAppts = [
  { id: appointment.id, title: 'Botox', start_time: IN_12_HOURS, status: 'confirmed', service_type: 'Botox' },
];
function apptChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'gte', 'not', 'order']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.limit = vi.fn(() => Promise.resolve({ data: rows, error: null }));
  return chain;
}
vi.mock('../db/index.js', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === 'appointments') return apptChain(upcomingAppts);
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })) })),
        })),
        insert: vi.fn(() => Promise.resolve({ error: null })),
      };
    }),
  },
}));

const { retellFunctionRoutes } = await import('../routes/functions/retell-functions.route.js');

function sign(rawBody: string, now = Date.now()): string {
  const d = CryptoJS.HmacSHA256(rawBody + now, process.env.RETELL_API_KEY as string).toString(CryptoJS.enc.Hex);
  return `v=${now},d=${d}`;
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    (req as unknown as { rawBody: string }).rawBody = body as string;
    done(null, body ? JSON.parse(body as string) : {});
  });
  await app.register(retellFunctionRoutes);
  return app;
}

async function callFn(app: FastifyInstance, name: string, args: Record<string, unknown>) {
  const raw = JSON.stringify({
    name,
    call: { call_id: 'rc-b1', from_number: '+19998887777', to_number: '+15551112222' },
    args,
  });
  return app.inject({
    method: 'POST',
    url: `/functions/retell/${name}`,
    headers: { 'content-type': 'application/json', 'x-retell-signature': sign(raw) },
    payload: raw,
  });
}

describe('booking-suite tool endpoints', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  it('find_appointment returns upcoming appointments for a known caller', async () => {
    const res = await callFn(app, 'find_appointment', { phone: '+19998887777' });
    expect(res.json().found).toBe(true);
    expect(res.json().appointments).toHaveLength(1);
    expect(res.json().message).toMatch(/never the internal id/);
  });

  it('reschedule_appointment preserves duration and confirms the new time', async () => {
    const res = await callFn(app, 'reschedule_appointment', {
      appointment_id: appointment.id,
      new_start_time: '2026-09-01T15:00:00.000Z',
    });
    expect(res.json().rescheduled).toBe(true);
    const req = (bookingMock.rescheduleAppointment.mock.calls[0] as unknown[])[0] as {
      newStartTime: Date;
      newEndTime: Date;
    };
    expect(req.newEndTime.getTime() - req.newStartTime.getTime()).toBe(30 * 60_000);
  });

  it('cancel_appointment reads the policy when inside the notice window', async () => {
    const res = await callFn(app, 'cancel_appointment', { appointment_id: appointment.id, reason: 'conflict' });
    expect(res.json().cancelled).toBe(true);
    expect(res.json().policy_applies).toBe(true);
    expect(res.json().message).toContain('$50 fee');
    expect(bookingMock.cancelAppointment).toHaveBeenCalledWith(appointment.id, 'conflict');
  });

  it('cancel_appointment skips the policy outside the notice window', async () => {
    bookingMock.getAppointment.mockResolvedValueOnce({
      ...appointment,
      start_time: new Date(Date.now() + 72 * 3_600_000).toISOString(),
    });
    const res = await callFn(app, 'cancel_appointment', { appointment_id: appointment.id });
    expect(res.json().policy_applies).toBe(false);
    expect(res.json().message).not.toContain('$50');
  });

  it('rejects operations on another tenant\'s appointment', async () => {
    bookingMock.getAppointment.mockResolvedValueOnce({ ...appointment, client_id: 'OTHER' });
    const res = await callFn(app, 'cancel_appointment', { appointment_id: appointment.id });
    expect(res.json().cancelled).toBe(false);
    expect(bookingMock.cancelAppointment).not.toHaveBeenCalled();
  });

  it('waitlist_add captures the entry with preferences', async () => {
    const res = await callFn(app, 'waitlist_add', {
      caller_name: 'Jane Doe',
      phone: '+19998887777',
      service: 'Botox',
      preferred_days: ['monday'],
      preferred_times: 'mornings',
    });
    expect(res.json().added).toBe(true);
    expect(bookingMock.addToWaitlist).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'c1', contactId: 'ct1', service: 'Botox', preferredDays: ['monday'] })
    );
  });
});

describe('booking workflow definitions', () => {
  it('routes booking intents to their workflows with booking scope', async () => {
    const { resolveWorkflowByIntent } = await import('../workflows/index.js');
    expect(resolveWorkflowByIntent('book_appointment')?.id).toBe('book_appointment');
    expect(resolveWorkflowByIntent('reschedule')?.id).toBe('reschedule_appointment');
    expect(resolveWorkflowByIntent('cancel_booking')?.id).toBe('cancel_appointment');
    expect(resolveWorkflowByIntent('join_waitlist')?.id).toBe('waitlist');
    expect(resolveWorkflowByIntent('when_is_my_appointment')?.id).toBe('existing_appointment_inquiry');
    expect(resolveWorkflowByIntent('book_appointment')?.scopes).toContain('booking');
  });
});
