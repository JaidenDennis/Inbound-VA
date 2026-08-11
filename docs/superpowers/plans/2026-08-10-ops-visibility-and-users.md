# Ops Visibility and User Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make email failures visible instead of silent, let Sentry issues be reached from the dashboard error console, and complete user editing (email, self-service, self-role guard).

**Architecture:** Three independent slices of the 2026-08-10 design spec — W6 (email visibility), W7 (Sentry correlation) and W5 (users). All three are additive: two small migrations, one utility change, and route/UI work. Nothing here changes call handling, queues, or agent provisioning.

**Tech Stack:** Node 22, TypeScript, Fastify 5, Supabase Postgres, Zod, Vitest, Next.js 16 + Tailwind (dashboard).

## Global Constraints

- Source spec: `docs/superpowers/specs/2026-08-10-dashboard-fixes-and-features-design.md`.
- Migrations continue from **029**. `028` is applied in production — never edit an applied migration.
- Every migration ships a matching file in `supabase/rollbacks/<same-name>_rollback.sql`.
- Migrations 011+ must be idempotent (`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `DROP POLICY IF EXISTS`).
- Apply migrations with `npx supabase db query --linked -f <path>`, then record the version:
  `INSERT INTO schema_migrations (version) VALUES ('0NN') ON CONFLICT (version) DO NOTHING;`
  The root `DATABASE_URL` password is stale, so `npm run migrate` and raw `pg` fail with 28P01.
- Run backend checks from `backend/`: `npx vitest run`, `npx tsc --noEmit`, `npx eslint src`.
- Three lint errors pre-exist in `action-items.route.ts`, `knowledge.route.ts` and `export.service.ts`. Do not fix them here; do not add new ones.
- Never use a bare `vi.fn()` as a Fastify `preHandler` in tests — Fastify reads its arity as callback-style and hangs the request forever. Use `async (_req: unknown, _reply: unknown) => undefined`.
- Test count at plan time: **814 passing across 57 files**. Each task should only increase it.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/029_email_error_source.sql` | Allow `'email'` in the `system_errors.source` CHECK |
| `supabase/migrations/030_sentry_event_id.sql` | Add `system_errors.sentry_event_id` |
| `backend/src/services/systemError.service.ts` | Accept + persist `sentryEventId`; `ErrorSource` gains `'email'` |
| `backend/src/utils/sentry.ts` | `captureException` returns Sentry's event id |
| `backend/src/utils/mailer.ts` | Report unconfigured SMTP once; report every send failure |
| `backend/src/dashboard-api/users.route.ts` | Email editing, duplicate 409, self-role guard, `PATCH /me` |
| `dashboard/src/app/dashboard/users/page.tsx` | Inline edit row |
| `dashboard/src/app/dashboard/system/page.tsx` | Sentry deep-link on error rows |

**Design note (refines the spec):** the spec said email status would feed `integrationHealth`. It should not. `integrationHealth` is per-client and derived from the normalised event stream; SMTP is a single platform-level credential with no per-client events. Email status therefore lives in `system_errors` (source `'email'`), which `/dashboard/system` already renders platform-wide. This is the only intentional divergence from the spec.

---

### Task 1: `system_errors` accepts an `email` source

**Files:**
- Create: `supabase/migrations/029_email_error_source.sql`
- Create: `supabase/rollbacks/029_email_error_source_rollback.sql`
- Modify: `backend/src/services/systemError.service.ts:6` (the `ErrorSource` type)
- Test: none of its own. This task widens a CHECK constraint and a union type; both are verified by Step 4 against the live database and Step 6 by the compiler. Task 2 is what exercises the new source at runtime.

**Interfaces:**
- Consumes: nothing.
- Produces: `ErrorSource` now includes `'email'`. Task 2 records errors with `source: 'email'`.

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================
-- GRAVVIA ENGAGE – allow 'email' as a system_errors source
-- Run order: 029  (NEVER edit earlier migrations)
--
-- Migration 017 fixed the source CHECK at ('api','worker','webhook','startup').
-- Mail delivery is none of those: sendMail is called from routes AND workers,
-- and its failures are a property of one platform-level credential rather than
-- of whichever process happened to make the call. Filing them under 'worker'
-- would scatter one outage across two sources in the console.
--
-- Rollback: supabase/rollbacks/029_email_error_source_rollback.sql
-- ============================================================

ALTER TABLE system_errors DROP CONSTRAINT IF EXISTS system_errors_source_check;

ALTER TABLE system_errors
  ADD CONSTRAINT system_errors_source_check
  CHECK (source IN ('api', 'worker', 'webhook', 'startup', 'email'));
```

- [ ] **Step 2: Write the rollback**

```sql
-- Rollback for 029_email_error_source.sql
--
-- Rows with source='email' must go first or the tightened constraint cannot be
-- validated. They are diagnostic records, so deleting them loses no business data.

DELETE FROM system_errors WHERE source = 'email';

ALTER TABLE system_errors DROP CONSTRAINT IF EXISTS system_errors_source_check;

ALTER TABLE system_errors
  ADD CONSTRAINT system_errors_source_check
  CHECK (source IN ('api', 'worker', 'webhook', 'startup'));
```

- [ ] **Step 3: Apply the migration and record it**

```bash
npx supabase db query --linked -f supabase/migrations/029_email_error_source.sql
npx supabase db query --linked "INSERT INTO schema_migrations (version) VALUES ('029') ON CONFLICT (version) DO NOTHING;"
```

Expected: both return `"rows": []` with no error.

- [ ] **Step 4: Verify the constraint accepts the new value**

```bash
npx supabase db query --linked "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'system_errors_source_check';"
```

Expected: the definition lists `'email'`.

- [ ] **Step 5: Widen the `ErrorSource` type**

In `backend/src/services/systemError.service.ts`, find the `ErrorSource` type and add `'email'`:

```typescript
export type ErrorSource = 'api' | 'worker' | 'webhook' | 'startup' | 'email';
```

- [ ] **Step 6: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/029_email_error_source.sql supabase/rollbacks/029_email_error_source_rollback.sql backend/src/services/systemError.service.ts
git commit -m "feat(errors): allow 'email' as a system_errors source"
```

---

### Task 2: `sendMail` stops failing silently

**Files:**
- Modify: `backend/src/utils/mailer.ts`
- Test: `backend/src/__tests__/mailer-visibility.test.ts` (create)

**Interfaces:**
- Consumes: `ErrorSource` including `'email'` (Task 1); `systemErrorService.record` from `backend/src/services/systemError.service.ts`.
- Produces: `sendMail(opts)` keeps its `Promise<void>` signature and still never throws on an unconfigured transport, so no existing caller changes.

**Why this shape:** `sendMail` is called from queue workers whose jobs must still complete, and from `alertService.evaluateAlerts()` which must keep recording `client_alert_events` even when mail is dead. So it must not start throwing. It must, however, leave a record. Unconfigured SMTP warns **once per process** (a per-send row would bury the console under one row per notification); a genuine send failure records **every time**, because those are real incidents.

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/mailer-visibility.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const recorded = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }));
vi.mock('../services/systemError.service.js', () => ({
  systemErrorService: {
    record: vi.fn(async (input: Record<string, unknown>) => {
      recorded.calls.push(input);
      return 'err-1';
    }),
  },
}));

