import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Phase F: traceability, exports, alerting, branding.
 *
 * The tests that matter here are the ones behind the rules the spec states as
 * guarantees — an insight that cannot be traced is dropped, an alert does not
 * nag, an accent cannot impersonate a status lamp. Each of those is a promise
 * the product makes, so each gets a test rather than a comment.
 */

const db = vi.hoisted(() => ({
  rules: [] as unknown[],
  events: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
  clientRow: { branding: {} } as Record<string, unknown>,
  rpc: {} as Record<string, unknown[]>,
  settings: { notification_emails: ['owner@example.com'] } as Record<string, unknown>,
  eventRows: [] as Array<{ event_type: string; created_at: string }>,
}));

const mail = vi.hoisted(() => ({ sent: [] as Record<string, unknown>[] }));

vi.mock('../db/index.js', () => {
  function builder(table: string) {
    const filters: Record<string, unknown> = {};
    let types: string[] = [];

    const api: Record<string, unknown> = {
      select: () => api,
      eq: (col: string, val: unknown) => {
        filters[col] = val;
        return api;
      },
      // integrationHealth reads the event stream through `.in(...).limit(1)`.
      in: (_col: string, values: string[]) => {
        types = values;
        return api;
      },
      gte: () => api,
      lte: () => api,
      order: () => api,
      limit: () => {
        if (table !== 'events') return api;
        const rows = db.eventRows
          .filter((e) => types.includes(e.event_type))
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
        return Promise.resolve({ data: rows.slice(0, 1), error: null });
      },
      maybeSingle: () => {
        if (table === 'clients') return Promise.resolve({ data: db.clientRow, error: null });
        if (table === 'client_settings') return Promise.resolve({ data: db.settings, error: null });
        return Promise.resolve({ data: null, error: null });
      },
      insert: (row: Record<string, unknown>) => {
        if (table === 'client_alert_events') db.events.push(row);
        return Promise.resolve({ data: null, error: null });
      },
      update: (row: Record<string, unknown>) => {
        db.updates.push({ table, ...row });
        return {
          eq: () => Promise.resolve({ data: null, error: null }),
        };
      },
      then: (resolve: (v: unknown) => unknown) => {
        const rows = table === 'client_alert_rules' ? db.rules : [];
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      },
    };
    return api;
  }

  return {
    supabase: {
      from: (table: string) => builder(table),
      rpc: (fn: string) => Promise.resolve({ data: db.rpc[fn] ?? [], error: null }),
    },
  };
});

vi.mock('../utils/index.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  sendMail: async (opts: Record<string, unknown>) => {
    mail.sent.push(opts);
  },
}));

vi.mock('../config/index.js', () => ({
  env: {
    EMAIL_FROM: 'noreply@gravvia.test',
    ALERT_EMAIL: 'ops@gravvia.test',
    DASHBOARD_URL: 'https://dash.test',
    SMTP_PASS: 'set',
  },
}));

const { takeTraceable } = await import('../ai/insights.service.js');
const { toCsv, buildExport } = await import('../services/export.service.js');
const { breaches, observe, evaluateAlerts } = await import('../services/alert.service.js');
type AlertRule = import('../services/alert.service.js').AlertRule;
const { assertAccentAllowed, validateBranding, hexToHsl, BrandingError } = await import(
  '../services/branding.service.js'
);

beforeEach(() => {
  db.rules = [];
  db.events = [];
  db.updates = [];
  db.rpc = {};
  db.clientRow = { branding: {} };
  mail.sent = [];
});

describe('AI traceability (§7.1)', () => {
  const valid = new Set(['call-1', 'call-2', 'call-3']);

  it('keeps an insight whose citations are real', () => {
    const { insights, dropped } = takeTraceable(
      [{ headline: 'Containment fell', detail: 'Four transfers about parking.', severity: 'act', call_ids: ['call-1', 'call-2'] }],
      valid
    );

    expect(dropped).toBe(0);
    expect(insights[0].callIds).toEqual(['call-1', 'call-2']);
  });

  it('drops an insight that cites nothing', () => {
    const { insights, dropped } = takeTraceable(
      [{ headline: 'Things feel worse', detail: 'Vibes.', severity: 'watch', call_ids: [] }],
      valid
    );

    expect(insights).toEqual([]);
    expect(dropped).toBe(1);
  });

  it('drops an insight that cites calls which do not exist', () => {
    // The case a non-empty check would miss entirely: a model returning a
    // plausible but invented id. The click-through would 404 and the claim
    // would be unfalsifiable.
    const { insights, dropped } = takeTraceable(
      [{ headline: 'Invented', detail: 'From a call that never happened.', severity: 'act', call_ids: ['call-999'] }],
      valid
    );

    expect(insights).toEqual([]);
    expect(dropped).toBe(1);
  });

  it('keeps the real citations from a partly-invented list', () => {
    const { insights } = takeTraceable(
      [{ headline: 'Mixed', detail: 'Three real, one not.', severity: 'watch', call_ids: ['call-1', 'call-999', 'call-3'] }],
      valid
    );

    // The observation about the real calls still stands; the link must only ever
    // offer the ones that resolve.
    expect(insights[0].callIds).toEqual(['call-1', 'call-3']);
  });

  it('de-duplicates citations', () => {
    const { insights } = takeTraceable(
      [{ headline: 'Dup', detail: 'x', severity: 'watch', call_ids: ['call-1', 'call-1'] }],
      valid
    );
    expect(insights[0].callIds).toEqual(['call-1']);
  });

  it('defaults an unknown severity to watch rather than act', () => {
    const { insights } = takeTraceable(
      [{ headline: 'x', detail: 'y', severity: 'catastrophic', call_ids: ['call-1'] }],
      valid
    );
    // Escalating on a value we do not recognise would train people to ignore
    // "act", which is the only severity that means anything.
    expect(insights[0].severity).toBe('watch');
  });
});

