# Inbound Build — Phase 3 Verification Report (Booking Suite)

Date: 2026-07-21 · Tests: **33 files / 208 passing** (`npx vitest run`; `npx tsc --noEmit` clean). Prior: 30/191 (Phase 2).

## What was built

**Canonical CRM-calendar capability** (audit conflict #10):
- `types/crm.types.ts` — `CrmAvailabilityRequest` / `CrmAvailabilitySlot` / `CrmBookingUpdate`; the engine and actions never see vendor shapes.
- `ICrmAdapter` — optional calendar methods `getAvailability` / `createBooking` / `updateBooking` / `cancelBooking`; adapters without a calendar stay untouched.
- **GoHighLevel** implements all four against the v2 calendars API (`free-slots` flattened across days, epoch-ms params, `2021-04-15` Version header; PUT/DELETE for update/cancel; `createBooking` delegates to the existing calendar-aware `createAppointment` with round-robin `assignedUserId` support).
- **New `noop` adapter** registered in the plugin registry — stubs the ENTIRE interface including the calendar methods (the canonical "does nothing, breaks nothing" implementation the audit flagged as missing).

**Booking service** (`src/booking/booking.service.ts`):
- Availability source of truth: active CRM connection + configured `calendarId` ⇒ the CRM calendar answers (its empty answer stands); no connection ⇒ existing internal rules engine; CRM errors ⇒ logged fallback so an outage never strands a caller.
- Reschedule/cancel now push the change back to the CRM calendar via `updateBooking`/`cancelBooking` using `appointments.metadata.crm_event_id`, which the crm-sync worker mirrors from the CRM's response when the original booking synced (read-merge-write; no columns repurposed).
- `addToWaitlist` persists to the new `waitlist_entries` table and publishes `waitlist.added` for staff automation.

**Schema (additive)** — `supabase/migrations/013_waitlist.sql`: `waitlist_entries` (contact/call FKs, service, `preferred_days[]`, `preferred_times`, status waiting→notified→booked/cancelled), standard trigger + RLS.

**Tools** (Zod-validated, signature + scope-guarded, tenant-checked):
- `find_appointment` — upcoming appointments by confirmed phone (top 3, excludes cancelled/completed).
- `reschedule_appointment` — duration-preserving move; conflict answers offer alternatives.
- `cancel_appointment` — **client-configured cancellation policy** (`booking_rules.cancellation_notice_hours` + `cancellation_policy` text, additive fields): the backend decides whether the policy applies and instructs the agent to read it verbatim.
- `waitlist_add` — contact upsert (`waitlist` tag) + entry with preferences.
- Cross-tenant guard: operations on an appointment belonging to another client are refused.

**Workflows (declarative)** — `book_appointment` (gather → check_availability → offer_alternatives → confirm → execute → complete; slots validated against the live menu, future-time and phone-shape rules), `reschedule_appointment`, `cancel_appointment` (offers keep/reschedule before executing), `waitlist`, `existing_appointment_inquiry` (light identity confirmation before readback). All registered; routing template carries the four new tool specs; `RETELL_FUNCTION_NAMES` extended.

## What was verified, and how

- `ghl-calendar.test.ts` (6): free-slots parsing/sorting/params/Version header; no-calendar short-circuit; updateBooking PUT body; cancelBooking DELETE + failure-as-result; noop adapter full-interface stub.
- `booking-crm-truth.test.ts` (5): CRM answers when configured; **empty CRM answer respected** (no contradicting fallback); fallback on missing connection and on CRM error; waitlist persistence + `waitlist.added` event.
- `booking-tools.test.ts` (7): find/reschedule (duration preserved)/cancel with policy inside the notice window, no policy outside it, cross-tenant refusal, waitlist capture; booking intents route to their workflows with the booking scope.
- Full regression suite green; no baseline test needed changes this phase.

## Carried forward
- Booked-slot conflict detection stays with the existing local `hasConflict` at write time; GHL additionally validates via its own calendar on write-back (`ignoreFreeSlotValidation` deliberately kept per the live-tested fix).
- Waitlist → caller notification automation (when an opening appears) is staff-driven via the event/notification chain; proactive caller outreach belongs to the outbound follow-up track.
