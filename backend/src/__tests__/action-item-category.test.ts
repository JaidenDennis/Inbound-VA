import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Onboarding showed operational work.
 *
 * `client_action_items` has carried every kind of task since migration 008, and
 * the Onboarding page listed the table unfiltered. So a follow-up raised months
 * after go-live appeared under "Onboarding", and the Work Queue — where it
 * belonged — never showed it at all.
 *
 * Migration 033 adds `category`, defaulting to 'operations', because onboarding
 * is the narrow bounded case and everything else is ongoing work.
 */

const rows: Array<Record<string, unknown>> = [];
let lastInsert: Record<string, unknown> | null = null;

/**
 * A supabase-shaped stub. `.eq()` accumulates filters and the thenable applies
 * them, so the test asserts on what the SERVICE asked for rather than on a
 * hand-written mock's opinion of the answer.
 */
function makeQuery(table: string) {
  const filters: Array<[string, unknown]> = [];
  const q: Record<string, unknown> = {
    select: () => q,
    order: () => q,
    eq: (col: string, val: unknown) => {
      filters.push([col, val]);
      return q;
    },
    maybeSingle: async () => ({ data: rows[0] ?? null }),
    single: async () => ({ data: lastInsert, error: null }),
    insert: (payload: Record<string, unknown>) => {
      lastInsert = payload;
      return q;
    },
    update: () => q,
    then: (resolve: (r: { data: unknown }) => void) => {
      const out = rows.filter((r) =>
        filters.every(([col, val]) => r[col] === val)
      );
      resolve({ data: out });
    },
    __filters: filters,
    __table: table,
  };
  return q;
}

const queries: Array<Record<string, unknown>> = [];

vi.mock('../db/index.js', () => ({
  supabase: {
    from: (table: string) => {
      const q = makeQuery(table);
      queries.push(q);
      return q;
    },
  },
}));

const { actionItemService } = await import('../services/actionItem.service.js');

beforeEach(() => {
  rows.length = 0;
  queries.length = 0;
  lastInsert = null;
});

describe('listForClient', () => {
  it('filters to one category when asked', async () => {
    rows.push(
      { id: '1', client_id: 'c1', category: 'onboarding', title: 'Connect your CRM' },
      { id: '2', client_id: 'c1', category: 'operations', title: 'Call back Mrs Patel' }
    );

    const out = await actionItemService.listForClient('c1', 'onboarding');

    expect(out.map((i) => i.id)).toEqual(['1']);
  });

  it('returns every category when none is named, so existing callers are unchanged', async () => {
    rows.push(
      { id: '1', client_id: 'c1', category: 'onboarding' },
      { id: '2', client_id: 'c1', category: 'operations' }
    );

    const out = await actionItemService.listForClient('c1');

    expect(out.map((i) => i.id)).toEqual(['1', '2']);
  });

  it('always scopes to the client, category or not', async () => {
    rows.push({ id: '1', client_id: 'c1', category: 'operations' });
    await actionItemService.listForClient('c1', 'operations');

    const filters = queries[0].__filters as Array<[string, unknown]>;
    expect(filters).toContainEqual(['client_id', 'c1']);
  });
});

describe('create', () => {
  it('writes the category it is given', async () => {
    await actionItemService.create({
      clientId: 'c1',
      title: 'Record your voicemail greeting',
      createdBy: 'u1',
      category: 'onboarding',
    });

    expect(lastInsert).toMatchObject({ category: 'onboarding' });
  });

  it('defaults to operations, matching the column default', async () => {
    await actionItemService.create({ clientId: 'c1', title: 'Follow up', createdBy: 'u1' });

    expect(lastInsert).toMatchObject({ category: 'operations' });
  });
});