describe('CSV exports (§7.3)', () => {
  it('quotes separators, quotes and newlines', () => {
    const csv = toCsv(['a', 'b'], [['has,comma', 'has "quote"'], ['has\nnewline', 'plain']]);
    expect(csv).toContain('"has,comma"');
    expect(csv).toContain('"has ""quote"""');
    expect(csv).toContain('"has\nnewline"');
  });

  it('neutralises spreadsheet formula injection', () => {
    // A caller named =cmd|'/c calc'!A1 is executable when the CSV is opened in
    // Excel. The export is exactly where user-supplied text meets a spreadsheet.
    const csv = toCsv(['name'], [['=1+1']]);
    expect(csv).toContain("'=1+1");
    for (const dangerous of ['+A1', '-A1', '@SUM(A1)']) {
      expect(toCsv(['x'], [[dangerous]])).toContain(`'${dangerous}`);
    }
  });

  it('writes a BOM so Excel reads it as UTF-8', () => {
    expect(toCsv(['a'], [['é']]).charCodeAt(0)).toBe(0xfeff);
  });

  it('renders null as empty, not as the string "null"', () => {
    expect(toCsv(['a', 'b'], [[null, undefined]])).toContain('\r\n,\r\n');
  });

  it('leaves an unpriced service blank rather than zero', async () => {
    db.rpc.report_call_reasons = [];
    db.rpc.report_referrals = [];
    db.rpc.report_lost_demand = [{ service: 'massage', requests: 3, estimated_value: null }];

    const result = await buildExport('demand', { clientId: 'c1', from: 'a', to: 'b' });
    // A spreadsheet of zeroes sums to a number someone will quote back at us.
    // The category is quoted because it contains a comma — that is the escaping
    // working, and the trailing empty field is the point of the test.
    expect(result.csv).toContain('"Requested, not offered",massage,3,\r\n');
  });
});

describe('threshold alerting (§7.2)', () => {
  const rule = (over: Partial<AlertRule> = {}): AlertRule => ({
    id: 'r1',
    client_id: 'c1',
    metric: 'containment_drop',
    threshold: 70,
    window_minutes: 1440,
    cooldown_minutes: 1440,
    enabled: true,
    recipients: [],
    last_fired_at: null,
    ...over,
  });

  it('fires when a below-metric drops under its threshold', () => {
    expect(breaches(rule(), { value: 55, sample: 40 })).toBe(true);
  });

  it('does not fire on a healthy figure', () => {
    expect(breaches(rule(), { value: 82, sample: 40 })).toBe(false);
  });

  it('stays quiet below the minimum sample', () => {
    // One transfer out of two calls is 50% containment and means nothing. A rule
    // that fires on a slow morning gets switched off, and then it protects
    // nothing at all.
    expect(breaches(rule(), { value: 50, sample: 2 })).toBe(false);
  });

  it('never treats "not measured" as a breach', () => {
    expect(breaches(rule(), { value: null, sample: 0 })).toBe(false);
  });

  it('fires when an above-metric exceeds its threshold', () => {
    expect(breaches(rule({ metric: 'escalation_spike', threshold: 10 }), { value: 14, sample: 40 })).toBe(true);
    expect(breaches(rule({ metric: 'escalation_spike', threshold: 10 }), { value: 4, sample: 40 })).toBe(false);
  });

  it('counts failing and stalled integrations, but not unused ones', async () => {
    // `never` is not a fault. Counting it would fire for every new tenant on
    // their first day, about integrations they have not connected yet.
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
    db.eventRows = [
      // CRM: succeeded once, failed since ⇒ failing.
      { event_type: 'crm.sync.completed', created_at: hoursAgo(48) },
      { event_type: 'crm.sync.failed', created_at: hoursAgo(1) },
      // Calendar: requests, never a confirmation ⇒ stalled.
      { event_type: 'booking.requested', created_at: hoursAgo(72) },
      // Telephony and webhooks: no events at all ⇒ never, and not counted.
    ];

    const result = await observe(rule({ metric: 'integration_down', threshold: 0 }));
    expect(result.value).toBe(2);
  });

  it('reports containment as null when there were no calls', async () => {
    db.rpc.report_trust = [{ total_calls: 0, transferred_calls: 0 }];
    expect((await observe(rule())).value).toBeNull();
  });

  it('emails on a breach and records what it sent', async () => {
    db.rules = [rule()];
    db.rpc.report_trust = [{ total_calls: 40, transferred_calls: 20 }];

    const result = await evaluateAlerts(new Date('2026-08-09T12:00:00Z'));

    expect(result.fired).toBe(1);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe('owner@example.com');
    expect(db.events[0]).toMatchObject({ metric: 'containment_drop', observed: 50, threshold: 70, notified: true });
  });

  it('does not nag: a rule inside its cooldown is skipped', async () => {
    // The single most important behaviour in the alerting loop. An email every
    // five minutes gets the sender filtered, and a filtered alert is worse than
    // none because everyone believes it is switched on.
    db.rules = [rule({ last_fired_at: '2026-08-09T11:30:00Z', cooldown_minutes: 1440 })];
    db.rpc.report_trust = [{ total_calls: 40, transferred_calls: 20 }];

    const result = await evaluateAlerts(new Date('2026-08-09T12:00:00Z'));

    expect(result.evaluated).toBe(0);
    expect(mail.sent).toHaveLength(0);
  });

  it('fires again once the cooldown has passed', async () => {
    db.rules = [rule({ last_fired_at: '2026-08-08T11:00:00Z', cooldown_minutes: 60 })];
    db.rpc.report_trust = [{ total_calls: 40, transferred_calls: 20 }];

    expect((await evaluateAlerts(new Date('2026-08-09T12:00:00Z'))).fired).toBe(1);
  });

  it('stamps last_fired_at even when the condition persists', async () => {
    db.rules = [rule()];
    db.rpc.report_trust = [{ total_calls: 40, transferred_calls: 20 }];

    await evaluateAlerts(new Date('2026-08-09T12:00:00Z'));
    expect(db.updates.some((u) => u.table === 'client_alert_rules' && u.last_fired_at)).toBe(true);
  });
});

