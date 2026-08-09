import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Integration health (spec §6.5).
 *
 * The distinction under test is between "never used" and "stopped working".
 * Collapsing those two is how a dead calendar integration sits on a dashboard
 * looking calm for a month.
 */

interface EventRow {
  client_id: string;
  event_type: string;
  created_at: string;
}

const db = vi.hoisted(() => ({ events: [] as EventRow[] }));

vi.mock('../db/index.js', () => {
  function builder() {
    const filters: Record<string, unknown> = {};
    let types: string[] = [];

    const api = {
      select: () => api,
      eq: (col: string, val: unknown) => {
        filters[col] = val;
        return api;
      },
      in: (_col: string, values: string[]) => {
        types = values;
        return api;
      },
      order: () => api,
      limit: () => {
        const rows = db.events
          .filter((e) => e.client_id === filters.client_id && types.includes(e.event_type))
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
        return Promise.resolve({ data: rows.slice(0, 1), error: null });
      },
    };
    return api;
  }

  return { supabase: { from: () => builder() } };
});

const { integrationHealth } = await import('../services/integrationHealth.service.js');

const CLIENT = 'client-1';
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function channel(health: Awaited<ReturnType<typeof integrationHealth>>, id: string) {
  const found = health.find((c) => c.id === id);
  if (!found) throw new Error(`no channel ${id}`);
  return found;
}

beforeEach(() => {
  db.events = [];
});

describe('integration health', () => {
  it('reports never rather than failing when nothing has happened', async () => {
    const health = await integrationHealth(CLIENT);

    for (const c of health) {
      expect(c.status).toBe('never');
      expect(c.lastSuccessAt).toBeNull();
      // Never fabricate a zero or a timestamp for something that has not run.
      expect(c.lastFailureAt).toBeNull();
      expect(c.note).toBeTruthy();
    }
  });

  it('reports ok once something has succeeded', async () => {
    db.events.push({ client_id: CLIENT, event_type: 'call.started', created_at: iso(2 * HOUR) });

    expect(channel(await integrationHealth(CLIENT), 'telephony').status).toBe('ok');
  });

  it('reports failing when the last failure is newer than the last success', async () => {
    db.events.push(
      { client_id: CLIENT, event_type: 'crm.sync.completed', created_at: iso(2 * DAY) },
      { client_id: CLIENT, event_type: 'crm.sync.failed', created_at: iso(1 * HOUR) }
    );

    const crm = channel(await integrationHealth(CLIENT), 'crm');
    expect(crm.status).toBe('failing');
    expect(crm.lastSuccessAt).not.toBeNull();
  });

  it('goes back to ok when a success lands after the failure', async () => {
    db.events.push(
      { client_id: CLIENT, event_type: 'crm.sync.failed', created_at: iso(2 * DAY) },
      { client_id: CLIENT, event_type: 'crm.sync.completed', created_at: iso(1 * HOUR) }
    );

    expect(channel(await integrationHealth(CLIENT), 'crm').status).toBe('ok');
  });

  it('reports stalled when requests arrive and nothing ever completes', async () => {
    // The live case: booking.requested with no booking.confirmed. Nothing errors,
    // so nothing reaches the error console, and no appointment is ever made.
    db.events.push({ client_id: CLIENT, event_type: 'booking.requested', created_at: iso(3 * DAY) });

    const calendar = channel(await integrationHealth(CLIENT), 'calendar');
    expect(calendar.status).toBe('stalled');
    expect(calendar.note).toMatch(/going nowhere/i);
  });

  it('does not call a call in progress a stalled webhook', async () => {
    // A call that started a minute ago has legitimately not ended yet. Alerting
    // on that would fire during every normal call.
    db.events.push(
      { client_id: CLIENT, event_type: 'call.ended', created_at: iso(2 * HOUR) },
      { client_id: CLIENT, event_type: 'call.started', created_at: iso(60 * 1000) }
    );

    expect(channel(await integrationHealth(CLIENT), 'webhooks').status).toBe('ok');
  });

  it('does call a call that never ended a stalled webhook', async () => {
    db.events.push(
      { client_id: CLIENT, event_type: 'call.ended', created_at: iso(2 * DAY) },
      { client_id: CLIENT, event_type: 'call.started', created_at: iso(4 * HOUR) }
    );

    expect(channel(await integrationHealth(CLIENT), 'webhooks').status).toBe('stalled');
  });

  it('does not read another tenant’s events', async () => {
    db.events.push({ client_id: 'other', event_type: 'call.started', created_at: iso(HOUR) });

    expect(channel(await integrationHealth(CLIENT), 'telephony').status).toBe('never');
  });
});
