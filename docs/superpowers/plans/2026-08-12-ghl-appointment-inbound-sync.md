# GHL Inbound Appointment Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Appointments created in GoHighLevel appear in the Gravvia dashboard, and the two Bare Beauty CRM misconfigurations that break lead capture and misfile booked patients are fixed.

**Architecture:** Appointment sync is currently one-way (Gravvia → GHL). This adds the return path as a polling reconciler rather than a webhook: an optional `listBookings` capability on the CRM adapter, a reconciler service that upserts GHL calendar events into `appointments`, a repeatable BullMQ job on the existing `crm-sync` queue, and an on-demand endpoint plus dashboard control for immediate sync. A migration first unifies appointment↔CRM-event linkage onto the existing unused `appointments.external_calendar_id` column with a unique index, so upserts have a valid `ON CONFLICT` target.

**Tech Stack:** Node 22, TypeScript (ESM, `.js` import specifiers), Fastify, Supabase JS, BullMQ, Zod, Vitest, Next.js dashboard.

## Global Constraints

- Never edit an existing migration. New migrations get the next number: `033`.
- Every migration needs a matching rollback in `supabase/rollbacks/`.
- Never run `supabase db push` against this project — it is destructive here. Apply migrations with `npm run migrate`.
- `appointments.status` is constrained: `CHECK (status IN ('pending','confirmed','cancelled','rescheduled','completed','no_show'))`.
- `appointments.contact_id` is `NOT NULL` — inbound sync must resolve or create a contact before inserting.
- `call_summaries.sentiment` is constrained to lowercase `positive|neutral|negative`.
- No client-specific logic in source. Everything tenant-varying reads from `crm_connections` / `client_settings`.
- Adapter interface additions must be **optional** methods so other adapters keep compiling.
- Bare Beauty client id: `5f31ba41-edc8-472c-a0c3-3f5e89639785`. GHL location `Z5IVkxMEOcTfCR4NUHEj`, calendar `KREH27KlJTMihZJFYZlu`, connection row `30c6b232-c685-4f63-91a5-cde540ee8d60`.

---

### Task 1: Migration 033 — unify appointment↔CRM-event linkage

`appointments.external_calendar_id` exists in migration 001 and is `NULL` on every row; `crm-sync.worker.ts` writes the GHL event id to `metadata.crm_event_id` instead. Inbound upserts need a real unique index to target, which JSONB cannot provide. This is the same defect class migration 028 fixed for the call tables.

**Files:**
- Create: `supabase/migrations/033_appointment_external_id.sql`
- Create: `supabase/rollbacks/033_appointment_external_id_rollback.sql`

**Interfaces:**
- Consumes: nothing
- Produces: `appointments.external_calendar_id` populated and covered by `uq_appointments_client_external_event`, a partial UNIQUE index on `(client_id, external_calendar_id) WHERE external_calendar_id IS NOT NULL`

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================
-- GRAVVIA ENGAGE – unify appointment ↔ CRM calendar-event linkage
-- Run order: 033  (NEVER edit earlier migrations)
--
-- WHY THIS EXISTS
--
-- Migration 001 gave appointments an external_calendar_id column for exactly
-- this purpose. Nothing ever wrote it: crm-sync.worker.ts puts the GoHighLevel
-- event id in metadata->>'crm_event_id' instead, and booking.service.ts reads
-- it back from there. The column has been NULL on every row since launch.
--
-- Inbound sync (GHL -> dashboard) must upsert on "the appointment for this CRM
-- event". A JSONB path cannot back an ON CONFLICT target — only a UNIQUE index
-- can. Writing the id to a real column and indexing it is what makes the
-- inbound upsert idempotent; without it, every reconciler pass would insert
-- duplicates. Migration 028 fixed the identical omission on the call tables.
--
-- WHAT THIS DOES
--
-- Backfills the column from the JSONB it shadowed, then adds a PARTIAL unique
-- index. Partial because locally-created appointments that have not yet synced
-- to a CRM legitimately have no external id, and NULLs must not collide.
--
-- metadata.crm_event_id is deliberately left in place: booking.service.ts still
-- reads it. Task 2 makes the worker write both. Dropping the JSONB copy is a
-- later cleanup once no reader remains.
--
-- Rollback: supabase/rollbacks/033_appointment_external_id_rollback.sql
-- ============================================================

-- 1. Backfill from the JSONB copy.
UPDATE appointments
   SET external_calendar_id = metadata->>'crm_event_id'
 WHERE external_calendar_id IS NULL
   AND metadata->>'crm_event_id' IS NOT NULL;

-- 2. Defensive de-duplication before the unique index is built.
--    Two local rows pointing at one CRM event is already corruption; keep the
--    newest and null the rest rather than failing the migration.
UPDATE appointments a
   SET external_calendar_id = NULL
  FROM appointments b
 WHERE a.client_id = b.client_id
   AND a.external_calendar_id = b.external_calendar_id
   AND a.external_calendar_id IS NOT NULL
   AND (a.created_at, a.id) < (b.created_at, b.id);

-- 3. The index the inbound upsert targets.
CREATE UNIQUE INDEX IF NOT EXISTS uq_appointments_client_external_event
  ON appointments(client_id, external_calendar_id)
  WHERE external_calendar_id IS NOT NULL;
```

- [ ] **Step 2: Write the rollback**

```sql
-- Rollback for 033_appointment_external_id.sql
-- Drops the index. The backfilled column values are intentionally LEFT in
-- place: metadata->>'crm_event_id' still holds the same ids, so the data is
-- redundant rather than lost, and nulling it would discard inbound-only links
-- created after the migration ran.
DROP INDEX IF EXISTS uq_appointments_client_external_event;
```

- [ ] **Step 3: Apply the migration**

Run: `cd backend && npm run migrate`
Expected: `033_appointment_external_id.sql` reported as applied, no error.

- [ ] **Step 4: Verify the backfill and the index**

Run this against the live database and confirm all 4 Bare Beauty appointments now carry an `external_calendar_id` matching their old `metadata.crm_event_id`, and that the index exists:

```sql
SELECT external_calendar_id, metadata->>'crm_event_id' AS old_id, title
  FROM appointments
 WHERE client_id = '5f31ba41-edc8-472c-a0c3-3f5e89639785';