describe('white-label branding (§7.4)', () => {
  it('rejects an accent in the good lamp hue range', () => {
    // The whole rule in one test: chroma on this surface means state, and a
    // green accent turns every branded control into a status claim.
    expect(() => assertAccentAllowed('#1FA35F')).toThrow(BrandingError);
    expect(() => assertAccentAllowed('#2ECC71')).toThrow(BrandingError);
  });

  it('rejects amber and red accents too', () => {
    expect(() => assertAccentAllowed('#E0921A')).toThrow(BrandingError);
    expect(() => assertAccentAllowed('#DC3B30')).toThrow(BrandingError);
    // Wrapping band: 350° is red even though it is numerically above the range.
    expect(() => assertAccentAllowed('#E01050')).toThrow(BrandingError);
  });

  it('explains itself rather than just refusing', () => {
    try {
      assertAccentAllowed('#1FA35F');
      expect.unreachable('should have thrown');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toMatch(/good, fair and bad/);
      // Refusing without offering an alternative is how a client concludes the
      // product cannot do it.
      expect(message).toMatch(/blues, teals, purples/);
    }
  });

  it('accepts blues, teals and purples', () => {
    for (const hex of ['#2F6FED', '#0F766E', '#7C3AED', '#DB2777']) {
      expect(() => assertAccentAllowed(hex)).not.toThrow();
    }
  });

  it('accepts near-greys whatever their hue', () => {
    // A charcoal with a faint green cast cannot read as a lamp, and telling a
    // client their black is too green would be absurd.
    expect(() => assertAccentAllowed('#2C302E')).not.toThrow();
  });

  it('rejects a malformed hex with a usable message', () => {
    expect(() => assertAccentAllowed('not-a-colour')).toThrow(/6-digit hex/);
  });

  it('refuses a logo that is not https', () => {
    expect(() => validateBranding({ logo_url: 'javascript:alert(1)' })).toThrow(BrandingError);
    expect(() => validateBranding({ logo_url: 'http://example.com/logo.png' })).toThrow(/https/);
    expect(() => validateBranding({ logo_url: 'https://example.com/logo.png' })).not.toThrow();
  });

  it('normalises a hex without its hash and truncates a long wordmark', () => {
    const result = validateBranding({ primary_hex: '2F6FED', wordmark_text: 'x'.repeat(80) });
    expect(result.primary_hex).toBe('#2F6FED');
    expect(result.wordmark_text).toHaveLength(40);
  });

  it('converts hex to hue correctly at the boundaries', () => {
    expect(Math.round(hexToHsl('#FF0000')!.h)).toBe(0);
    expect(Math.round(hexToHsl('#00FF00')!.h)).toBe(120);
    expect(Math.round(hexToHsl('#0000FF')!.h)).toBe(240);
    expect(hexToHsl('nope')).toBeNull();
  });
});
