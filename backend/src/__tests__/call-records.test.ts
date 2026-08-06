import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => {
  const state: {
    upsertRow?: Record<string, unknown>;
    upsertOpts?: Record<string, unknown>;
    rpcCalls: Array<[string, Record<string, unknown>]>;
    rpcResult: Array<Record<string, unknown>>;
    rpcError: { message: string } | null;
  } = { rpcCalls: [], rpcResult: [], rpcError: null };
  const supabase = {
    from: () => ({
      upsert: (row: Record<string, unknown>, opts: Record<string, unknown>) => {
        state.upsertRow = row;
        state.upsertOpts = opts;
        return Promise.resolve({ error: null });
      },
    }),
    rpc: (fn: string, args: Record<string, unknown>) => {
      state.rpcCalls.push([fn, args]);
      return Promise.resolve({ data: state.rpcError ? null : state.rpcResult, error: state.rpcError });
    },
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

/**
 * Aggregation moved into Postgres (migration 020). It used to happen here in
 * JavaScript over selected rows, which silently under-counted past PostgREST's
 * 1000-row cap — so any client with more than 1000 calls in the period was shown
 * wrong numbers with no error. These tests now cover the contract with the RPC:
 * the arguments it is called with, and the mapping of what comes back. The
 * arithmetic itself is the SQL function's job.
 */
describe('CallRecordService.getStats', () => {
  beforeEach(() => {
    db.state.rpcCalls.length = 0;
    db.state.rpcError = null;
  });

  it('delegates to report_kpis with the client and period', async () => {
    db.state.rpcResult = [{
      calls_answered: 2, missed_calls_recovered: 1, leads_recaptured: 1,
      appointments_booked: 1, avg_call_duration_seconds: 90, total_calls: 3,
    }];

    const stats = await new CallRecordService().getStats('client-a', '2026-01-01', '2026-12-31');

    expect(db.state.rpcCalls[0]).toEqual([
      'report_kpis',
      { p_client_id: 'client-a', p_from: '2026-01-01', p_to: '2026-12-31' },
    ]);
    expect(stats).toEqual({
      callsAnswered: 2,
      missedCallsRecovered: 1,
      leadsRecaptured: 1,
      appointmentsBooked: 1,
      avgCallDurationSeconds: 90,
      totalCalls: 3,
    });
  });

  it('returns zeros when the period has no calls', async () => {
    db.state.rpcResult = [];
    const stats = await new CallRecordService().getStats('client-a', '2026-01-01', '2026-12-31');
    expect(stats).toEqual({
      callsAnswered: 0,
      missedCallsRecovered: 0,
      leadsRecaptured: 0,
      appointmentsBooked: 0,
      avgCallDurationSeconds: 0,
      totalCalls: 0,
    });
  });

  it('coerces the bigint counts Postgres returns as strings', async () => {
    // COUNT(*) comes back over PostgREST as a string; without Number() the KPI
    // cards would concatenate rather than add downstream.
    db.state.rpcResult = [{
      calls_answered: '12', missed_calls_recovered: '3', leads_recaptured: '4',
      appointments_booked: '5', avg_call_duration_seconds: '90', total_calls: '15',
    }];
    const stats = await new CallRecordService().getStats('client-a', '2026-01-01', '2026-12-31');
    expect(stats.callsAnswered).toBe(12);
    expect(stats.totalCalls).toBe(15);
  });

  it('throws rather than reporting zeros when the query fails', async () => {
    // Silently showing "0 calls answered" for a database error would read as a
    // catastrophic drop in service to a client looking at their own numbers.
    db.state.rpcError = { message: 'connection reset' };
    await expect(new CallRecordService().getStats('client-a', '2026-01-01', '2026-12-31'))
      .rejects.toThrow(/connection reset/);
  });
});

describe('CallRecordService.getVolume', () => {
  beforeEach(() => {
    db.state.rpcCalls.length = 0;
    db.state.rpcError = null;
  });

  it('passes the bucket through to report_volume', async () => {
    db.state.rpcResult = [{ bucket: '2026-08-01T00:00:00Z', answered: '4', voicemail: '1', total: '5' }];
    const rows = await new CallRecordService().getVolume('client-a', '2026-01-01', '2026-12-31', 'week');

    expect(db.state.rpcCalls[0][1]).toMatchObject({ p_bucket: 'week' });
    expect(rows).toEqual([{ bucket: '2026-08-01T00:00:00Z', answered: 4, voicemail: 1, total: 5 }]);
  });
});
