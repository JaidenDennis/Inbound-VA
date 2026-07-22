# Inbound Build — Phase 5 Verification Report (Account & Ops)

Date: 2026-07-21 · Tests: **35 files / 227 passing** (`npx vitest run`; `npx tsc --noEmit` clean). Prior: 34/214 (Phase 4). **Final phase — all 25 workflows implemented.**

## What was built

**Identity verification guard (the core of the account capability):**
- `verify_identity` tool (in workflow-functions, mutates session): matches caller-provided factors (email / DOB / appointment reference) against the contact record; on success sets `session.state.identityVerified = true` and pins `context.contactId`. Required factors are client-configured (`agent_config.identity_verification_fields`); default requires the phone to resolve a contact **plus one** corroborating factor.
- `_guards.ts` `requireVerifiedIdentity(...states)` — reusable state guard the account workflows attach to their data-exposing states, so the state machine refuses to advance (with "verify first" guidance) in addition to the scope guard's per-action `requiresVerifiedIdentity` enforcement. Defense in depth at two layers.

**Account tools (identity-gated), degrading gracefully per audit conflict #11** (no payments/membership backend):
- `membership_lookup` — program benefits from config + synced membership fields; specifics (balances, freezes, upgrades, cancellations) routed to staff, never fabricated.
- `payment_lookup` — financing/deposit options from `business_policies`; account-specific balance/refund questions become a staff task with an explicit "never state a figure" instruction.
- `documentation_request` — receipts/invoices/records/consent forms logged as staff tasks; **medical records are request-only and never read aloud** (PHI protection baked into the response guidance).

**Support & ops tools:**
- `create_complaint` — files a caller ticket via the new `ticketService.createFromCaller` (additive `tickets` columns `contact_id`/`call_id`/`source='voice'`, `created_by` NULL), tags the contact, escalates by email.
- `schedule_callback` — now also persists a trackable `callback_requests` record (status lifecycle) alongside the staff alert.
- `set_language` / `set_location` — record the caller's language / chosen location in the global conversation context (Retell voice/prompt switching via dynamic variables plugs in here later).

**Schema (additive)** — `supabase/migrations/014_account_ops.sql`: `callback_requests` (lifecycle table) + additive `tickets` columns for caller-complaint provenance. No column repurposed.

**Workflows (declarative, 11 new)** — `identity_verification`, `existing_client_lookup`, `membership`, `payment_questions`, `documentation_requests` (all identity-guarded on their data states), `staff_transfer` (notify + callback/message fallback so callers are never dropped), `callback_request`, `complaint`, `multi_location_routing`, `language_selection`. All registered; routing template carries all seven new tool specs; `RETELL_FUNCTION_NAMES` extended.

## What was verified, and how

`__tests__/account-ops.test.ts` (13):
- **Identity gate end to end**: `membership_lookup` denied before verification → `verify_identity` matches on email and flips the session (+ pins contactId) → `membership_lookup` now allowed and returns the program; a mismatched factor fails verification.
- **Graceful degradation**: `payment_lookup` routes a balance question to staff without quoting a figure, but shares configured financing policy for general questions; `documentation_request` marks medical records request-only with a never-read-aloud instruction.
- **Support**: `create_complaint` files the caller ticket (priority passed through) and escalates; `schedule_callback` persists the `callback_requests` record.
- **System**: `set_language` / `set_location` write the conversation context.
- **Definitions**: all account/support/system intents route correctly; account workflows guard their data states behind `identityVerified` and grant the expected scopes.

Note: the workflow registry's intent-uniqueness validation caught a real collision during this phase (`location` claimed by both `faq` and `multi_location_routing`) — fixed by renaming faq's intent to `address`. That's the validation doing its job at registration time.

Full regression suite green.