SELECT indexname FROM pg_indexes
 WHERE tablename = 'appointments'
   AND indexname = 'uq_appointments_client_external_event';
```

Expected: 4 rows where `external_calendar_id = old_id` and neither is NULL; one index row.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/033_appointment_external_id.sql supabase/rollbacks/033_appointment_external_id_rollback.sql
git commit -m "feat(db): unify appointment CRM-event linkage on external_calendar_id

Adds the partial unique index inbound appointment sync needs as an
ON CONFLICT target, and backfills the column from the metadata JSONB
copy that shadowed it since launch."
```

---

### Task 2: Write `external_calendar_id` on outbound sync

**Files:**
- Modify: `backend/src/workers/crm-sync.worker.ts:255-268` (the `case 'appointment'` external-id mirror block)
- Test: `backend/src/__tests__/appointment-external-id.test.ts`

**Interfaces:**
- Consumes: `uq_appointments_client_external_event` from Task 1
- Produces: outbound-synced appointments carry the CRM event id in **both** `external_calendar_id` and `metadata.crm_event_id`

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/appointment-external-id.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Captures what the worker writes back onto the appointment row.
let updatePayload: Record<string, unknown> | null = null;

vi.mock('../db/index.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: { metadata: { existing: 'keep' } } })) })),
        })),
      })),
      update: vi.fn((payload: Record<string, unknown>) => {
        updatePayload = payload;
        return { eq: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })) };
      }),
    })),
  },
}));

import { mirrorCrmEventId } from '../workers/crm-sync.worker.js';

