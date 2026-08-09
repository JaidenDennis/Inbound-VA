import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `withAudit` itself (spec §2.5).
 *
 * `audit-coverage.test.ts` checks that the configure routes GO THROUGH this
 * wrapper. This checks the wrapper does what going through it is supposed to
 * buy — in particular the ordering, which is the part that is easy to get
 * subtly wrong and impossible to notice afterwards.
 */

const db = vi.hoisted(() => ({
  audits: [] as Record<string, unknown>[],
  failInsert: false,
}));

vi.mock('../db/index.js', () => ({
  supabase: {
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        if (db.failInsert) return Promise.reject(new Error('audit table unavailable'));
        db.audits.push(row);
        return Promise.resolve({ data: null, error: null });
      },
    }),
  },
}));

const loggerCalls = vi.hoisted(() => ({ errors: [] as unknown[] }));
vi.mock('../utils/index.js', () => ({
  logger: {
    error: (...args: unknown[]) => loggerCalls.errors.push(args),
    warn: () => {},
    info: () => {},
    debug: () => {},
  },
}));

const { withAudit, auditTranscriptView } = await import('../services/audit.service.js');

const actor = { userId: 'u1', clientId: 'c1', ipAddress: '10.0.0.1', userAgent: 'vitest' };

beforeEach(() => {
  db.audits = [];
  db.failInsert = false;
  loggerCalls.errors = [];
});

describe('withAudit', () => {
  it('records both sides of the change', async () => {
    await withAudit({
      actor,
      action: 'agent.config.updated',
      entityType: 'client',
      entityId: 'c1',
      before: async () => ({ tone: 'warm' }),
      mutate: async () => ({ tone: 'formal' }),
    });

    expect(db.audits).toHaveLength(1);
    expect(db.audits[0]).toMatchObject({
      user_id: 'u1',
      client_id: 'c1',
      action: 'agent.config.updated',
      entity_type: 'client',
      entity_id: 'c1',
      old_value: { tone: 'warm' },
      new_value: { tone: 'formal' },
      ip_address: '10.0.0.1',
    });
  });

  it('reads the prior state before mutating, not after', async () => {
    // Get this backwards and every audit row says the change changed nothing —
    // which looks fine on a dashboard and is worthless in an investigation.
    const order: string[] = [];

    await withAudit({
      actor,
      action: 'x',
      entityType: 'client',
      before: async () => {
        order.push('before');
        return { v: 1 };
      },
      mutate: async () => {
        order.push('mutate');
        return { v: 2 };
      },
    });

    expect(order).toEqual(['before', 'mutate']);
  });

  it('returns whatever the mutation returned', async () => {
    const result = await withAudit({
      actor,
      action: 'x',
      entityType: 'client',
      before: async () => null,
      mutate: async () => ({ id: 'new-row' }),
    });

    expect(result).toEqual({ id: 'new-row' });
  });

  it('does not run the mutation if reading the prior state throws', async () => {
    const mutate = vi.fn();

    await expect(
      withAudit({
        actor,
        action: 'x',
        entityType: 'client',
        before: async () => {
          throw new Error('read failed');
        },
        mutate,
      })
    ).rejects.toThrow('read failed');

    expect(mutate).not.toHaveBeenCalled();
  });

  it('keeps a successful mutation when the audit write fails, and says so loudly', async () => {
    // Deliberate: silently reverting a config change the operator watched
    // succeed is worse than a gap in the log, and the gap is detectable.
    db.failInsert = true;

    const result = await withAudit({
      actor,
      action: 'x',
      entityType: 'client',
      before: async () => ({ v: 1 }),
      mutate: async () => ({ v: 2 }),
    });

    expect(result).toEqual({ v: 2 });
    expect(loggerCalls.errors).toHaveLength(1);
  });

  it('does not swallow a failed mutation', async () => {
    await expect(
      withAudit({
        actor,
        action: 'x',
        entityType: 'client',
        before: async () => ({ v: 1 }),
        mutate: async () => {
          throw new Error('update rejected');
        },
      })
    ).rejects.toThrow('update rejected');

    expect(db.audits).toHaveLength(0);
  });
});

describe('auditTranscriptView', () => {
  it('records the access with no before/after', async () => {
    await auditTranscriptView(actor, 'transcript-9', 'call-9');

    expect(db.audits[0]).toMatchObject({
      action: 'transcript.view',
      entity_type: 'call_transcripts',
      entity_id: 'transcript-9',
      old_value: null,
      new_value: { call_id: 'call-9' },
      user_id: 'u1',
    });
  });
});
