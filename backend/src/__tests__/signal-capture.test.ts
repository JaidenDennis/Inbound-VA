import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Signal capture (migration 023).
 *
 * The load-bearing distinction throughout is NULL vs false/0. "We did not
 * measure this" and "we measured zero" are different claims, and only one of
 * them is true before an agent is re-provisioned. Most of these tests exist to
 * keep them apart.
 */

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION_023 = resolve(here, '../../../supabase/migrations/023_signal_capture.sql');

const state = vi.hoisted(() => ({
  upserted: [] as Record<string, unknown>[],
  client: { id: 'c1' } as { id: string } | null,
}));

vi.mock('../db/index.js', () => ({
  supabase: {
    from: () => ({
      upsert: (row: Record<string, unknown>) => {
        state.upserted.push(row);
        return Promise.resolve({ error: null });
      },
    }),
  },
}));

vi.mock('../services/client.service.js', () => ({
  clientService: { findByAgentId: async () => state.client },
}));

const { callRecordService } = await import('../services/callRecord.service.js');
const { normalizeQuestion, FLAG_REASONS } = await import('../ai/call-quality.service.js');
const { RETELL_ANALYSIS_FIELDS, buildPostCallAnalysisSchema } = await import(
  '../providers/retell/retell.analysis-fields.js'
);

function analyzedCall(cad: Record<string, unknown>) {
  return {
    call_id: 'rc-1',
    agent_id: 'ag-1',
    start_timestamp: 1_700_000_000_000,
    end_timestamp: 1_700_000_060_000,
    call_analysis: { custom_analysis_data: cad },
  };
}

beforeEach(() => {
  state.upserted.length = 0;
  state.client = { id: 'c1' };
});

describe('Retell signal mapping', () => {
  it('promotes the demand-intelligence fields onto columns', async () => {
    await callRecordService.recordFromAnalyzed(
      analyzedCall({
        call_reason: 'book appointment',
        referral_source: 'instagram',
        requested_service: 'botox',
        service_available: true,
        escalation_reason: 'caller insisted',
      })
    );

    expect(state.upserted[0]).toMatchObject({
      call_reason: 'book appointment',
      referral_source: 'instagram',
      requested_service: 'botox',
      service_available: true,
      escalation_reason: 'caller insisted',
    });
  });

  // The core of the phase. An agent that has not been re-provisioned reports
  // none of these, and every one of them must read as "unknown".
  it('leaves every new signal null when the agent reports nothing', async () => {
    await callRecordService.recordFromAnalyzed(analyzedCall({}));
    const row = state.upserted[0];

    for (const col of [
      'call_reason',
      'referral_source',
      'requested_service',
      'service_available',
      'escalation_reason',
    ]) {
      expect(row[col], `${col} should be null, not a value`).toBeNull();
    }
  });

  // service_available is the one that feeds a dollar figure. Defaulting it to
  // false would report every call at an un-provisioned agent as lost demand.
  it('never defaults service_available to false', async () => {
    await callRecordService.recordFromAnalyzed(analyzedCall({}));
    expect(state.upserted[0].service_available).not.toBe(false);
    expect(state.upserted[0].service_available).toBeNull();
  });

  it('records service_available: false when the agent genuinely reports it', async () => {
    await callRecordService.recordFromAnalyzed(
      analyzedCall({ requested_service: 'root canal', service_available: false })
    );
    expect(state.upserted[0].service_available).toBe(false);
  });

  // The legacy booleans keep their old behaviour: "no appointment was booked" is
  // true of a call where the field was never configured.
  it('keeps the three legacy booleans defaulting to false', async () => {
    await callRecordService.recordFromAnalyzed(analyzedCall({}));
    expect(state.upserted[0]).toMatchObject({
      appointment_booked: false,
      lead_recaptured: false,
      missed_call_recovered: false,
    });
  });

  it('treats blank and non-answer strings as absences', async () => {
    for (const value of ['', '   ', 'N/A', 'n/a', 'none', 'unknown', 'not specified']) {
      state.upserted.length = 0;
      await callRecordService.recordFromAnalyzed(analyzedCall({ referral_source: value }));
      expect(state.upserted[0].referral_source, `"${value}" should be null`).toBeNull();
    }
  });

  it('coerces string booleans the way Retell sometimes sends them', async () => {
    await callRecordService.recordFromAnalyzed(analyzedCall({ service_available: 'false' }));
    expect(state.upserted[0].service_available).toBe(false);
  });

  it('caps a runaway extraction rather than storing it whole', async () => {
    await callRecordService.recordFromAnalyzed(analyzedCall({ call_reason: 'x'.repeat(5000) }));
    expect((state.upserted[0].call_reason as string).length).toBe(500);
  });

  it('still writes no row for an unknown agent', async () => {
    state.client = null;
    await callRecordService.recordFromAnalyzed(analyzedCall({ call_reason: 'anything' }));
    expect(state.upserted).toHaveLength(0);
  });
});

