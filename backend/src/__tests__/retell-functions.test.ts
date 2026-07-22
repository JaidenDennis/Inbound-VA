import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import CryptoJS from 'crypto-js';

const clientObj = { id: 'c1', name: 'Glow', timezone: 'America/New_York' };

vi.mock('../services/index.js', () => ({
  clientService: {
    findByPhoneNumber: vi.fn(() => Promise.resolve(clientObj)),
    findByAgentId: vi.fn(() => Promise.resolve(clientObj)),
    getSettings: vi.fn(() =>
      Promise.resolve({
        booking_enabled: true,
        notification_emails: ['staff@glow.com'],
        services: [{ name: 'Botox', duration_minutes: 30 }],
      })
    ),
  },
  contactService: {
    findByPhone: vi.fn(() => Promise.resolve(null)),
    upsertByPhone: vi.fn(() => Promise.resolve({ id: 'ct1', first_name: 'Jane', last_name: 'Doe' })),
  },
  callService: {
    findByRetellId: vi.fn(() => Promise.resolve({ id: 'call1', client_id: 'c1', contact_id: 'ct1' })),
    upsertConversation: vi.fn(() => Promise.resolve({})),
  },
}));

const createAppointment = vi.fn(() => Promise.resolve({ id: 'appt1' }));
vi.mock('../booking/index.js', () => ({
  bookingService: { createAppointment, getAvailability: vi.fn(() => Promise.resolve([])) },
}));

const notifAdd = vi.fn(() => Promise.resolve(undefined));
vi.mock('../queues/index.js', () => ({ notificationsQueue: { add: notifAdd } }));

vi.mock('../db/index.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({ order: vi.fn(() => ({ limit: vi.fn(() => Promise.resolve({ data: [] })) })) })),
          // Scope guard's call_sessions lookup: no session → legacy passthrough.
          maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
        })),
      })),
      insert: vi.fn(() => Promise.resolve({ error: null })),
    })),
  },
}));

const { retellFunctionRoutes } = await import('../routes/functions/retell-functions.route.js');
const services = await import('../services/index.js');

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

async function callFn(app: FastifyInstance, name: string, args: Record<string, unknown>, sigOverride?: string) {
  const raw = JSON.stringify({ name, call: { call_id: 'rc1', agent_id: 'ag1', from_number: '+19998887777', to_number: '+15551112222' }, args });
  return app.inject({
    method: 'POST',
    url: `/functions/retell/${name}`,
    headers: { 'content-type': 'application/json', 'x-retell-signature': sigOverride ?? sign(raw) },
    payload: raw,
  });
}

describe('Retell custom-function endpoints', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  it('rejects an invalid signature with 401', async () => {
    const res = await callFn(app, 'lookup_existing_client', { phone: '+19998887777' }, 'v=1,d=bad');
    expect(res.statusCode).toBe(401);
  });

  it('lookup_existing_client returns found:false for a new caller', async () => {
    const res = await callFn(app, 'lookup_existing_client', { phone: '+19998887777' });
    expect(res.statusCode).toBe(200);
    expect(res.json().found).toBe(false);
  });

  it('lookup_existing_client returns found:true for a returning caller', async () => {
    vi.mocked(services.contactService.findByPhone).mockResolvedValueOnce({
      id: 'ct1', first_name: 'Jane', last_name: 'Doe', tags: ['vip'],
    } as never);
    const res = await callFn(app, 'lookup_existing_client', { phone: '+19998887777' });
    expect(res.statusCode).toBe(200);
    expect(res.json().found).toBe(true);
    expect(res.json().first_name).toBe('Jane');
  });

  it('book_appointment books and returns booked:true', async () => {
    const res = await callFn(app, 'book_appointment', {
      contact_name: 'Jane Doe',
      phone: '+19998887777',
      service_type: 'Botox',
      start_time: '2026-07-01T15:00:00.000Z',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().booked).toBe(true);
    expect(createAppointment).toHaveBeenCalledOnce();
  });

  it('book_appointment refuses when booking is disabled', async () => {
    vi.mocked(services.clientService.getSettings).mockResolvedValueOnce({
      booking_enabled: false, notification_emails: [], services: [],
    } as never);
    const res = await callFn(app, 'book_appointment', {
      contact_name: 'Jane Doe', phone: '+19998887777', service_type: 'Botox', start_time: '2026-07-01T15:00:00.000Z',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().booked).toBe(false);
    expect(createAppointment).not.toHaveBeenCalled();
  });

  it('schedule_callback records the request and alerts staff', async () => {
    const res = await callFn(app, 'schedule_callback', {
      caller_name: 'Jane Doe',
      phone: '+19998887777',
      preferred_time: 'tomorrow morning',
      topic: 'Botox',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().scheduled).toBe(true);
    expect(notifAdd).toHaveBeenCalledWith('schedule-callback', expect.objectContaining({ type: 'lead' }), expect.anything());
  });

  it('request_human_handoff alerts staff and flags the conversation', async () => {
    const res = await callFn(app, 'request_human_handoff', { reason: 'wants a person' });
    expect(res.statusCode).toBe(200);
    expect(res.json().transferring).toBe(true);
    expect(vi.mocked(services.callService.upsertConversation)).toHaveBeenCalledWith(
      expect.objectContaining({ handoff_requested: true })
    );
    expect(notifAdd).toHaveBeenCalledWith('handoff', expect.objectContaining({ type: 'handoff' }), expect.anything());
  });
});
