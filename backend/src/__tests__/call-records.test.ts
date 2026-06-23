import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => {
  const state: {
    upsertRow?: Record<string, unknown>;
    upsertOpts?: Record<string, unknown>;
    statsRows: Array<Record<string, unknown>>;
  } = { statsRows: [] };
  const supabase = {
    from: () => ({
      upsert: (row: Record<string, unknown>, opts: Record<string, unknown>) => {
        state.upsertRow = row;
        state.upsertOpts = opts;
        return Promise.resolve({ error: null });
      },
      select: () => ({
        eq: () => ({
          gte: () => ({
            lte: () => Promise.resolve({ data: state.statsRows }),
          }),
        }),
      }),
    }),
  };
  return { state, supabase };
});
vi.mock('../db/index.js', () => ({ supabase: db.supabase }));

const client = vi.hoisted(() => ({ findByAgentId: vi.fn() }));
vi.mock('../services/client.service.js', () => ({ clientService: { findByAgentId: client.findByAgentId } }));

import { CallRecordService } from '../services/callRecord.service.js';

describe('CallRecordService.recordFromAnalyzed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.state.upsertRow = undefined;
    db.state.upsertOpts = undefined;
  });

  it('maps agent_id→client_id + custom_analysis_data booleans and upserts idempotently', async () => {
    client.findByAgentId.mockResolvedValue({ id: 'client-a' });

    await new CallRecordService().recordFromAnalyzed({
      call_id: 'call-1',
      agent_id: 'agent_x',
      start_timestamp: 1_700_000_000_000,
      end_timestamp: 1_700_000_060_000,
      disconnection_reason: 'user_hangup',
      call_analysis: {
        user_sentiment: 'Positive',
        call_successful: true,
        in_voicemail: false,
        custom_analysis_data: {
          appointment_booked: true,
          lead_recaptured: 'true', // string coerces to true
          missed_call_recovered: false,
        },
      },
    });

    expect(client.findByAgentId).toHaveBeenCalledWith('agent_x');
    const row = db.state.upsertRow!;
    expect(row).toMatchObject({
      client_id: 'client-a',
      retell_call_id: 'call-1',
      agent_id: 'agent_x',
      in_voicemail: false,
      call_successful: true,
      user_sentiment: 'Positive',
      disconnection_reason: 'user_hangup',
      appointment_booked: true,
      lead_recaptured: true,
      missed_call_recovered: false,
    });
    expect(row.duration_seconds).toBe(60); // (end - start) / 1000
    expect(db.state.upsertOpts).toMatchObject({ onConflict: 'retell_call_id' });
  });

  it('prefers call_cost.total_duration_seconds for duration', async () => {
    client.findByAgentId.mockResolvedValue({ id: 'client-a' });
    await new CallRecordService().recordFromAnalyzed({
      call_id: 'call-2',
      agent_id: 'agent_x',
      start_timestamp: 0,
      end_timestamp: 100_000,
      call_cost: { total_duration_seconds: 42 },
    });
    expect(db.state.upsertRow!.duration_seconds).toBe(42);
  });

  it('skips (no upsert) for an unknown agent_id — no orphan record', async () => {
    client.findByAgentId.mockResolvedValue(null);
    await new CallRecordService().recordFromAnalyzed({ call_id: 'call-3', agent_id: 'ghost' });
    expect(db.state.upsertRow).toBeUndefined();
  });

  it('defaults missing custom fields to false (graceful degradation)', async () => {
    client.findByAgentId.mockResolvedValue({ id: 'client-a' });
    await new CallRecordService().recordFromAnalyzed({
      call_id: 'call-4',
      agent_id: 'agent_x',
      call_analysis: { user_sentiment: 'Neutral' }, // no custom_analysis_data
    });
    const row = db.state.upsertRow!;
    expect(row.appointment_booked).toBe(false);
    expect(row.lead_recaptured).toBe(false);
    expect(row.missed_call_recovered).toBe(false);
  });
});

describe('CallRecordService.getStats', () => {
  it('aggregates counts and avg duration, excluding voicemail', async () => {
    db.state.statsRows = [
      { in_voicemail: false, missed_call_recovered: true, lead_recaptured: false, appointment_booked: true, duration_seconds: 120 },
      { in_voicemail: false, missed_call_recovered: false, lead_recaptured: true, appointment_booked: false, duration_seconds: 60 },
      { in_voicemail: true, missed_call_recovered: false, lead_recaptured: false, appointment_booked: false, duration_seconds: 5 },
    ];
    const stats = await new CallRecordService().getStats('client-a', '2026-01-01', '2026-12-31');
    expect(stats.callsAnswered).toBe(2); // voicemail excluded
    expect(stats.appointmentsBooked).toBe(1);
    expect(stats.leadsRecaptured).toBe(1);
    expect(stats.missedCallsRecovered).toBe(1);
    expect(stats.avgCallDurationSeconds).toBe(90); // (120 + 60) / 2
  });

  it('returns zeros (no divide-by-zero) when there are no calls', async () => {
    db.state.statsRows = [];
    const stats = await new CallRecordService().getStats('client-a', '2026-01-01', '2026-12-31');
    expect(stats).toEqual({
      callsAnswered: 0,
      missedCallsRecovered: 0,
      leadsRecaptured: 0,
      appointmentsBooked: 0,
      avgCallDurationSeconds: 0,
    });
  });
});