describe('knowledge-gap normalization', () => {
  // The whole value of the gap list is that it groups. Forty phrasings of one
  // question must be one row with occurrences=40, not forty rows.
  it('groups questions differing only by case and punctuation', () => {
    expect(normalizeQuestion('Do you take Delta?')).toBe(normalizeQuestion('do you take delta'));
  });

  it('groups across leading filler', () => {
    expect(normalizeQuestion('Um, do you take Delta?')).toBe(normalizeQuestion('Do you take Delta?'));
    expect(normalizeQuestion('So can you take Delta')).toBe(normalizeQuestion('Can you take Delta?'));
  });

  it('keeps genuinely different questions apart', () => {
    expect(normalizeQuestion('Do you take Delta?')).not.toBe(normalizeQuestion('Do you take Cigna?'));
    expect(normalizeQuestion('What are your hours?')).not.toBe(normalizeQuestion('Where are you located?'));
  });

  it('produces an empty string for input carrying no content', () => {
    expect(normalizeQuestion('do you?')).toBe('');
    expect(normalizeQuestion('???')).toBe('');
  });
});

describe('Retell analysis field schema', () => {
  it('declares every field the mapper reads', () => {
    const names = new Set(RETELL_ANALYSIS_FIELDS.map((f) => f.name));
    for (const required of [
      'appointment_booked',
      'lead_recaptured',
      'missed_call_recovered',
      'call_reason',
      'referral_source',
      'requested_service',
      'service_available',
      'escalation_reason',
    ]) {
      expect(names.has(required), `${required} must be configured on the agent`).toBe(true);
    }
  });

  it('gives every field a description the model can act on', () => {
    for (const f of RETELL_ANALYSIS_FIELDS) {
      expect(f.description.length, `${f.name} needs a real description`).toBeGreaterThan(40);
    }
  });

  it('hands out a copy, so a caller cannot mutate the shared schema', () => {
    const a = buildPostCallAnalysisSchema();
    a[0].name = 'mutated';
    expect(buildPostCallAnalysisSchema()[0].name).not.toBe('mutated');
  });
});

describe('migration 023', () => {
  const sql = readFileSync(MIGRATION_023, 'utf8');

  it('adds every promoted column as nullable', () => {
    for (const col of [
      'call_reason',
      'referral_source',
      'requested_service',
      'service_available',
      'escalation_reason',
      'quality_score',
      'analyzed_at',
    ]) {
      expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${col}`);
      // A NOT NULL default on any of these would turn "not measured" into a value.
      expect(sql).not.toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${col}\\s+\\w+\\s+NOT NULL`));
    }
  });

  it('bounds the quality scores rather than trusting the model', () => {
    expect(sql).toContain('call_records_quality_range');
    expect(sql).toMatch(/quality_score\s+>= 0 AND quality_score\s+<= 10/);
  });

  it('makes knowledge gaps unique per normalized question', () => {
    expect(sql).toContain('UNIQUE (client_id, normalized)');
  });

  it('increments occurrences atomically instead of read-then-write', () => {
    expect(sql).toContain('ON CONFLICT (client_id, normalized) DO UPDATE');
    expect(sql).toContain('occurrences  = knowledge_gaps.occurrences + 1');
  });

  // report_quality is what makes the "every call is scored" claim checkable.
  it('reports coverage alongside the averages', () => {
    expect(sql).toContain('analyzed_calls');
    expect(sql).toContain('total_calls');
    // AVG over an all-null set must stay null, not be coalesced to zero.
    expect(sql).not.toMatch(/COALESCE\(\s*AVG\(quality_score\)/);
  });

  it('indexes the flagged queue as a partial index', () => {
    expect(sql).toMatch(/idx_call_records_flagged[\s\S]*WHERE flagged/);
  });
});

describe('flag vocabulary', () => {
  it('covers the failure modes the design named', () => {
    for (const reason of ['caller_frustrated', 'dead_air', 'repeated_clarification', 'caller_hung_up']) {
      expect(FLAG_REASONS).toContain(reason);
    }
  });
});
