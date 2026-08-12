# Bare Beauty Demo Data — Design

**Date:** 2026-08-12
**Client:** Bare Beauty Medspa — `5f31ba41-edc8-472c-a0c3-3f5e89639785`
**GHL location:** `Z5IVkxMEOcTfCR4NUHEj` ("Bare Beauty Med Spa", Ponte Vedra Beach)
**CRM connection row:** `30c6b232-c685-4f63-91a5-cde540ee8d60`

## Goal

Make the Bare Beauty tenant demo-ready across the dashboard and the connected
GoHighLevel sub-account; fix the two live CRM misconfigurations found while
auditing it; and close the one-way appointment sync so appointments created in
GHL appear in the dashboard.

## Audit findings (verified 2026-08-11/12 against live Supabase + GHL)

### Supabase

| Table | Rows | Problem |
|---|---|---|
| calls | 19 | real Retell calls, recordings intact |
| contacts | 5 | 3 nameless, 0 emails, 0 CRM ids |
| appointments | 4 | all `pending`, all in the past (Jul 27–29) |
| call_transcripts | 0 | empty platform-wide |
| call_summaries | 0 | empty platform-wide |
| conversations | 0 | empty platform-wide |
| events | 109 | healthy |
| crm_sync_logs | 9 | all `success`, but every one is `appointment` or `booking-automation` — **zero** `lead` rows |
| tickets | 0 | support page empty |

Newest call is 2026-08-01, so any "last 7 days" view is empty.

The three empty tables are the documented consequence of the 42P10 bug fixed by
migration `028_call_id_unique_constraints.sql`. That migration's header records
the cause and notes Retell still held the transcripts. Confirmed: **19/19 are
still retrievable** from the Retell API, with summaries, `user_sentiment`, and
`call_successful`.

### GHL location

33 contacts, of which 32 are Gravvia test exhaust:

