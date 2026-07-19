import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockHttp = {
  defaults: { baseURL: '', headers: { common: {} as Record<string, string> } },
  interceptors: { response: { use: vi.fn() } },
  post: vi.fn(),
  put: vi.fn(),
  get: vi.fn(),
};

vi.mock('axios', () => ({
  default: { create: vi.fn(() => mockHttp), post: vi.fn() },
}));

import { goHighLevelPlugin } from '../crm/adapters/gohighlevel.adapter.js';
import type { ICrmAdapter } from '../crm/crm.interface.js';

const baseConfig = {
  accessToken: 'test-access-token',
  locationId: 'loc_123',
};

function makeAdapter(extra: Record<string, unknown> = {}): ICrmAdapter {
  return goHighLevelPlugin.factory({ ...baseConfig, ...extra });
}

beforeEach(() => {
  mockHttp.post.mockReset();
  mockHttp.put.mockReset();
  mockHttp.get.mockReset();
  mockHttp.defaults = { baseURL: '', headers: { common: {} } };
});

describe('GoHighLevel adapter (v2 API)', () => {
  it('targets the v2 base URL with bearer token and Version header', () => {
    makeAdapter();
    expect(mockHttp.defaults.baseURL).toBe('https://services.leadconnectorhq.com');
    expect(mockHttp.defaults.headers.common['Authorization']).toBe('Bearer test-access-token');
    expect(mockHttp.defaults.headers.common['Version']).toBe('2021-07-28');
  });

  it('upserts contacts with the locationId and returns the GHL contact id', async () => {
    mockHttp.post.mockResolvedValue({ data: { contact: { id: 'ghl_c1' }, new: true } });
    const res = await makeAdapter().createOrUpdateContact({
      firstName: 'Jamie', lastName: 'Doe', phone: '+15551234567', email: 'j@d.com', tags: ['ai-lead'],
    });
    expect(res).toEqual({ success: true, externalId: 'ghl_c1', metadata: undefined });
    expect(mockHttp.post).toHaveBeenCalledWith('/contacts/upsert', expect.objectContaining({
      locationId: 'loc_123',
      firstName: 'Jamie',
      phone: '+15551234567',
      tags: ['ai-lead'],
    }));
  });

  it('maps custom fields through customFieldMapping into v2 format', async () => {
    mockHttp.post.mockResolvedValue({ data: { contact: { id: 'ghl_c1' } } });
    const adapter = makeAdapter({ customFieldMapping: { source_detail: 'contact.source_detail' } });
    await adapter.createOrUpdateContact({
      firstName: 'A', lastName: 'B', phone: '+15550000000',
      customFields: { source_detail: 'voice-agent', unmapped: 'x' },
    });
    const body = mockHttp.post.mock.calls[0][1];
    expect(body.customFields).toEqual([
      { key: 'contact.source_detail', field_value: 'voice-agent' },
      { key: 'unmapped', field_value: 'x' },
    ]);
  });

  it('creates opportunities in the configured pipeline with status open', async () => {
    mockHttp.post.mockResolvedValue({ data: { opportunity: { id: 'opp_1' } } });
    const adapter = makeAdapter({ pipelineId: 'pipe_1', stageId: 'stage_1' });
    const res = await adapter.createLead({
      contactId: 'ghl_c1', title: 'Inbound voice lead', source: 'gravvia', value: 500,
    });
    expect(res.success).toBe(true);
    expect(res.externalId).toBe('opp_1');
    expect(mockHttp.post).toHaveBeenCalledWith('/opportunities/', expect.objectContaining({
      locationId: 'loc_123',
      pipelineId: 'pipe_1',
      pipelineStageId: 'stage_1',
      status: 'open',
      monetaryValue: 500,
    }));
  });

  it('fails leads with a clear message when no pipeline is configured', async () => {
    const res = await makeAdapter().createLead({ contactId: 'c', title: 't', source: 's' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/pipeline/i);
    expect(mockHttp.post).not.toHaveBeenCalled();
  });

  it('books appointments on the configured calendar with the calendars API version', async () => {
    mockHttp.post.mockResolvedValue({ data: { id: 'appt_1' } });
    const adapter = makeAdapter({ calendarId: 'cal_1' });
    const res = await adapter.createAppointment({
      contactId: 'ghl_c1', title: 'Consult',
      startTime: new Date('2026-08-01T15:00:00Z'), endTime: new Date('2026-08-01T15:30:00Z'),
    });
    expect(res).toMatchObject({ success: true, externalId: 'appt_1' });
    expect(mockHttp.post).toHaveBeenCalledWith(
      '/calendars/events/appointments',
      expect.objectContaining({
        calendarId: 'cal_1',
        locationId: 'loc_123',
        contactId: 'ghl_c1',
        appointmentStatus: 'confirmed',
        startTime: '2026-08-01T15:00:00.000Z',
      }),
      { headers: { Version: '2021-04-15' } }
    );
  });

  it('preserves appointment notes as a contact note (v2 has no notes field)', async () => {
    mockHttp.post
      .mockResolvedValueOnce({ data: { id: 'appt_1' } })
      .mockResolvedValueOnce({ data: { note: { id: 'note_1' } } });
    const adapter = makeAdapter({ calendarId: 'cal_1' });
    await adapter.createAppointment({
      contactId: 'ghl_c1', title: 'Consult', notes: 'prefers mornings',
      startTime: new Date(), endTime: new Date(Date.now() + 30 * 60000),
    });
    expect(mockHttp.post).toHaveBeenCalledWith('/contacts/ghl_c1/notes', {
      body: expect.stringContaining('prefers mornings'),
    });
  });

  it('fails appointments with a clear message when no calendar is configured', async () => {
    const res = await makeAdapter().createAppointment({
      contactId: 'c', title: 't', startTime: new Date(), endTime: new Date(),
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/calendar/i);
  });

  it('pushes transcripts and summaries as contact notes', async () => {
    mockHttp.post.mockResolvedValue({ data: { note: { id: 'n1' } } });
    const adapter = makeAdapter();
    await adapter.pushTranscript('ghl_c1', 'hello world', 'call_1');
    await adapter.pushCallSummary('ghl_c1', 'caller booked', 'call_1');
    expect(mockHttp.post).toHaveBeenNthCalledWith(1, '/contacts/ghl_c1/notes', {
      body: expect.stringContaining('hello world'),
    });
    expect(mockHttp.post).toHaveBeenNthCalledWith(2, '/contacts/ghl_c1/notes', {
      body: expect.stringContaining('caller booked'),
    });
  });

  it('testConnection checks the connected location', async () => {
    mockHttp.get.mockResolvedValue({ data: {} });
    await expect(makeAdapter().testConnection()).resolves.toBe(true);
    expect(mockHttp.get).toHaveBeenCalledWith('/locations/loc_123');
    mockHttp.get.mockRejectedValue(new Error('401'));
    await expect(makeAdapter().testConnection()).resolves.toBe(false);
  });

  it('returns failure (not throw) when the API errors', async () => {
    mockHttp.post.mockRejectedValue(new Error('422 Unprocessable'));
    const res = await makeAdapter().createOrUpdateContact({
      firstName: 'A', lastName: 'B', phone: '+15550000000',
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain('422');
  });
});
