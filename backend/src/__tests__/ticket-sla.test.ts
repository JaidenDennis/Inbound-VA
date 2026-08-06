import { describe, it, expect } from 'vitest';
import { SLA_TARGETS, slaDeadlines } from '../services/ticket.service.js';
import { TICKET_PRIORITIES } from '../types/index.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe('SLA targets', () => {
  it('defines a target for every priority the schema allows', () => {
    for (const priority of TICKET_PRIORITIES) {
      expect(SLA_TARGETS[priority]).toBeDefined();
    }
  });

  it('gets stricter as priority rises', () => {
    const order = ['low', 'normal', 'high', 'urgent'] as const;
    for (let i = 1; i < order.length; i += 1) {
      expect(SLA_TARGETS[order[i]].responseMs).toBeLessThan(SLA_TARGETS[order[i - 1]].responseMs);
      expect(SLA_TARGETS[order[i]].resolutionMs).toBeLessThan(SLA_TARGETS[order[i - 1]].resolutionMs);
    }
  });

  it('always allows more time to resolve than to respond', () => {
    for (const priority of TICKET_PRIORITIES) {
      const target = SLA_TARGETS[priority];
      expect(target.resolutionMs).toBeGreaterThan(target.responseMs);
    }
  });

  it('matches the intervals backfilled by migration 019', () => {
    expect(SLA_TARGETS.urgent).toEqual({ responseMs: 1 * HOUR, resolutionMs: 8 * HOUR });
    expect(SLA_TARGETS.high).toEqual({ responseMs: 4 * HOUR, resolutionMs: 24 * HOUR });
    expect(SLA_TARGETS.normal).toEqual({ responseMs: 24 * HOUR, resolutionMs: 5 * DAY });
    expect(SLA_TARGETS.low).toEqual({ responseMs: 3 * DAY, resolutionMs: 14 * DAY });
  });
});

describe('slaDeadlines', () => {
  const base = new Date('2026-08-05T12:00:00.000Z');

  it('computes both deadlines from the given moment', () => {
    const deadlines = slaDeadlines('urgent', base);
    expect(deadlines.sla_response_due_at).toBe('2026-08-05T13:00:00.000Z');
    expect(deadlines.sla_resolution_due_at).toBe('2026-08-05T20:00:00.000Z');
  });

  it('re-baselines when priority changes, rather than keeping the old clock', () => {
    const asNormal = slaDeadlines('normal', base);
    const asUrgent = slaDeadlines('urgent', base);
    expect(new Date(asUrgent.sla_response_due_at).getTime())
      .toBeLessThan(new Date(asNormal.sla_response_due_at).getTime());
  });

  it('falls back to the normal target for an unknown priority', () => {
    // Defensive: a priority added to the schema without a target here should
    // still produce a deadline rather than NaN.
    const deadlines = slaDeadlines('something-else' as never, base);
    expect(deadlines.sla_response_due_at).toBe(slaDeadlines('normal', base).sla_response_due_at);
  });
});