- 6 smoke/diag/deploy artifacts (`Smoke Test …`, `Diag Test`, `Gravvia DeployTest`, `Dry Run Caller` ×2, `Jordan Rivera` with a `+test-` email)
- 21 agency prospect seed records for the wrong verticals (Dental, Law Firm, Real Estate, Home Services) on `+1555010000X` numbers and `.example.com` emails
- 5 GHL stock `(Example)` samples
- 1 genuine caller (`Jaden Bennis`, `+12242431108` — the operator's own number, misspelled by the agent)

### Bug 1 — lead capture into GHL is broken

`crm_connections.pipeline_id` is `NULL`. `crm/credentials.ts:27` only sets
`pipelineId` when that column is non-null, and `crm/adapters/gohighlevel.adapter.ts:87`
throws when it is missing:

> `No GoHighLevel pipeline configured — pick one in CRM settings`

Every `createLead` from a live call therefore fails. This is why `crm_sync_logs`
contains no `lead` entries.

### Bug 2 — booked patients land in the agency sales funnel

Booking still works because `workers/crm-sync.worker.ts:58-73` falls back to
whichever pipeline contains `crm_config.bookedStageId`. Bare Beauty's
`bookedStageId` is `4b74f9df-0a80-45e8-8053-4acf74316fb7` — the **"Demo Booked"**
stage of the **"Gravvia Sales"** pipeline. A patient booking Botox becomes an
opportunity in Gravvia's own agency funnel.

### Constraint — pipelines cannot be created via API

The GHL public API exposes no pipeline-create operation (confirmed by searching
the write-operation registry); `gohighlevel.adapter.ts` says the same. The
existing **Marketing Pipeline** in the Bare Beauty location will be reused.

## Decisions

1. **Clean the GHL location in place** rather than relocating — preserves the
   connection, custom-field mapping, calendar `KREH27KlJTMihZJFYZlu`, and the
   successful appointment-sync history.
2. **Delete all 33 contacts**, including `Jaden Bennis`. The real call history
   lives in Supabase and is unaffected.
3. **Reuse Marketing Pipeline** `e0NAiS0aQ4x0BnBivn0c` rather than hand-building
   a Patient Journey pipeline in the UI.
4. **Backfill all 19 real transcripts**, and supplement with synthetic recent
   calls because the real set is not demo-worthy on its own (below).
5. **Every synthetic row carries a `demo_seed` marker** so seeded data can never
   be mistaken for real traffic or silently skew analytics. The carrying column
   differs per table — `calls` has no `metadata` column, so the marker cannot be
   uniform:

   | Table | Marker |
   |---|---|
   | `conversations` | `metadata.demo_seed = true` |
   | `appointments` | `metadata.demo_seed = true` |
   | `contacts` | `custom_fields.demo_seed = true` **and** tag `demo-seed` |
   | `calls` | `retell_call_id` prefixed `demo_seed_` (column is TEXT and UNIQUE) |
   | `call_transcripts`, `call_summaries` | none available — identified by join to a `demo_seed_`-prefixed call |
   | `tickets` | none available — identified by `source` |

   A single cleanup routine can therefore remove all seeded rows by selecting
   calls on the `demo_seed_` prefix and cascading, plus the two JSONB markers.

### Why the real transcripts are insufficient alone

Of the 19: only 4 are demo-worthy; 7 are hang-ups under 25 seconds ("No
substantive conversation or task was completed"); 2 carry Negative sentiment;
13 have `call_successful = false`, putting any success-rate tile near 21%.
Three summaries name platform defects in writing — *"encountered technical
issues preventing confirmation"*, *"Due to a technical error, the agent could
not connect her live"*. They are honest records of July debugging sessions and
belong in the database, but the demo cannot rest on them.

## Plan

### Part 1 — GHL cleanup and rewiring

Target location `Z5IVkxMEOcTfCR4NUHEj`.

1. Delete all 33 contacts. Deleting a contact cascades to its opportunities;
   26 carry one. Contact ids are enumerated in the implementation plan.
2. Update `crm_connections` row `30c6b232-c685-4f63-91a5-cde540ee8d60`:
   - `pipeline_id` → `e0NAiS0aQ4x0BnBivn0c` (Marketing Pipeline) — fixes Bug 1
   - `crm_config.bookedStageId` → `cf363f29-903e-4891-9ecc-d281996c38d0`
     ("Qualified") — fixes Bug 2. A booked consult is a qualified lead.
   - leave `calendarId` and `assignedUserId` untouched.

Marketing Pipeline stages:

| Stage | Id |
|---|---|
| New Lead | `8f59d079-38bf-4de9-8b11-f84602259534` |
| Contacted | `c2cf7c85-a45c-4012-b540-8445127aa468` |
| Qualified | `cf363f29-903e-4891-9ecc-d281996c38d0` |
| Proposal Sent | `89c1e365-1acb-4ab6-85dd-2c94608a2d6a` |
| Negotiation | `c31d31c5-f84b-4c4c-85bf-dec854cf999f` |
| Closed | `be371e37-060c-4887-a67c-6ba698589bd8` |

### Part 2 — GHL patient seed

~25 contacts that read as a Ponte Vedra med spa's patient list: local-sounding
names, `+1904` numbers, plausible personal-domain emails, service tags drawn
from the client's real catalog (Botox, Hydrafacial, Microneedling, Laser Hair
Removal, Body Contouring, Consultation). Created dates spread across the last
45 days, distributed across the six stages weighted toward the early ones, with
opportunity values matching the seeded service price.

### Part 3 — Supabase transcript backfill

For each of the 19 calls, fetch from Retell by `retell_call_id` and write:

- `call_transcripts` — `transcript` JSONB from `transcript_object`, `word_count`
  computed from the flat transcript
- `call_summaries` — `summary` from `call_analysis.call_summary`; `sentiment`
  **lowercased** to satisfy the `CHECK (sentiment IN ('positive','neutral','negative'))`
  constraint (Retell returns `Positive`/`Neutral`/`Negative`);
  `follow_up_required` from `call_successful = false`
- `conversations` — `sentiment`, `summary`, and the `booking_requested` /
  `handoff_requested` flags inferred from the transcript

All three tables have a UNIQUE index on `call_id` as of migration 028, so writes
use `upsert(..., { onConflict: 'call_id' })` and are safely re-runnable.

### Part 4 — Supabase synthetic demo data

- ~15 calls dated across the last 10 days with matching transcripts, summaries,
  and conversations; realistic med spa dialogue; a success mix that reflects a
  healthy agent rather than a perfect one
- Contacts for each, with names and emails
- Repair the 4 stale `pending` appointments and add upcoming ones, using status
  variety across the schema's `pending`/`confirmed`/`completed`/`cancelled`/`no_show`
- 2–3 support tickets so the support page is populated

Schema notes for the implementer:

- `appointments` columns are `start_time` / `end_time` / `title` / `service_type`
  (not `starts_at`), and `contact_id` is `NOT NULL`.
- `contacts` has no `status` column; it carries `tags TEXT[]`, `custom_fields
  JSONB`, and `external_crm_id` (the GHL contact id belongs there).
- `calls` has no `metadata` column — see the marker table above.

### Part 5 — Inbound appointment sync (GHL → dashboard)

Appointment sync is currently **one-way**. `workers/crm-sync.worker.ts` pushes
Gravvia appointments into GHL and mirrors back only the event id. There is no
GHL webhook route (`routes/webhooks/` holds Retell and Clay handlers only) and
the GHL adapter has no method to read calendar events.

Verified live on calendar `KREH27KlJTMihZJFYZlu`: **GHL holds 8 events, the
dashboard holds 4 appointments.** The four "Marketing Call" events created
directly in GHL (Jul 21–25) never reached the dashboard. All 8 are `confirmed`
in GHL while all 4 local rows are still `pending` — unreconciled status drift.

`GET /calendars/events` is readable with the existing Private Integration Token
(confirmed by live call), so no new scopes or re-auth are required.

**Mechanism: polling reconciler plus an on-demand trigger.**

1. **Migration 033** — unify on the existing, currently-unused
   `appointments.external_calendar_id` column:
   - backfill it from `metadata.crm_event_id`
   - add `CREATE UNIQUE INDEX … ON appointments(client_id, external_calendar_id)
     WHERE external_calendar_id IS NOT NULL` so inbound upserts have a valid
     `ON CONFLICT` target (the same class of defect migration 028 fixed)
   - update `crm-sync.worker.ts:262` to write the column, still writing
     `metadata.crm_event_id` for back-compat with `booking.service.ts`
2. **Adapter capability** — add an *optional* `listCalendarEvents()` to the CRM
   interface and implement it on the GoHighLevel adapter. Optional keeps other
   adapters compiling untouched, per the "installable without modifying
   existing code" rule in CLAUDE.md.
3. **Reconciler worker** — BullMQ repeatable job over every client with an
   active CRM connection and a configured `calendarId`. Rolling window −7d to
   +60d. For each event: resolve the contact by `contacts.external_crm_id`
   (creating one if absent, since `appointments.contact_id` is `NOT NULL`),
   then upsert on `(client_id, external_calendar_id)`. Map GHL
   `appointmentStatus` onto the local CHECK enum
   (`pending`/`confirmed`/`cancelled`/`rescheduled`/`completed`/`no_show`).
   Write outcomes to `crm_sync_logs` so the CRM page shows inbound activity.
4. **On-demand trigger** — an endpoint plus a "Sync now" control on the bookings
   page, so a GHL appointment can be pulled in immediately during a demo rather
   than waiting for the next poll.

### Part 6 — Dashboard tasks

`client_action_items` (migration 008, the "Waiting on You" list rendered at
`/dashboard/onboarding` via `GET /action-items`) has **0 rows** for Bare Beauty.
Seed 8–10 realistic med spa front-desk items — confirming consults, following up
no-shows, reviewing agent escalations — with a mix of `pending` and `done` so the
list reads as lived-in. Status is constrained to those two values.

### Ordering dependency

Deleting the 33 GHL contacts also removes all 8 calendar events, because every
event belongs to one of those contacts. The 4 local appointments would then
reference deleted GHL events. Sequence therefore matters:

1. Delete GHL contacts (events go with them)
2. Seed the ~25 GHL patients **and their appointments** in GHL
3. Run the new reconciler

Step 3 populates the dashboard's bookings page *through the new sync path*,
which both fixes the data and demonstrates the capability working end to end.
Local appointment seeding (Part 4) is limited to rows that intentionally have no
GHL counterpart, so the reconciler is the source of truth for the rest.

### Part 7 — Verification

Re-run the audit query and confirm no demo-relevant table is empty and no
dashboard page renders a blank state. Spot-check a call detail page, the
bookings page, the tasks list, and the analytics date range. Confirm
`createLead` no longer throws by exercising the CRM sync path.

**End-to-end check for the inbound sync:** create an appointment by hand in the
GHL UI, trigger "Sync now", and confirm it appears on the dashboard bookings
page with the correct contact, time, and status. This is the acceptance test for
Part 5 and should be run before the demo, not during it.

## Out of scope

- Repointing Bare Beauty to a different GHL sub-account
- Renaming pipeline stages (not possible via API)
- Backfilling transcripts for the other tenants' calls (2 calls exist outside
  Bare Beauty; same mechanism would work if wanted later)
- Inbound sync of GHL contacts or opportunities — this covers appointments only
- Real-time push (GHL webhook). The reconciler's on-demand trigger covers the
  demo need; a webhook can be layered on later without changing the upsert path.

## Risks

- **Deletion is irreversible.** The 32 junk records are reconstructible from
  seed scripts; `Jaden Bennis` is not, though it duplicates data already in
  Supabase. Full delete list reviewed and approved 2026-08-12.
- **Synthetic data leaking into real reporting.** Mitigated by the `demo_seed`
  markers, but the coverage is uneven: `call_transcripts`, `call_summaries`, and
  `tickets` have no column to carry one and are only identifiable by join. Any
  future "exclude demo data" reporting filter must go through `calls`, not
  through a single shared flag.
- **Reused pipeline has B2B stage names.** "Qualified"/"Proposal Sent" read as
  sales rather than clinical. Accepted deliberately over a manual UI step.