describe('mirrorCrmEventId', () => {
  beforeEach(() => { updatePayload = null; });

  it('writes the CRM event id to the external_calendar_id column', async () => {
    await mirrorCrmEventId('client-1', 'appt-1', 'ghl-event-9');
    expect(updatePayload).toMatchObject({ external_calendar_id: 'ghl-event-9' });
  });

  it('keeps writing metadata.crm_event_id for booking.service compatibility', async () => {
    await mirrorCrmEventId('client-1', 'appt-1', 'ghl-event-9');
    expect((updatePayload as { metadata: Record<string, unknown> }).metadata)
      .toMatchObject({ existing: 'keep', crm_event_id: 'ghl-event-9' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run src/__tests__/appointment-external-id.test.ts`
Expected: FAIL — `mirrorCrmEventId` is not exported from the worker.

- [ ] **Step 3: Extract and extend the mirror block**

In `backend/src/workers/crm-sync.worker.ts`, replace the inline mirror block inside `case 'appointment'` with a call to a new exported function, and add that function near the other helpers:

```typescript
/**
 * Mirror the CRM's calendar event id onto the local appointment.
 *
 * Written to BOTH places on purpose: external_calendar_id is the indexed column
 * the inbound reconciler upserts against (migration 033), while
 * metadata.crm_event_id is what booking.service.ts still reads for
 * reschedule/cancel. Once that reader moves over, the JSONB copy can go.
 */
export async function mirrorCrmEventId(
  clientId: string,
  appointmentId: string,
  externalId: string
): Promise<void> {
  const { data: existingAppt } = await supabase
    .from('appointments')
    .select('metadata')
    .eq('id', appointmentId)
    .eq('client_id', clientId)
    .maybeSingle();

  await supabase
    .from('appointments')
    .update({
      external_calendar_id: externalId,
      metadata: { ...(existingAppt?.metadata ?? {}), crm_event_id: externalId },
    })
    .eq('id', appointmentId)
    .eq('client_id', clientId);
}
```

Then in `case 'appointment'`:

```typescript
      if (result.success && result.externalId) {
        await mirrorCrmEventId(clientId, entityId, result.externalId);
      }
      break;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx vitest run src/__tests__/appointment-external-id.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Run the existing suite for regressions**

Run: `cd backend && npx vitest run src/__tests__/booking-crm-truth.test.ts src/__tests__/booking.test.ts src/__tests__/booking-automation.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/workers/crm-sync.worker.ts backend/src/__tests__/appointment-external-id.test.ts
git commit -m "feat(crm): mirror CRM event id onto external_calendar_id column"
```

---

### Task 3: `listBookings` adapter capability

**Files:**
- Modify: `backend/src/types/index.ts` (or the CRM types module it re-exports) — add `CrmBookingListRequest`, `CrmBookingRecord`
- Modify: `backend/src/crm/crm.interface.ts` — add optional `listBookings`
- Modify: `backend/src/crm/adapters/gohighlevel.adapter.ts` — implement it
- Test: `backend/src/__tests__/ghl-list-bookings.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `interface CrmBookingListRequest { calendarId: string; startTime: Date; endTime: Date }`
  - `interface CrmBookingRecord { externalId: string; externalContactId: string | null; title: string; startTime: Date; endTime: Date; status: string }`
  - `ICrmAdapter.listBookings?(req: CrmBookingListRequest): Promise<CrmBookingRecord[]>`

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/ghl-list-bookings.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { getCrmAdapter } from '../crm/index.js';

// One real GHL /calendars/events payload, trimmed to the fields we consume.
const EVENTS = {
  events: [
    {
      id: 'MznIyDRPeF87FQ0PCqrr',
      calendarId: 'KREH27KlJTMihZJFYZlu',
      contactId: 'pHPjo2AWZyco4VCybaMi',
      title: 'Consultation',
      startTime: '2026-07-27T09:00:00-04:00',
      endTime: '2026-07-27T09:30:00-04:00',
      appointmentStatus: 'confirmed',
      deleted: false,
    },
    {
      id: 'deleted-1',
      calendarId: 'KREH27KlJTMihZJFYZlu',
      contactId: 'c-2',
      title: 'Cancelled thing',
      startTime: '2026-07-28T09:00:00-04:00',
      endTime: '2026-07-28T09:30:00-04:00',
      appointmentStatus: 'confirmed',
      deleted: true,
    },
  ],
};

describe('GoHighLevel listBookings', () => {
  it('maps calendar events onto CrmBookingRecord', async () => {
    const adapter = getCrmAdapter('gohighlevel', {
      accessToken: 't', locationId: 'loc-1', calendarId: 'KREH27KlJTMihZJFYZlu',
    });
    const get = vi.fn(async () => ({ data: EVENTS }));
    (adapter as unknown as { http: { get: unknown } }).http.get = get;

    const rows = await adapter.listBookings!({
      calendarId: 'KREH27KlJTMihZJFYZlu',
      startTime: new Date('2026-07-01T00:00:00Z'),
      endTime: new Date('2026-08-01T00:00:00Z'),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      externalId: 'MznIyDRPeF87FQ0PCqrr',
      externalContactId: 'pHPjo2AWZyco4VCybaMi',
      title: 'Consultation',
      status: 'confirmed',
    });
    expect(rows[0].startTime.toISOString()).toBe('2026-07-27T13:00:00.000Z');
  });

  it('sends the window as epoch milliseconds, which is what GHL expects', async () => {
    const adapter = getCrmAdapter('gohighlevel', {
      accessToken: 't', locationId: 'loc-1', calendarId: 'cal-1',
    });
    const get = vi.fn(async () => ({ data: { events: [] } }));
    (adapter as unknown as { http: { get: unknown } }).http.get = get;

    await adapter.listBookings!({
      calendarId: 'cal-1',
      startTime: new Date('2026-07-01T00:00:00Z'),
      endTime: new Date('2026-08-01T00:00:00Z'),
    });

    expect(get).toHaveBeenCalledWith('/calendars/events', expect.objectContaining({
      params: expect.objectContaining({
        calendarId: 'cal-1',
        startTime: String(Date.UTC(2026, 6, 1)),
        endTime: String(Date.UTC(2026, 7, 1)),
      }),
    }));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run src/__tests__/ghl-list-bookings.test.ts`
Expected: FAIL — `adapter.listBookings` is undefined.

- [ ] **Step 3: Add the types**

In the CRM types module (`backend/src/types/crm.types.ts` if present, otherwise alongside `CrmAvailabilitySlot` in `backend/src/types/index.ts`):

```typescript
/** Window to read existing bookings from a CRM-owned calendar. */
export interface CrmBookingListRequest {
  calendarId: string;
  startTime: Date;
  endTime: Date;
}

/**
 * One booking as the CRM sees it. Deliberately provider-neutral: the reconciler
 * maps `status` onto the local appointments CHECK enum, and resolves
 * `externalContactId` to a local contact.
 */
export interface CrmBookingRecord {
  externalId: string;
  externalContactId: string | null;
  title: string;
  startTime: Date;
  endTime: Date;
  status: string;
}
```

- [ ] **Step 4: Add the optional interface method**

In `backend/src/crm/crm.interface.ts`, extend the existing optional calendar block and its import list:

```typescript
  cancelBooking?(externalEventId: string): Promise<CrmSyncResult>;
  /**
   * Read bookings the CRM already holds. Optional, like the rest of this block:
   * only adapters whose CRM owns the calendar can answer it, and the inbound
   * reconciler skips any connection whose adapter does not implement it.
   */
  listBookings?(req: CrmBookingListRequest): Promise<CrmBookingRecord[]>;
```

- [ ] **Step 5: Implement it on the GoHighLevel adapter**

In `backend/src/crm/adapters/gohighlevel.adapter.ts`, near `getAvailability`:

```typescript
  /**
   * GET /calendars/events over a window.
   *
   * GHL takes the window as epoch-millisecond STRINGS, not ISO timestamps, and
   * returns soft-deleted events with `deleted: true` still in the array — those
   * are filtered here so the reconciler never resurrects a removed booking.
   */
  async listBookings(req: CrmBookingListRequest): Promise<CrmBookingRecord[]> {
    const { data } = await this.http.get('/calendars/events', {
      params: {
        locationId: this.cfg.locationId,
        calendarId: req.calendarId,
        startTime: String(req.startTime.getTime()),
        endTime: String(req.endTime.getTime()),
      },
      headers: { Version: CALENDARS_API_VERSION },
    });

    const events = (data?.events ?? []) as Array<{
      id: string;
      contactId?: string | null;
      title?: string;
      startTime: string;
      endTime: string;
      appointmentStatus?: string;
      deleted?: boolean;
    }>;

    return events
      .filter((e) => !e.deleted)
      .map((e) => ({
        externalId: e.id,
        externalContactId: e.contactId ?? null,
        title: e.title ?? 'Appointment',
        startTime: new Date(e.startTime),
        endTime: new Date(e.endTime),
        status: e.appointmentStatus ?? 'confirmed',
      }));
  }
```

Add `CrmBookingListRequest` and `CrmBookingRecord` to the adapter's type imports.

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd backend && npx vitest run src/__tests__/ghl-list-bookings.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 7: Verify other adapters still compile**

Run: `cd backend && npm run typecheck`
Expected: no errors. The method is optional, so `noop`, `hubspot`, `salesforce`, `zoho`, and `webhook` adapters are unaffected.

- [ ] **Step 8: Commit**

```bash
git add backend/src/crm/crm.interface.ts backend/src/crm/adapters/gohighlevel.adapter.ts backend/src/types backend/src/__tests__/ghl-list-bookings.test.ts
git commit -m "feat(crm): add optional listBookings capability, implemented for GoHighLevel"
```

---

### Task 4: Appointment reconciler service

**Files:**
- Create: `backend/src/booking/appointment-reconciler.ts`
- Test: `backend/src/__tests__/appointment-reconcile.test.ts`

**Interfaces:**
- Consumes: `CrmBookingRecord` and `listBookings` from Task 3; `uq_appointments_client_external_event` from Task 1
- Produces:
  - `mapGhlStatus(ghlStatus: string): AppointmentStatus`
  - `reconcileAppointments(clientId: string): Promise<{ pulled: number; created: number; updated: number; skipped: number }>`

- [ ] **Step 1: Write the failing test for status mapping**

Create `backend/src/__tests__/appointment-reconcile.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { mapGhlStatus } from '../booking/appointment-reconciler.js';

describe('mapGhlStatus', () => {
  it('maps GHL statuses onto the appointments CHECK enum', () => {
    expect(mapGhlStatus('confirmed')).toBe('confirmed');
    expect(mapGhlStatus('showed')).toBe('completed');
    expect(mapGhlStatus('noshow')).toBe('no_show');
    expect(mapGhlStatus('cancelled')).toBe('cancelled');
    expect(mapGhlStatus('new')).toBe('pending');
  });

  it('falls back to pending for statuses GHL may add later', () => {
    // The local column has a CHECK constraint; an unmapped passthrough would
    // make the whole upsert fail rather than degrade.
    expect(mapGhlStatus('some-future-status')).toBe('pending');
  });

  it('is case-insensitive', () => {
    expect(mapGhlStatus('Confirmed')).toBe('confirmed');
    expect(mapGhlStatus('NoShow')).toBe('no_show');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run src/__tests__/appointment-reconcile.test.ts`
Expected: FAIL — module `../booking/appointment-reconciler.js` not found.

- [ ] **Step 3: Create the module with the status mapper**

Create `backend/src/booking/appointment-reconciler.ts`:

```typescript
import { supabase } from '../db/index.js';
import { getCrmAdapter, resolveAdapterConfig } from '../crm/index.js';
import { logger } from '../utils/index.js';
import type { CrmBookingRecord } from '../types/index.js';

/** How far back and forward each pass reads. */
const WINDOW_BACK_DAYS = 7;
const WINDOW_FORWARD_DAYS = 60;

type AppointmentStatus =
  | 'pending' | 'confirmed' | 'cancelled' | 'rescheduled' | 'completed' | 'no_show';

/**
 * GoHighLevel appointment status -> the local appointments CHECK enum.
 *
 * Unknown values collapse to 'pending' rather than passing through: the column
 * has a CHECK constraint, so an unrecognised status would fail the whole upsert
 * instead of degrading to something harmless.
 */
export function mapGhlStatus(ghlStatus: string): AppointmentStatus {
  switch (ghlStatus.toLowerCase()) {
    case 'confirmed':  return 'confirmed';
    case 'showed':     return 'completed';
    case 'noshow':
    case 'no_show':    return 'no_show';
    case 'cancelled':
    case 'canceled':   return 'cancelled';
    case 'new':
    case 'unconfirmed':
    default:           return 'pending';
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx vitest run src/__tests__/appointment-reconcile.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the failing test for contact resolution**

Append to `backend/src/__tests__/appointment-reconcile.test.ts`:

```typescript
import { vi } from 'vitest';
import { resolveLocalContactId } from '../booking/appointment-reconciler.js';

describe('resolveLocalContactId', () => {
  it('returns null when the CRM event has no contact attached', async () => {
    // appointments.contact_id is NOT NULL, so an event with no contact cannot
    // become a row — the caller must skip it rather than invent a contact.
    const id = await resolveLocalContactId('client-1', null);
    expect(id).toBeNull();
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd backend && npx vitest run src/__tests__/appointment-reconcile.test.ts`
Expected: FAIL — `resolveLocalContactId` is not exported.

- [ ] **Step 7: Implement contact resolution**

Append to `backend/src/booking/appointment-reconciler.ts`:

```typescript
/**
 * Find (or create) the local contact for a CRM contact id.
 *
 * Returns null when the CRM event carries no contact: appointments.contact_id
 * is NOT NULL, so such an event cannot be represented locally and the caller
 * skips it. Inventing a placeholder contact would pollute the contact list with
 * rows no one can act on.
 */
export async function resolveLocalContactId(
  clientId: string,
  externalContactId: string | null
): Promise<string | null> {
  if (!externalContactId) return null;

  const { data: existing } = await supabase
    .from('contacts')
    .select('id')
    .eq('client_id', clientId)
    .eq('external_crm_id', externalContactId)
    .maybeSingle();

  if (existing?.id) return existing.id;

  // Unknown CRM contact: create a stub carrying the linkage so the next pass
  // matches it, and so the appointment has an owner in the dashboard.
  const { data: created, error } = await supabase
    .from('contacts')
    .insert({
      client_id: clientId,
      external_crm_id: externalContactId,
      phone: '',
      tags: ['crm-sourced'],
    })
    .select('id')
    .single();

  if (error) {
    logger.error({ err: error, clientId, externalContactId }, 'reconciler: could not create contact');
    return null;
  }
  return created.id;
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd backend && npx vitest run src/__tests__/appointment-reconcile.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 9: Implement the reconcile entry point**

Append to `backend/src/booking/appointment-reconciler.ts`:

```typescript
export interface ReconcileResult {
  pulled: number;
  created: number;
  updated: number;
  skipped: number;
}

/**
 * Pull the CRM's calendar into local appointments for one client.
 *
 * Upserts on (client_id, external_calendar_id) — the partial unique index from
 * migration 033 — so repeated passes converge rather than duplicating. Silently
 * does nothing for connections whose adapter has no listBookings or whose
 * crm_config names no calendar; both are normal for non-calendar CRMs.
 */
export async function reconcileAppointments(clientId: string): Promise<ReconcileResult> {
  const empty: ReconcileResult = { pulled: 0, created: 0, updated: 0, skipped: 0 };

  const { data: conn } = await supabase
    .from('crm_connections')
    .select('*')
    .eq('client_id', clientId)
    .eq('is_active', true)
    .maybeSingle();
  if (!conn) return empty;

  const config = await resolveAdapterConfig(conn);
  const calendarId = config.calendarId as string | undefined;
  if (!calendarId) return empty;

  const adapter = getCrmAdapter(conn.crm_type, config);
  if (typeof adapter.listBookings !== 'function') return empty;

  const now = Date.now();
  const events: CrmBookingRecord[] = await adapter.listBookings({
    calendarId,
    startTime: new Date(now - WINDOW_BACK_DAYS * 86_400_000),
    endTime: new Date(now + WINDOW_FORWARD_DAYS * 86_400_000),
  });

  const result: ReconcileResult = { ...empty, pulled: events.length };

  for (const event of events) {
    const contactId = await resolveLocalContactId(clientId, event.externalContactId);
    if (!contactId) { result.skipped += 1; continue; }

    const { data: existing } = await supabase
      .from('appointments')
      .select('id')
      .eq('client_id', clientId)
      .eq('external_calendar_id', event.externalId)
      .maybeSingle();

    const row = {
      client_id: clientId,
      contact_id: contactId,
      external_calendar_id: event.externalId,
      title: event.title,
      start_time: event.startTime.toISOString(),
      end_time: event.endTime.toISOString(),
      timezone: (config.timezone as string) ?? 'America/New_York',
      status: mapGhlStatus(event.status),
      metadata: { crm_event_id: event.externalId, source: 'crm-reconciler' },
    };

    const { error } = await supabase
      .from('appointments')
      .upsert(row, { onConflict: 'client_id,external_calendar_id' });

    if (error) {
      logger.error({ err: error, clientId, externalId: event.externalId }, 'reconciler: upsert failed');
      result.skipped += 1;
      continue;
    }

    // Resolve the local row id so the sync log can point at it. crm_sync_logs
    // .entity_id is NOT NULL UUID — there is no "whole pass" row to write, so
    // this logs per appointment, which is also what makes inbound activity
    // legible on the CRM page next to the outbound entries.
    const { data: saved } = await supabase
      .from('appointments')
      .select('id')
      .eq('client_id', clientId)
      .eq('external_calendar_id', event.externalId)
      .maybeSingle();

    if (saved?.id) {
      await supabase.from('crm_sync_logs').insert({
        client_id: clientId,
        crm_connection_id: conn.id,
        entity_type: 'appointment',
        entity_id: saved.id,
        operation: existing ? 'update' : 'create',
        status: 'success',
        external_id: event.externalId,
      });
    }

    if (existing) result.updated += 1; else result.created += 1;
  }

  logger.info({ clientId, ...result }, 'reconciled CRM appointments');
  return result;
}
```

`crm_sync_logs` columns are exactly: `client_id`, `crm_connection_id`,
`entity_type`, `entity_id` (NOT NULL UUID), `operation` (CHECK
`create|update|delete`), `status` (CHECK `success|failed|pending`),
`external_id`, `error_message`, `attempts`. There is no payload column — do not
add one.

- [ ] **Step 10: Run the full test file and typecheck**

Run: `cd backend && npx vitest run src/__tests__/appointment-reconcile.test.ts && npm run typecheck`
Expected: PASS and no type errors.

- [ ] **Step 11: Commit**

```bash
git add backend/src/booking/appointment-reconciler.ts backend/src/__tests__/appointment-reconcile.test.ts
git commit -m "feat(booking): reconcile CRM-owned calendar bookings into appointments"
```

---

### Task 5: Reconciler job on the crm-sync queue

**Files:**
- Modify: `backend/src/types/queue.types.ts` — add `CrmReconcileJobData` to the `CrmSyncJob` union
- Modify: `backend/src/workers/crm-sync.worker.ts` — dispatch the new job name
- Modify: `backend/src/workers/start.ts` — schedule the repeatable job
- Test: `backend/src/__tests__/appointment-reconcile-job.test.ts`

**Interfaces:**
- Consumes: `reconcileAppointments(clientId)` from Task 4
- Produces: `scheduleAppointmentReconcile(): Promise<void>`, job name `'reconcile-appointments'` on the `crm-sync` queue

- [ ] **Step 1: Add the job type**

In `backend/src/types/queue.types.ts`:

```typescript
/**
 * Inbound calendar reconcile (job name 'reconcile-appointments' on the crm-sync
 * queue). Fans out one job per client with an active calendar-owning CRM.
 */
export interface CrmReconcileJobData {
  kind: 'reconcile-appointments';
  clientId: string;
}

export type CrmSyncJob = CrmSyncJobData | CrmProvisionJobData | CrmReconcileJobData;
```

- [ ] **Step 2: Write the failing test**

Create `backend/src/__tests__/appointment-reconcile-job.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const reconcileAppointments = vi.fn(async () => ({ pulled: 2, created: 1, updated: 1, skipped: 0 }));
vi.mock('../booking/appointment-reconciler.js', () => ({ reconcileAppointments }));
vi.mock('../queues/index.js', () => ({ redis: {}, crmSyncQueue: { add: vi.fn(), upsertJobScheduler: vi.fn() } }));
vi.mock('../db/index.js', () => ({ supabase: { from: vi.fn() } }));

import { handleReconcileJob } from '../workers/crm-sync.worker.js';

describe('reconcile-appointments job', () => {
  beforeEach(() => reconcileAppointments.mockClear());

  it('reconciles the client named in the job', async () => {
    await handleReconcileJob({ kind: 'reconcile-appointments', clientId: 'client-9' });
    expect(reconcileAppointments).toHaveBeenCalledWith('client-9');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd backend && npx vitest run src/__tests__/appointment-reconcile-job.test.ts`
Expected: FAIL — `handleReconcileJob` is not exported.

- [ ] **Step 4: Dispatch the job in the worker**

In `backend/src/workers/crm-sync.worker.ts`, add the handler and route to it alongside the existing `'provision'` branch:

```typescript
export async function handleReconcileJob(data: CrmReconcileJobData): Promise<void> {
  await reconcileAppointments(data.clientId);
}
```

And in the processor, before the `entityType` switch:

```typescript
  if (job.name === 'reconcile-appointments' && 'kind' in job.data && job.data.kind === 'reconcile-appointments') {
    await handleReconcileJob(job.data);
    return;
  }
```

Import `reconcileAppointments` from `../booking/appointment-reconciler.js` and the `CrmReconcileJobData` type.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && npx vitest run src/__tests__/appointment-reconcile-job.test.ts`
Expected: PASS.

- [ ] **Step 6: Schedule the repeatable fan-out**

Add to `backend/src/workers/crm-sync.worker.ts`:

```typescript
/**
 * Register the inbound calendar reconcile. Idempotent by scheduler id, so
 * calling it on every worker boot does not stack schedulers — same pattern as
 * scheduleMaintenance.
 *
 * Every 10 minutes: appointments booked directly in the CRM should surface
 * within a coffee break, and the on-demand endpoint covers "right now".
 */
export async function scheduleAppointmentReconcile(): Promise<void> {
  await crmSyncQueue.upsertJobScheduler(
    'appointment-reconcile-fanout',
    { pattern: '*/10 * * * *' },
    { name: 'reconcile-appointments-fanout' }
  );
}
```

Add a fan-out branch in the processor that enqueues one job per eligible client:

```typescript
  if (job.name === 'reconcile-appointments-fanout') {
    const { data: conns } = await supabase
      .from('crm_connections')
      .select('client_id')
      .eq('is_active', true);
    for (const c of conns ?? []) {
      await crmSyncQueue.add(
        'reconcile-appointments',
        { kind: 'reconcile-appointments', clientId: c.client_id },
        { jobId: `reconcile-${c.client_id}-${Math.floor(Date.now() / 600_000)}` }
      );
    }
    return;
  }
```

The `jobId` buckets by 10-minute window so an overlapping fan-out cannot double-enqueue the same client.

- [ ] **Step 7: Wire it into worker startup**

In `backend/src/workers/start.ts`, next to the existing `scheduleMaintenance()` call:

```typescript
  scheduleAppointmentReconcile().catch((err) =>
    logger.error({ err }, 'Failed to schedule appointment reconcile')
  );
```

Import `scheduleAppointmentReconcile` from `./crm-sync.worker.js`.

- [ ] **Step 8: Run tests and typecheck**

Run: `cd backend && npx vitest run src/__tests__/appointment-reconcile-job.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 9: Commit**

```bash
git add backend/src/types/queue.types.ts backend/src/workers/crm-sync.worker.ts backend/src/workers/start.ts backend/src/__tests__/appointment-reconcile-job.test.ts
git commit -m "feat(workers): schedule inbound appointment reconcile every 10 minutes"
```

---

### Task 6: On-demand sync endpoint

**Files:**
- Modify: `backend/src/routes/booking.route.ts`
- Test: `backend/src/__tests__/appointment-reconcile-route.test.ts`

**Interfaces:**
- Consumes: `reconcileAppointments(clientId)` from Task 4
- Produces: `POST /booking/sync-from-crm` with body `{ clientId: string }`, responding `{ success: true, data: ReconcileResult }`

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/appointment-reconcile-route.test.ts`. This follows the bare-Fastify + mocked-`requirePermission` convention used by `crm-provisioning-route.test.ts`: no real database, no real auth, just the route under test registered on a throwaway instance.

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { JwtPayload } from '../types/index.js';

const reconcileAppointments = vi.fn(async () => ({
  pulled: 3, created: 2, updated: 1, skipped: 0,
}));
vi.mock('../booking/appointment-reconciler.js', () => ({ reconcileAppointments }));

// Real route, fake permission gate — same shape as crm-provisioning-route.test.ts.
let currentUser: JwtPayload | null = null;
vi.mock('../middleware/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/index.js')>();
  return {
    ...actual,
    requirePermission: () => async (
      request: { user?: JwtPayload },
      reply: { code: (n: number) => { send: (b: unknown) => void } }
    ) => {
      if (!currentUser) return reply.code(401).send({ error: 'Unauthorized' });
      request.user = currentUser;
    },
  };
});

// The booking service is not under test here; stub it so importing the route
// does not drag in Redis or Supabase.
vi.mock('../booking/booking.service.js', () => ({ bookingService: {} }));
vi.mock('../queues/index.js', () => ({ redis: {}, bookingQueue: { add: vi.fn() } }));
vi.mock('../db/index.js', () => ({ supabase: { from: vi.fn() } }));

const CLIENT_ID = '5f31ba41-edc8-472c-a0c3-3f5e89639785';

async function buildApp(): Promise<FastifyInstance> {
  const { bookingRoutes } = await import('../routes/booking.route.js');
  const app = Fastify();
  await app.register(bookingRoutes);
  await app.ready();
  return app;
}

describe('POST /booking/sync-from-crm', () => {
  beforeEach(() => {
    reconcileAppointments.mockClear();
    currentUser = { sub: 'u-1', clientId: CLIENT_ID, role: 'admin' } as unknown as JwtPayload;
  });

  it('reconciles the requested client and returns the counts', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/booking/sync-from-crm',
      payload: { clientId: CLIENT_ID },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ pulled: 3, created: 2, updated: 1 });
    expect(reconcileAppointments).toHaveBeenCalledWith(CLIENT_ID);
  });

  it('rejects an unauthenticated caller', async () => {
    currentUser = null;
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/booking/sync-from-crm',
      payload: { clientId: CLIENT_ID },
    });

    expect(res.statusCode).toBe(401);
    expect(reconcileAppointments).not.toHaveBeenCalled();
  });
});
```

Before writing this, confirm the export name of the route plugin in `backend/src/routes/booking.route.ts` and the `JwtPayload` field names, and adjust the two spots above if they differ. Everything else is exact.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run src/__tests__/appointment-reconcile-route.test.ts`
Expected: FAIL — 404, route not registered.

- [ ] **Step 3: Add the route**

In `backend/src/routes/booking.route.ts`, following the auth/permission/validation shape of the existing `POST /booking/create` handler in the same file:

```typescript
  /**
   * Pull the CRM calendar into local appointments immediately.
   *
   * The scheduled reconcile runs every 10 minutes; this exists so an operator
   * who just booked something in the CRM can see it now instead of waiting.
   */
  app.post('/booking/sync-from-crm', {
    schema: { body: z.object({ clientId: z.string().uuid() }) },
    // Same preHandler auth/permission chain as POST /booking/create.
  }, async (request, reply) => {
    const { clientId } = request.body as { clientId: string };
    const result = await reconcileAppointments(clientId);
    return reply.send({ success: true, data: result });
  });
```

Import `reconcileAppointments` from `../booking/appointment-reconciler.js`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx vitest run src/__tests__/appointment-reconcile-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify the CORS method list covers POST**

`@fastify/cors` defaults `methods` to `GET,HEAD,POST`, and this project has previously had every non-GET write preflight-blocked by that default. POST is covered by the default, but confirm the configured list in `app.ts` explicitly includes it.

Run: `cd backend && grep -n -A 8 "cors" src/app.ts`
Expected: an explicit `methods` array including `POST`. If `methods` is set and omits POST, add it.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/booking.route.ts backend/src/__tests__/appointment-reconcile-route.test.ts
git commit -m "feat(api): POST /booking/sync-from-crm for on-demand calendar reconcile"
```

---

### Task 7: Make the bookings page actually list appointments, and add "Sync now"

**The bookings page is currently hardcoded-empty.** `dashboard/src/app/dashboard/bookings/page.tsx:22-27` calls `GET /booking/availability` and throws the response away — it only calls `setLoading(false)` in `.finally()` and never calls `setAppointments`. So `appointments` is permanently `[]` and the page always renders "No appointments found."

There is also no HTTP route that lists appointments at all: `bookingService.listAppointments(clientId, status?)` exists at `booking/booking.service.ts:453` but nothing exposes it. Seeding data changes nothing visible until both are fixed.

**Files:**
- Modify: `backend/src/routes/booking.route.ts` — add `GET /booking/appointments`
- Modify: `dashboard/src/app/dashboard/bookings/page.tsx`
- Test: `backend/src/__tests__/appointment-list-route.test.ts`

**Interfaces:**
- Consumes: `POST /booking/sync-from-crm` from Task 6; `bookingService.listAppointments(clientId, status?)`
- Produces: `GET /booking/appointments?clientId=&status=` returning `Appointment[]`

- [ ] **Step 1: Write the failing test for the list route**

Create `backend/src/__tests__/appointment-list-route.test.ts`, reusing the mocking shape from `appointment-reconcile-route.test.ts` in Task 6:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { JwtPayload } from '../types/index.js';

const listAppointments = vi.fn(async () => [
  { id: 'a-1', title: 'Botox', start_time: '2026-08-14T13:00:00Z', status: 'confirmed' },
]);
vi.mock('../booking/index.js', () => ({ bookingService: { listAppointments } }));

let currentUser: JwtPayload | null = null;
vi.mock('../middleware/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/index.js')>();
  return {
    ...actual,
    requirePermission: () => async (
      request: { user?: JwtPayload },
      reply: { code: (n: number) => { send: (b: unknown) => void } }
    ) => {
      if (!currentUser) return reply.code(401).send({ error: 'Unauthorized' });
      request.user = currentUser;
    },
  };
});

const CLIENT_ID = '5f31ba41-edc8-472c-a0c3-3f5e89639785';

async function buildApp(): Promise<FastifyInstance> {
  const { bookingRoutes } = await import('../routes/booking.route.js');
  const app = Fastify();
  await app.register(bookingRoutes);
  await app.ready();
  return app;
}

describe('GET /booking/appointments', () => {
  beforeEach(() => {
    listAppointments.mockClear();
    currentUser = { sub: 'u-1', clientId: CLIENT_ID, role: 'admin' } as unknown as JwtPayload;
  });

  it('returns the client\'s appointments', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/booking/appointments?clientId=${CLIENT_ID}` });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
    expect(listAppointments).toHaveBeenCalledWith(CLIENT_ID, undefined);
  });

  it('passes a status filter through', async () => {
    const app = await buildApp();
    await app.inject({ method: 'GET', url: `/booking/appointments?clientId=${CLIENT_ID}&status=confirmed` });
    expect(listAppointments).toHaveBeenCalledWith(CLIENT_ID, 'confirmed');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run src/__tests__/appointment-list-route.test.ts`
Expected: FAIL — 404, route not registered.

- [ ] **Step 3: Add the list route**

In `backend/src/routes/booking.route.ts`, inside `bookingRoutes`, matching the `requirePermission` + `assertClientAccess` shape used by the handlers already in the file:

```typescript
  const listQuerySchema = z.object({
    clientId: z.string().uuid(),
    status: z.string().optional(),
  });

  /**
   * List a client's appointments. bookingService.listAppointments has existed
   * since launch with nothing exposing it, which is why the dashboard bookings
   * page had no data source and always rendered empty.
   */
  app.get('/booking/appointments', {
    preHandler: requirePermission('bookings:read'),
    handler: async (request, reply) => {
      const query = listQuerySchema.parse(request.query);
      const user = request.user as JwtPayload;
      if (!assertClientAccess(user, query.clientId)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const appointments = await bookingService.listAppointments(query.clientId, query.status);
      return reply.send({ success: true, data: appointments });
    },
  });
```

Confirm `bookings:read` is a real permission — check the permission seed in the RBAC migration and use the existing read permission name for bookings if it differs.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx vitest run src/__tests__/appointment-list-route.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Fix the page's data loading and add the sync control**

In `dashboard/src/app/dashboard/bookings/page.tsx`, replace the broken `fetchAppointments` with one that actually stores results, and add the sync action:

```tsx
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);

  const fetchAppointments = (cid: string) => {
    if (!cid) return;
    setLoading(true);
    api.get(`/booking/appointments?clientId=${cid}`)
      .then((r) => setAppointments(r.data.data ?? []))
      .catch(() => setAppointments([]))
      .finally(() => setLoading(false));
  };

  const syncFromCrm = async () => {
    if (!clientId) return;
    setSyncing(true);
    setSyncNote(null);
    try {
      const { data } = await api.post('/booking/sync-from-crm', { clientId });
      const r = data.data as { created: number; updated: number; skipped: number };
      setSyncNote(`${r.created} added, ${r.updated} updated${r.skipped ? `, ${r.skipped} skipped` : ''}`);
      fetchAppointments(clientId);
    } catch {
      setSyncNote('Sync failed — check the CRM connection.');
    } finally {
      setSyncing(false);
    }
  };
```

Then replace the bare `<h1>` with a header row carrying the control:

```tsx
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Bookings</h1>
        <div className="flex items-center gap-3">
          {syncNote && <span className="text-sm text-gray-500">{syncNote}</span>}
          <button
            onClick={syncFromCrm}
            disabled={syncing}
            className="px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {syncing ? 'Syncing…' : 'Sync from CRM'}
          </button>
        </div>
      </div>
```

- [ ] **Step 6: Match the button to the design system**

This file still uses raw palette classes (`bg-green-100`, `text-gray-400`) and predates the cobalt token sweep, so it may fail the repo's design guard. Check how buttons are styled elsewhere in the dashboard and use the same component or token classes for the new button rather than inventing styling.

Run: `cd dashboard && npm run lint`
Expected: no design-guard violations on the lines you added. Leave the file's pre-existing raw classes alone — sweeping them is unrelated work.

- [ ] **Step 7: Typecheck the dashboard**

Run: `cd dashboard && npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add backend/src/routes/booking.route.ts backend/src/__tests__/appointment-list-route.test.ts dashboard/src/app/dashboard/bookings/page.tsx
git commit -m "fix(bookings): list appointments on the bookings page, add CRM sync

The page called /booking/availability and discarded the response, never
calling setAppointments, so it always rendered 'No appointments found'
regardless of data. bookingService.listAppointments had also existed since
launch with no route exposing it."
```

---

### Task 8: Fix the two Bare Beauty CRM misconfigurations

Data fixes, not code. `crm_connections.pipeline_id` being NULL makes `gohighlevel.adapter.ts:87` throw on every `createLead`, and `crm_config.bookedStageId` points at "Demo Booked" in the Gravvia Sales pipeline, so booked patients land in the agency funnel.

**Files:**
- Create: `backend/scripts/fix-bare-beauty-crm-config.ts`

**Interfaces:**
- Consumes: nothing
- Produces: connection `30c6b232-c685-4f63-91a5-cde540ee8d60` with `pipeline_id = 'e0NAiS0aQ4x0BnBivn0c'` and `crm_config.bookedStageId = 'cf363f29-903e-4891-9ecc-d281996c38d0'`

- [ ] **Step 1: Record the current values**

Run a read against `crm_connections` for id `30c6b232-c685-4f63-91a5-cde540ee8d60` and paste `pipeline_id` and `crm_config` into the commit message. There is no migration history for data fixes, so the previous values must be recoverable from git.

- [ ] **Step 2: Write the fix script**

Create `backend/scripts/fix-bare-beauty-crm-config.ts`, idempotent, using the `dotenv/config` + `@supabase/supabase-js` pattern of the other scripts in that directory:

```typescript
/**
 * Point Bare Beauty's GHL connection at the Marketing Pipeline.
 *
 * Two defects, both one-field:
 *   - pipeline_id was NULL, so resolveAdapterConfig never set pipelineId and
 *     the adapter threw on every createLead. Lead capture had never worked.
 *   - bookedStageId pointed at "Demo Booked" in the Gravvia Sales pipeline, so
 *     patients who booked landed in the agency's own sales funnel.
 *
 * Idempotent: re-running sets the same values.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const CONNECTION_ID = '30c6b232-c685-4f63-91a5-cde540ee8d60';
const MARKETING_PIPELINE = 'e0NAiS0aQ4x0BnBivn0c';
const QUALIFIED_STAGE = 'cf363f29-903e-4891-9ecc-d281996c38d0';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const { data: conn, error: readErr } = await sb
  .from('crm_connections').select('crm_config').eq('id', CONNECTION_ID).single();
if (readErr) throw readErr;

const { error } = await sb
  .from('crm_connections')
  .update({
    pipeline_id: MARKETING_PIPELINE,
    crm_config: { ...(conn.crm_config ?? {}), bookedStageId: QUALIFIED_STAGE },
  })
  .eq('id', CONNECTION_ID);
if (error) throw error;

console.log('Bare Beauty CRM config updated:', { MARKETING_PIPELINE, QUALIFIED_STAGE });
```

- [ ] **Step 3: Run it**

Run: `cd backend && npx tsx scripts/fix-bare-beauty-crm-config.ts`
Expected: the confirmation line, no error.

- [ ] **Step 4: Verify `createLead` no longer throws**

Re-read the connection and confirm `pipeline_id` is set and `crm_config.bookedStageId` is the Qualified stage. Then confirm `resolveAdapterConfig` now yields a `pipelineId`, since that is the exact condition the adapter checks.

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/fix-bare-beauty-crm-config.ts
git commit -m "fix(crm): point Bare Beauty at the Marketing Pipeline

pipeline_id was NULL, so every createLead threw 'No GoHighLevel pipeline
configured' and lead capture into the CRM had never worked for this client.
bookedStageId pointed at 'Demo Booked' in the Gravvia Sales pipeline, filing
booked patients into the agency's own funnel.

Previous values: pipeline_id=NULL,
crm_config.bookedStageId=4b74f9df-0a80-45e8-8053-4acf74316fb7"
```

---

### Task 9: End-to-end acceptance

- [ ] **Step 1: Run the whole backend suite**

Run: `cd backend && npm test`
Expected: PASS. Record the total count; the suite was ~771 tests at last count, and this plan adds roughly 10.

- [ ] **Step 2: Create an appointment by hand in GoHighLevel**

In the GHL UI, book an appointment on calendar `KREH27KlJTMihZJFYZlu` against any contact in location `Z5IVkxMEOcTfCR4NUHEj`. Note the contact, time, and status.

- [ ] **Step 3: Trigger the sync and confirm it lands**

Click "Sync from CRM" on the dashboard bookings page (or `POST /booking/sync-from-crm`). Confirm the appointment appears with the right contact, start time, and a status matching what GHL showed.

This is the acceptance test for the whole plan. It must pass before the demo, not during it.

- [ ] **Step 3b: Confirm the pre-existing 4 appointments now render**

Independent of the new event, the bookings page should now list Bare Beauty's existing appointments — it rendered "No appointments found" for all of them before Task 7. Confirm they appear with their times and statuses.

- [ ] **Step 4: Confirm re-running does not duplicate**

Trigger the sync a second time. Expected: the appointment count is unchanged and the response reports it under `updated`, not `created`. This is what the migration 033 index buys.

---

## Notes for the follow-on plan

The demo data operation — deleting the 33 GHL contacts, seeding ~25 patients and their GHL appointments, backfilling the 19 Retell transcripts, seeding synthetic calls and `client_action_items` — is a separate plan that depends on this one. Its ordering matters: deleting the GHL contacts also deletes all 8 calendar events, so patients and appointments must be seeded in GHL and then pulled back through the reconciler built here.
