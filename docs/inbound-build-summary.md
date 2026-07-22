# Inbound Conversation System — Build Summary

Governing rule: **Retell talks. The backend decides. Supabase remembers. GHL shows.**

Status: **All phases complete (0–5).** `npx vitest run` → **35 files / 227 tests passing** (from a 27/165 baseline); `npx tsc --noEmit` clean. Additive-only schema; all pre-existing behavior preserved.

## Phase reports
- `docs/audit-inbound-baseline.md` — Phase 0 audit + 12 prompt-vs-codebase conflicts (codebase wins).
- `docs/inbound-phase-1-report.md` … `inbound-phase-5-report.md` — per-phase build + verification.

## Architecture delivered

**Generic engine, declarative workflows** (`src/workflows/`): a single state-machine engine (`engine/workflow-engine.ts`) owns transitions, slot validation, guards, the topic-switch stack, and event emission. Each of the 25 workflows is a small declarative file in `definitions/` — adding #26 is one file + one `registerWorkflow` call, zero engine changes. The registry validates every definition at registration (unknown states/transitions/guard targets, duplicate intent claims).

**Backend-driven routing**: the shared `inbound_routing` agent template classifies intent and calls `route_intent`; the engine maps intent → capability → workflow and returns a contract (workflow, state, missing slots, granted scopes, guidance). `update_workflow` reports slots and drives backend-validated transitions/completion. Topic switches pause+stack the active workflow and resume it automatically.

**Capability scopes enforced independently of the LLM**: `enforceScope(tool)` runs after signature validation on every tool; for routing-enabled calls it rejects any action outside the active workflow's granted scopes (and identity-required actions before verification), audits the denial, and returns conversational recovery guidance. Legacy (non-routing) agents pass through untouched.

**Deterministic session state** (`call_sessions`, migration 011): per-call active workflow + state, stack, collected slots, granted scopes, identity status, and a global conversation context — keyed by `retell_call_id` so calls resume across stateless webhooks and survive a missed `call_started`.

**Every transition audited**: `workflow.*` and `emergency.flagged`/`waitlist.added` events flow through the existing append-only `events` table.

**Emergency hard rule**: base prompt + `emergency_flag` notify management immediately with no routing round-trip; staff notification never depends on session persistence.

## The 25 workflows by capability
- **appointments**: book_appointment, reschedule_appointment, cancel_appointment (client cancellation policy), waitlist, existing_appointment_inquiry
- **knowledge**: faq, pricing, promotions, general_information (deterministic `knowledge.search` over relational tables with JSONB fallback)
- **leads**: lead_qualification (CRM pipeline push), new_client_intake (consent-gated), intake_forms, plus follow-up/missed-call via the existing delayed-job automation
- **account** (identity-gated): identity_verification, existing_client_lookup, membership, payment_questions, documentation_requests
- **support**: staff_transfer, callback_request, complaint
- **system**: emergency, multi_location_routing, language_selection, end_call

## CRM/calendar (canonical types only)
`ICrmAdapter` gained `getAvailability`/`createBooking`/`updateBooking`/`cancelBooking` (canonical shapes). GoHighLevel implements them (v2 calendars API); the new **noop** adapter stubs the entire interface. `bookingService` uses the CRM calendar as availability truth when configured, falling back to the internal rules engine; reschedule/cancel push back to the CRM via `metadata.crm_event_id`.

## Migrations added (additive)
`011_call_sessions`, `012_knowledge_tables` (services/pricing/faqs/promotions), `013_waitlist`, `014_account_ops` (callback_requests + tickets caller columns).

## Deferred by design
- Per-call Retell **dynamic variables** for live voice/language switching (preferences are captured now; switching plugs in without refactor).
- **SMS** delivery (`sms.send` slot reserved) — voice-only launch per CLAUDE.md.
- Dashboard CRUD for the new knowledge/waitlist/callback tables (backend + schema ready).
- Live SIP **warm transfer** (Retell built-in, enable per client); `staff_transfer` uses the deterministic notify + callback/message fallback today.