const transport = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock('nodemailer', () => ({
  default: { createTransport: () => transport },
  createTransport: () => transport,
}));

describe('sendMail visibility', () => {
  beforeEach(() => {
    recorded.calls.length = 0;
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('records ONE warning per process when SMTP is unconfigured, not one per send', async () => {
    vi.stubEnv('SMTP_PASS', '');
    const { sendMail, __resetMailerWarning } = await import('../utils/mailer.js');
    __resetMailerWarning();

    await sendMail({ to: 'a@example.com', subject: 'one' });
    await sendMail({ to: 'b@example.com', subject: 'two' });
    await sendMail({ to: 'c@example.com', subject: 'three' });

    expect(recorded.calls).toHaveLength(1);
    expect(recorded.calls[0]).toMatchObject({ source: 'email', severity: 'warn' });
    // Still a no-op: callers must not fail because mail is unconfigured.
    expect(transport.sendMail).not.toHaveBeenCalled();
  });

  it('records EVERY send failure, and still does not throw', async () => {
    vi.stubEnv('SMTP_PASS', 'a-real-looking-key');
    transport.sendMail.mockRejectedValue(
      new Error('Invalid login: 535 Authentication failed')
    );
    const { sendMail, __resetMailerWarning } = await import('../utils/mailer.js');
    __resetMailerWarning();

    await expect(sendMail({ to: 'a@example.com', subject: 'one' })).resolves.toBeUndefined();
    await expect(sendMail({ to: 'b@example.com', subject: 'two' })).resolves.toBeUndefined();

    expect(recorded.calls).toHaveLength(2);
    expect(recorded.calls[0]).toMatchObject({ source: 'email', severity: 'error' });
    expect(String((recorded.calls[0].error as Error).message)).toContain('535');
  });

  it('records nothing when the send succeeds', async () => {
    vi.stubEnv('SMTP_PASS', 'a-real-looking-key');
    transport.sendMail.mockResolvedValue({ messageId: 'x' });
    const { sendMail, __resetMailerWarning } = await import('../utils/mailer.js');
    __resetMailerWarning();

    await sendMail({ to: 'a@example.com', subject: 'one' });

    expect(recorded.calls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd backend && npx vitest run src/__tests__/mailer-visibility.test.ts`
Expected: FAIL — `__resetMailerWarning` is not exported, and no `systemErrorService.record` calls are made.

- [ ] **Step 3: Implement**

Replace the body of `backend/src/utils/mailer.ts` below the `transport` definition with:

```typescript
/**
 * Has the "SMTP is not configured" warning already been recorded this process?
 *
 * One row, not one per send. Every queued notification, every alert and every
 * SLA breach calls sendMail; recording each skip would push a hundred identical
 * rows into the console and bury the incidents that matter.
 */
let unconfiguredReported = false;

/** Test seam — lets a test observe first-call behaviour more than once. */
export function __resetMailerWarning(): void {
  unconfiguredReported = false;
}

/**
 * Send an email.
 *
 * Never throws. sendMail is called from queue workers whose jobs must still
 * complete and from alert evaluation that must still record its events, so a
 * dead mailer must not cascade. What changed is that it is no longer SILENT:
 * an unconfigured transport and a failing one both leave a system_errors row,
 * visible at /dashboard/system.
 *
 * This distinction is the whole point. Before, `SMTP_PASS` unset made this a
 * logged no-op, so "the client never got the alert" and "everything is fine"
 * looked identical from the dashboard.
 */
export async function sendMail(opts: SendMailOptions): Promise<void> {
  if (!SMTP_CONFIGURED) {
    logger.warn({ to: opts.to, subject: opts.subject }, 'SMTP not configured (SMTP_PASS unset) — email skipped');
    if (!unconfiguredReported) {
      unconfiguredReported = true;
      void systemErrorService.record({
        source: 'email',
        severity: 'warn',
        error: {
          name: 'SmtpNotConfigured',
          message:
            'SMTP_PASS is unset, so no email is being sent. Notifications, client alerts and SLA breach emails are all being skipped.',
        },
        context: { host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER },
      });
    }
    return;
  }

  try {
    await transport.sendMail(opts);
  } catch (err) {
    logger.error({ err, to: opts.to, subject: opts.subject }, 'Email send failed');
    void systemErrorService.record({
      source: 'email',
      severity: 'error',
      error: err as Error,
      // Recipients are deliberately omitted: they are personal data and the
      // subject is enough to identify which send failed.
      context: { subject: String(opts.subject ?? ''), host: env.SMTP_HOST },
    });
  }
}
```

Add the import at the top of the file:

```typescript
import { systemErrorService } from '../services/systemError.service.js';
```

- [ ] **Step 4: Run the test**

Run: `cd backend && npx vitest run src/__tests__/mailer-visibility.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Break the import cycle this creates (REQUIRED — not a contingency)**

Adding that import closes a real loop:

```
mailer.ts  →  systemError.service.ts  →  utils/index.ts  →  mailer.ts
                                          (line 5: export { sendMail } from './mailer.js')
```

`systemError.service.ts:3` imports `logger` from the `utils` **barrel**, and that barrel re-exports `sendMail`. Under ESM this resolves without a hard crash, but `mailer.ts`'s module-scope `SMTP_CONFIGURED` and `transport` can be evaluated while the graph is half-initialised, which is exactly the kind of order-dependent bug that appears only in one process and not the other.

Break it at the barrel. In `backend/src/services/systemError.service.ts:3`, change:

```typescript
import { logger } from '../utils/index.js';
```

to:

```typescript
import { logger } from '../utils/logger.js';
```

`redact.js` on the next line is already imported by direct path, so this makes the file consistent as well as acyclic. Keep `mailer.ts` importing `systemErrorService` from `'../services/systemError.service.js'` directly — never from `../services/index.js`, which would reintroduce a barrel edge.

- [ ] **Step 5b: Verify**

Run: `cd backend && npx tsc --noEmit && npx vitest run`
Expected: exit 0; **817 tests passing** (814 + 3).

- [ ] **Step 6: Commit**

```bash
git add backend/src/utils/mailer.ts backend/src/__tests__/mailer-visibility.test.ts
git commit -m "feat(email): surface unconfigured and failing SMTP in the error console"
```

---

### Task 3: Record the Sentry event id on each error

**Files:**
- Create: `supabase/migrations/030_sentry_event_id.sql`
- Create: `supabase/rollbacks/030_sentry_event_id_rollback.sql`
- Modify: `backend/src/utils/sentry.ts`
- Modify: `backend/src/services/systemError.service.ts`
- Test: `backend/src/__tests__/sentry-correlation.test.ts` (create)

**Interfaces:**
- Consumes: `RecordErrorInput` from `systemError.service.ts`.
- Produces:
  - `captureException(err: unknown, context?: Record<string, unknown>): string | null` — now **returns** Sentry's event id, or `null` when Sentry is disabled.
  - `RecordErrorInput` gains optional `sentryEventId?: string | null`.
  - `system_errors.sentry_event_id TEXT` — read by Task 4's UI.

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================
-- GRAVVIA ENGAGE – correlate system_errors with Sentry issues
-- Run order: 030  (NEVER edit earlier migrations)
--
-- The console at /dashboard/system and Sentry have always described the same
-- incidents with no way to get from one to the other. Storing the event id
-- Sentry returns from captureException makes each console row a link.
--
-- Deliberately a plain nullable TEXT: Sentry is optional (SENTRY_DSN unset is a
-- supported deployment), so NULL is the normal state, not a defect.
--
-- Rollback: supabase/rollbacks/030_sentry_event_id_rollback.sql
-- ============================================================

ALTER TABLE system_errors ADD COLUMN IF NOT EXISTS sentry_event_id TEXT;
```

- [ ] **Step 2: Write the rollback**

```sql
-- Rollback for 030_sentry_event_id.sql
ALTER TABLE system_errors DROP COLUMN IF EXISTS sentry_event_id;
```

- [ ] **Step 3: Apply and record**

```bash
npx supabase db query --linked -f supabase/migrations/030_sentry_event_id.sql
npx supabase db query --linked "INSERT INTO schema_migrations (version) VALUES ('030') ON CONFLICT (version) DO NOTHING;"
```

Expected: both return `"rows": []`.

- [ ] **Step 4: Write the failing test**

Create `backend/src/__tests__/sentry-correlation.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(() => 'abc123eventid'),
}));
vi.mock('@sentry/node', () => sentry);

describe('sentry correlation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns null when Sentry is not initialised, without calling the SDK', async () => {
    const { captureException } = await import('../utils/sentry.js');
    expect(captureException(new Error('boom'))).toBeNull();
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('returns the event id once initialised', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://example@o0.ingest.sentry.io/0');
    vi.resetModules();
    const { initSentry, captureException } = await import('../utils/sentry.js');
    initSentry('api');

    expect(captureException(new Error('boom'), { clientId: 'c-1' })).toBe('abc123eventid');
    expect(sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ extra: { clientId: 'c-1' } })
    );
  });
});
```

- [ ] **Step 5: Run it and confirm it fails**

Run: `cd backend && npx vitest run src/__tests__/sentry-correlation.test.ts`
Expected: FAIL — `captureException` currently returns `void`, so `toBeNull()` and `toBe('abc123eventid')` both fail.

- [ ] **Step 6: Make `captureException` return the id**

Replace `captureException` in `backend/src/utils/sentry.ts`:

```typescript
/**
 * Report an error to Sentry if enabled; safe no-op otherwise.
 *
 * Returns the Sentry event id so the caller can store it. That id is the only
 * thing that ties a row in our own error console to the issue in Sentry, and it
 * is available exactly once — at capture time.
 */
export function captureException(err: unknown, context?: Record<string, unknown>): string | null {
  if (!enabled) return null;
  return Sentry.captureException(err, context ? { extra: context } : undefined) ?? null;
}
```

- [ ] **Step 7: Persist it**

In `backend/src/services/systemError.service.ts`, add to `RecordErrorInput`:

```typescript
  /** Sentry's id for the same incident, when Sentry is enabled. */
  sentryEventId?: string | null;
```

and add to the `.insert({ ... })` object in `record()`:

```typescript
          sentry_event_id: input.sentryEventId ?? null,
```

- [ ] **Step 8: Pass it through at the capture sites**

In `backend/src/workers/failure-alerts.ts`, the existing call is:

```typescript
  captureException(err, { queue: queueName, jobId: job.id, jobData: job.data });
```

Change it to capture the id and forward it to the `systemErrorService.record(...)` call in the same function:

```typescript
  const sentryEventId = captureException(err, {
    queue: queueName,
    jobId: job.id,
    jobData: job.data,
  });
```

then add `sentryEventId,` to that function's `systemErrorService.record({ ... })` argument object.

- [ ] **Step 9: Run the full suite**

Run: `cd backend && npx vitest run && npx tsc --noEmit`
Expected: exit 0; **819 tests passing** (817 + 2).

- [ ] **Step 10: Commit**

```bash
git add supabase/migrations/030_sentry_event_id.sql supabase/rollbacks/030_sentry_event_id_rollback.sql backend/src/utils/sentry.ts backend/src/services/systemError.service.ts backend/src/workers/failure-alerts.ts backend/src/__tests__/sentry-correlation.test.ts
git commit -m "feat(errors): record the Sentry event id alongside each system error"
```

---

### Task 4: Link console rows to Sentry

**Files:**
- Modify: `backend/src/dashboard-api/system.route.ts` (add the column to the select)
- Modify: `dashboard/src/app/dashboard/system/page.tsx`

**Interfaces:**
- Consumes: `system_errors.sentry_event_id` (Task 3).
- Produces: no new backend contract beyond the extra field on the existing errors payload.

**Important — the console groups by fingerprint.** `/system/errors` (`system.route.ts:84-137`) selects up to 2000 rows and collapses them into one entry per `fingerprint`, counting occurrences. So a group is many events, and there is no single event id for it.

This mirrors Sentry's own model — a group is an *issue*, each row an *event* — so the correct thing to surface is the **most recent occurrence's** event id. `/system/errors/:id` already does `select('*')` and needs no change.

- [ ] **Step 1: Add the column to the list select**

In `backend/src/dashboard-api/system.route.ts:85`, change:

```typescript
        .select('fingerprint, error_name, message, route, source, severity, client_id, occurred_at, ticket_id')
```

to:

```typescript
        .select('fingerprint, error_name, message, route, source, severity, client_id, occurred_at, ticket_id, sentry_event_id')
```

Note: `supabase-select-columns.test.ts` parses these select strings against the migrations, so a typo here fails the suite rather than production. That test is the reason this step is safe.

- [ ] **Step 1b: Carry the latest event id through the grouping**

In the same handler, add the field to the `Row` type:

```typescript
        ticket_id: string | null; sentry_event_id: string | null;
```

add it to the `groups` map value type:

```typescript
        firstSeen: string; lastSeen: string; ticketId: string | null; latestSentryEventId: string | null;
```

in the **existing-group** branch, update it only when this row is newer than the current latest — the same comparison already used for `lastSeen`, and it must be done *before* `lastSeen` is reassigned:

```typescript
        if (existing) {
          existing.count += 1;
          if (row.occurred_at < existing.firstSeen) existing.firstSeen = row.occurred_at;
          if (row.occurred_at > existing.lastSeen) {
            existing.lastSeen = row.occurred_at;
            existing.latestSentryEventId = row.sentry_event_id;
          }
          if (row.client_id) existing.clientIds.add(row.client_id);
          existing.ticketId ??= row.ticket_id;
        }
```

and in the **new-group** branch add:

```typescript
            latestSentryEventId: row.sentry_event_id,
```

- [ ] **Step 2: Run the select-columns guard**

Run: `cd backend && npx vitest run src/__tests__/supabase-select-columns.test.ts`
Expected: PASS.

- [ ] **Step 3: Render the link**

In `dashboard/src/app/dashboard/system/page.tsx`, add `latestSentryEventId: string | null;` to the error-group interface, then render a link in each group row. Sentry issue URLs are org-scoped, so use the search-by-id form, which resolves for any org:

```tsx
{group.latestSentryEventId && (
  <a
    href={`https://sentry.io/issues/?query=${encodeURIComponent(group.latestSentryEventId)}`}
    target="_blank"
    rel="noopener noreferrer"
    className="text-xs underline underline-offset-2 text-panel-500 hover:text-panel-700"
    title={`Most recent occurrence: Sentry event ${group.latestSentryEventId}`}
  >
    Sentry
  </a>
)}
```

Groups without an id render nothing — the normal state when `SENTRY_DSN` is unset, and for every error recorded before Task 3 shipped. Neither is a fault worth signalling.

- [ ] **Step 4: Typecheck the dashboard**

Run: `cd dashboard && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add backend/src/dashboard-api/system.route.ts dashboard/src/app/dashboard/system/page.tsx
git commit -m "feat(system): link error console rows to their Sentry issue"
```

---

### Task 5: Users — email editing, duplicate handling, and the self-role guard

**Files:**
- Modify: `backend/src/dashboard-api/users.route.ts:16-21` (`updateUserSchema`), `:114-155` (the PATCH handler)
- Test: `backend/src/__tests__/user-editing.test.ts` (create)

**Interfaces:**
- Consumes: `assertClientAccess`, `isPlatformUser` from `../middleware/index.js`; `userService` from `../services/index.js`.
- Produces: `PATCH /users/:id` accepts `email`. Returns 409 on duplicate, 403 on self-role-change.

**Why the self-role guard matters:** the approved matrix says nobody edits their own role. Today a `client_admin` passes every existing check when editing themselves — `assertClientAccess` succeeds (same tenant) and `TENANT_ASSIGNABLE_ROLES` permits client roles — so they can promote themselves to the highest client role. The guard is what makes the matrix true.

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/user-editing.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const svc = vi.hoisted(() => ({
  findById: vi.fn(),
  update: vi.fn(),
  findByEmail: vi.fn(),
}));
vi.mock('../services/index.js', () => ({
  userService: svc,
  withAudit: vi.fn(async (o: { mutate: () => Promise<unknown> }) => o.mutate()),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../middleware/index.js', () => ({
  requirePermission: () => async (_req: unknown, _reply: unknown) => undefined,
  assertClientAccess: (actor: { clientId?: string | null }, clientId: string | null) =>
    !actor.clientId || actor.clientId === clientId,
  isPlatformUser: (actor: { clientId?: string | null }) => !actor.clientId,
}));

import Fastify from 'fastify';
import { userRoutes } from '../dashboard-api/users.route.js';

const PLATFORM = { sub: 'staff-1', clientId: null, role: 'super_admin' };
const CLIENT_ADMIN = { sub: 'ca-1', clientId: 'client-a', role: 'client_admin' };

async function build(actor: Record<string, unknown>) {
  const app = Fastify();
  app.decorateRequest('user', null);
  app.addHook('preHandler', async (req) => {
    (req as unknown as { user: unknown }).user = actor;
  });
  await app.register(userRoutes);
  return app;
}

describe('user editing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    svc.findByEmail.mockResolvedValue(null);
    svc.update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
      id: 'u-1', email: 'new@example.com', role: 'client_viewer', is_active: true, ...patch,
    }));
  });

  it('lets platform staff change a user email', async () => {
    svc.findById.mockResolvedValue({ id: 'u-1', client_id: 'client-a', role: 'client_viewer', is_active: true });
    const app = await build(PLATFORM);

    const res = await app.inject({
      method: 'PATCH', url: '/users/u-1', payload: { email: 'new@example.com' },
    });

    expect(res.statusCode).toBe(200);
    expect(svc.update).toHaveBeenCalledWith('u-1', expect.objectContaining({ email: 'new@example.com' }));
  });

  it('rejects an email already used by someone else with 409, not 500', async () => {
    svc.findById.mockResolvedValue({ id: 'u-1', client_id: 'client-a', role: 'client_viewer', is_active: true });
    svc.findByEmail.mockResolvedValue({ id: 'u-2' });
    const app = await build(PLATFORM);

    const res = await app.inject({
      method: 'PATCH', url: '/users/u-1', payload: { email: 'taken@example.com' },
    });

    expect(res.statusCode).toBe(409);
    expect(svc.update).not.toHaveBeenCalled();
  });

  it('allows re-saving a user with their own unchanged email', async () => {
    svc.findById.mockResolvedValue({ id: 'u-1', client_id: 'client-a', role: 'client_viewer', is_active: true });
    svc.findByEmail.mockResolvedValue({ id: 'u-1' }); // themselves
    const app = await build(PLATFORM);

    const res = await app.inject({
      method: 'PATCH', url: '/users/u-1', payload: { email: 'same@example.com' },
    });

    expect(res.statusCode).toBe(200);
  });

  it('refuses to let anyone change their OWN role', async () => {
    svc.findById.mockResolvedValue({ id: 'ca-1', client_id: 'client-a', role: 'client_viewer', is_active: true });
    const app = await build(CLIENT_ADMIN);

    const res = await app.inject({
      method: 'PATCH', url: '/users/ca-1', payload: { role: 'client_admin' },
    });

    expect(res.statusCode).toBe(403);
    expect(svc.update).not.toHaveBeenCalled();
  });

  it('still lets a client admin change a teammate role', async () => {
    svc.findById.mockResolvedValue({ id: 'u-9', client_id: 'client-a', role: 'client_viewer', is_active: true });
    const app = await build(CLIENT_ADMIN);

    const res = await app.inject({
      method: 'PATCH', url: '/users/u-9', payload: { role: 'client_admin' },
    });

    expect(res.statusCode).toBe(200);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd backend && npx vitest run src/__tests__/user-editing.test.ts`
Expected: FAIL — `email` is stripped by the schema, there is no duplicate check, and the self-role change returns 200.

- [ ] **Step 3: Add `email` to the update schema**

In `backend/src/dashboard-api/users.route.ts`:

```typescript
const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  role: roleEnum.optional(),
  is_active: z.boolean().optional(),
  password: z.string().min(8).optional(),
});
```

- [ ] **Step 4: Add both guards to the PATCH handler**

Insert immediately after the existing "No privilege escalation by client-scoped owners" block:

```typescript
      // Nobody edits their own role — not staff, not a client admin.
      //
      // Without this a client_admin passes every check above when the target is
      // themselves (same tenant, and client roles are assignable), so they can
      // promote themselves to the top client role. Role changes are something
      // done TO an account by another account.
      if (body.role && target.id === actor.sub) {
        return reply.code(403).send({ error: 'You cannot change your own role' });
      }

      // users.email is UNIQUE, so a collision would otherwise surface as a
      // 500 from Postgres. Answer the question the caller actually asked.
      if (body.email) {
        const clash = await userService.findByEmail(body.email);
        if (clash && clash.id !== target.id) {
          return reply.code(409).send({ error: 'That email is already in use' });
        }
      }
```

- [ ] **Step 5: Teach `userService` about email (REQUIRED — the route change alone does nothing)**

`UserService.update()` (`backend/src/services/user.service.ts:65-80`) builds its patch from an explicit whitelist:

```typescript
    if (input.name !== undefined) patch.name = input.name;
    if (input.role !== undefined) patch.role = input.role;
    if (input.is_active !== undefined) patch.is_active = input.is_active;
    if (input.password) patch.password_hash = await bcrypt.hash(input.password, 10);
```

An `email` that is not on that list is **silently dropped**. The route would return 200 with the old email and the test in Step 1 would fail for a reason the error message does not explain. Make three changes in `user.service.ts`.

Add to `UpdateUserInput` (line ~17):

```typescript
export interface UpdateUserInput {
  name?: string;
  email?: string;
  role?: UserRole;
  is_active?: boolean;
  password?: string;
}
```

Add to the patch whitelist in `update()`, lower-casing to match `create()`, which stores `input.email.toLowerCase()` — without this the same address in different case becomes a second account:

```typescript
    if (input.email !== undefined) patch.email = input.email.toLowerCase();
```

Translate the unique-violation in `update()` the way `create()` already does, so a lost race is not a 500. Replace `if (error) throw new Error(error.message);` with:

```typescript
    if (error) {
      if (error.code === '23505') throw new Error('A user with that email already exists');
      throw new Error(error.message);
    }
```

- [ ] **Step 5b: Add `findByEmail`**

It does not exist — `user.service.ts` has only `list`, `findById`, `create` and `update`. Add it next to `findById`, matching that method's shape:

```typescript
  /**
   * Look up by email for the duplicate check on update.
   *
   * Lower-cased because create() stores addresses lower-cased; comparing raw
   * input against stored values would miss "Sam@x.com" vs "sam@x.com" and let
   * the insert fail at the constraint instead of at the check.
   */
  async findByEmail(email: string): Promise<User | null> {
    const { data } = await supabase
      .from('users')
      .select(PUBLIC_COLUMNS)
      .eq('email', email.toLowerCase())
      .maybeSingle();
    return data as User | null;
  }
```

The pre-check gives a clean 409 for the common case; the 23505 translation above covers the race where two requests claim the same address at once. Both are needed.

- [ ] **Step 6: Run the test**

Run: `cd backend && npx vitest run src/__tests__/user-editing.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 7: Commit**

```bash
git add backend/src/dashboard-api/users.route.ts backend/src/services/user.service.ts backend/src/__tests__/user-editing.test.ts
git commit -m "feat(users): edit email, reject duplicates with 409, block self-role changes"
```

---

### Task 6: `PATCH /me` for self-service

**Files:**
- Modify: `backend/src/dashboard-api/users.route.ts` (add the route)
- Test: `backend/src/__tests__/user-editing.test.ts` (extend)

**Interfaces:**
- Consumes: `userService.findById`, `userService.findByEmail`, `userService.update`.
- Produces: `PATCH /me` accepting `{ email?, password?, name? }`. Requires only authentication, **not** `users:write`.

**Why a separate route:** `PATCH /users/:id` is gated on `users:write`, which client viewers do not have. Granting it to let someone change their own password would also let them edit teammates. A dedicated route with a body that cannot express a role is the smaller surface.

- [ ] **Step 1: Write the failing test**

Append to `backend/src/__tests__/user-editing.test.ts`:

```typescript
describe('self-service PATCH /me', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    svc.findByEmail.mockResolvedValue(null);
    svc.update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
      id: 'ca-1', email: 'me@example.com', role: 'client_admin', is_active: true, ...patch,
    }));
  });

  it('updates the caller own email', async () => {
    svc.findById.mockResolvedValue({ id: 'ca-1', client_id: 'client-a', role: 'client_admin', is_active: true });
    const app = await build(CLIENT_ADMIN);

    const res = await app.inject({ method: 'PATCH', url: '/me', payload: { email: 'me@example.com' } });

    expect(res.statusCode).toBe(200);
    expect(svc.update).toHaveBeenCalledWith('ca-1', expect.objectContaining({ email: 'me@example.com' }));
  });

  it('ignores a role smuggled into the body', async () => {
    svc.findById.mockResolvedValue({ id: 'ca-1', client_id: 'client-a', role: 'client_admin', is_active: true });
    const app = await build(CLIENT_ADMIN);

    await app.inject({
      method: 'PATCH', url: '/me',
      payload: { email: 'me@example.com', role: 'super_admin', is_active: false },
    });

    const patch = svc.update.mock.calls[0][1];
    expect(patch).not.toHaveProperty('role');
    expect(patch).not.toHaveProperty('is_active');
  });

  it('rejects an email belonging to someone else', async () => {
    svc.findById.mockResolvedValue({ id: 'ca-1', client_id: 'client-a', role: 'client_admin', is_active: true });
    svc.findByEmail.mockResolvedValue({ id: 'someone-else' });
    const app = await build(CLIENT_ADMIN);

    const res = await app.inject({ method: 'PATCH', url: '/me', payload: { email: 'taken@example.com' } });

    expect(res.statusCode).toBe(409);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd backend && npx vitest run src/__tests__/user-editing.test.ts`
Expected: FAIL — `/me` returns 404.

- [ ] **Step 3: Implement the route**

Add inside `userRoutes`, after the existing PATCH:

```typescript
  /**
   * Self-service account edits.
   *
   * Separate from PATCH /users/:id because that route requires `users:write`,
   * which client viewers do not have — and granting it so someone can change
   * their own password would also let them edit teammates.
   *
   * The schema cannot express `role` or `is_active`, so privilege changes are
   * impossible here by construction rather than by a guard someone can forget.
   */
  const selfUpdateSchema = z.object({
    name: z.string().min(1).optional(),
    email: z.string().email().optional(),
    password: z.string().min(8).optional(),
  });

  app.patch('/me', {
    preHandler: requireAuth,
    handler: async (request, reply) => {
      const actor = request.user as JwtPayload;
      const body = selfUpdateSchema.parse(request.body);

      const target = await userService.findById(actor.sub);
      if (!target) return reply.code(404).send({ error: 'Not found' });

      if (body.email) {
        const clash = await userService.findByEmail(body.email);
        if (clash && clash.id !== actor.sub) {
          return reply.code(409).send({ error: 'That email is already in use' });
        }
      }

      const updated = await userService.update(actor.sub, body);
      await writeAuditLog({
        userId: actor.sub,
        clientId: target.client_id ?? undefined,
        action: 'user.self_updated',
        entityType: 'user',
        entityId: actor.sub,
        oldValue: { email: target.email },
        newValue: { email: updated.email },
        ipAddress: request.ip,
      });
      reply.send(updated);
    },
  });
```

Ensure `requireAuth` is imported from `../middleware/index.js` at the top of the file, alongside the existing middleware imports.

- [ ] **Step 4: Add `requireAuth` to the test middleware mock**

In `user-editing.test.ts`, extend the middleware mock:

```typescript
vi.mock('../middleware/index.js', () => ({
  requireAuth: async (_req: unknown, _reply: unknown) => undefined,
  requirePermission: () => async (_req: unknown, _reply: unknown) => undefined,
  assertClientAccess: (actor: { clientId?: string | null }, clientId: string | null) =>
    !actor.clientId || actor.clientId === clientId,
  isPlatformUser: (actor: { clientId?: string | null }) => !actor.clientId,
}));
```

- [ ] **Step 5: Run the test**

Run: `cd backend && npx vitest run src/__tests__/user-editing.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Full suite**

Run: `cd backend && npx vitest run && npx tsc --noEmit && npx eslint src`
Expected: exit 0; **827 tests passing** (819 + 8). Only the three pre-existing lint errors.

- [ ] **Step 7: Commit**

```bash
git add backend/src/dashboard-api/users.route.ts backend/src/__tests__/user-editing.test.ts
git commit -m "feat(users): add PATCH /me for self-service email and password"
```

---

### Task 7: Users tab editing UI

**Files:**
- Modify: `dashboard/src/app/dashboard/users/page.tsx`

**Interfaces:**
- Consumes: `PATCH /users/:id` (Task 5) and `PATCH /me` (Task 6).
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Add edit state**

Alongside the existing `useState` declarations (the file already uses this pattern for the create form at lines 36-40), add:

```tsx
const [editing, setEditing] = useState<AppUser | null>(null);
const [editEmail, setEditEmail] = useState('');
const [editRole, setEditRole] = useState<UserRole>('client_viewer');
const [editPassword, setEditPassword] = useState('');
const [savingEdit, setSavingEdit] = useState(false);
```

- [ ] **Step 2: Add the save handler**

`useSession()` returns `{ auth, loading, can, isPlatform }` (`SessionProvider.tsx:7-13`); the signed-in user id is `auth.sub` (`SessionProvider.tsx:55`). The page already destructures `isPlatform` from it — extend that call rather than adding a second one.

```tsx
const { isPlatform, auth } = useSession();

const startEdit = (u: AppUser) => {
  setEditing(u);
  setEditEmail(u.email);
  setEditRole(u.role as UserRole);
  setEditPassword('');
};

const saveEdit = async (e: React.FormEvent) => {
  e.preventDefault();
  if (!editing) return;
  setSavingEdit(true);
  const isSelf = editing.id === auth?.sub;
  try {
    // Role is omitted for yourself: the API rejects it with 403, and offering a
    // control that always fails is worse than not offering it.
    const payload: Record<string, unknown> = { email: editEmail };
    if (editPassword) payload.password = editPassword;
    if (!isSelf) payload.role = editRole;

    await api.patch(isSelf ? '/me' : `/users/${editing.id}`, payload);
    toast.success('User updated');
    setEditing(null);
    load();
  } catch (err) {
    const status = (err as { response?: { status?: number } }).response?.status;
    toast.error(
      status === 409
        ? 'That email is already in use'
        : status === 403
          ? 'You do not have permission to make that change'
          : 'Could not update user'
    );
  } finally {
    setSavingEdit(false);
  }
};
```

`auth` is typed `AuthState | null` and extends `Session`, which declares `sub: string` (`dashboard/src/lib/session.ts:56-65`) — so `auth?.sub` is the signed-in user id and is correctly typed as `string | undefined`.

- [ ] **Step 3: Add an Edit control to each row**

In the table body where each `AppUser` is rendered, add a cell:

```tsx
<TD>
  <button
    type="button"
    onClick={() => startEdit(u)}
    className="text-sm underline underline-offset-2 hover:text-panel-700"
  >
    Edit
  </button>
</TD>
```

Add a matching `<TH>Edit</TH>` (or an empty one) to the header row so the column counts still line up.

- [ ] **Step 4: Render the edit form**

Render above the table when `editing` is set, matching the existing create-form markup style:

```tsx
{editing && (
  <form onSubmit={saveEdit} className="mb-6 rounded-xl border border-panel-200 bg-white p-4">
    <h2 className="mb-3 text-sm font-semibold">Edit {editing.name}</h2>
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="text-sm">
        Email
        <input
          type="email"
          value={editEmail}
          onChange={(e) => setEditEmail(e.target.value)}
          required
          className="mt-1 w-full rounded-md border border-panel-200 px-2 py-1"
        />
      </label>
      <label className="text-sm">
        New password
        <input
          type="password"
          value={editPassword}
          onChange={(e) => setEditPassword(e.target.value)}
          minLength={8}
          placeholder="leave blank to keep"
          className="mt-1 w-full rounded-md border border-panel-200 px-2 py-1"
        />
      </label>
      {editing.id !== auth?.sub && (
        <label className="text-sm">
          Role
          <select
            value={editRole}
            onChange={(e) => setEditRole(e.target.value as UserRole)}
            className="mt-1 w-full rounded-md border border-panel-200 px-2 py-1"
          >
            {roles.map((r) => (
              <option key={r} value={r}>{roleLabel(r)}</option>
            ))}
          </select>
        </label>
      )}
    </div>
    <div className="mt-3 flex gap-2">
      <button type="submit" disabled={savingEdit} className="rounded-md bg-panel-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">
        {savingEdit ? 'Saving…' : 'Save'}
      </button>
      <button type="button" onClick={() => setEditing(null)} className="rounded-md border border-panel-200 px-3 py-1.5 text-sm">
        Cancel
      </button>
    </div>
  </form>
)}
```

- [ ] **Step 5: Typecheck and build the dashboard**

Run: `cd dashboard && npx tsc --noEmit && npm run build`
Expected: exit 0 for both.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/app/dashboard/users/page.tsx
git commit -m "feat(users): inline editing for email, password and role"
```

---

## Verification

- [ ] `cd backend && npx vitest run` → 827 passing, 0 failing
- [ ] `cd backend && npx tsc --noEmit` → exit 0
- [ ] `cd backend && npx eslint src` → only the 3 pre-existing errors
- [ ] `cd dashboard && npx tsc --noEmit && npm run build` → exit 0
- [ ] `npx supabase db query --linked "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 3;"` → `030`, `029`, `028`

Expect `/dashboard/system` to start showing an **email** warning immediately after deploy. That is the feature working, not a regression: `SMTP_PASS` is unset or invalid in production today, which is why no client alert has ever been delivered.

---

## Plan B (not yet written)

W2 (knowledge categories), W3 (policies as titled entries) and W4 (cross-company analytics) follow once this plan is executed and reviewed. They are deliberately deferred rather than written now: they share the knowledge-base UI surface, and writing their code before this plan lands would be speculative.
