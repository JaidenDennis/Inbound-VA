# Inbound Build — Phase 4 Verification Report (Lead Capture)

Date: 2026-07-21 · Tests: **34 files / 214 passing** (`npx vitest run`; `npx tsc --noEmit` clean). Prior: 33/208 (Phase 3).

## What was built

**`qualify_lead` now actually pushes to the CRM** (audit gap: previously captured only locally):
- On capture it enqueues a `crm-sync` `lead` job (→ `adapter.createLead` → opportunity in the client's configured pipeline/stage), idempotent per call, skipped when the client has no active CRM connection.
- Alerts staff with a lead notification email (idempotent per call).
- The crm-sync worker's `lead` branch now resolves the CRM's own contact id first (same as notes/appointments/summaries), so the opportunity attaches to the right person.

**`forms_send` action + tool** — intake/consent form delivery:
- Emails the client's configured `intake_form_url` (from `client_settings.agent_config`) when the caller has an email; contact upserted with an `intake` tag.
- **Staff-task fallback** when there's no email or no configured link — a `staff_notifications` row so nothing is ever silently dropped. Voice-only launch keeps the `sms.send` slot reserved (unimplemented); the SMS channel plugs in here later without refactoring.
- Additive settings: `agent_config.intake_form_url`, `agent_config.intake_questions`.

**Workflows (declarative)**:
- `lead_qualification` — gather → capture (qualify_lead) → offer_next_step (book once) → complete; qualification fields woven in naturally, not interrogated.
- `new_client_intake` — gather (with **explicit consent slot validation** — an affirmative is required before profile creation) → create_profile → send_forms → complete; client-configured intake questions, never hardcoded.
- `intake_forms` — determine (does this service need forms?) → send → complete.

**follow_up / missed_call_recovery (audit conflict #2, #10):** no new modules — these reuse the existing delayed-BullMQ + `post-call.automation.ts` pattern. Lead recovery (qualified-but-unbooked, 1 h) and missed-call nudge (15 min) already fire from `handleCallSummaryCompleted`; the new `qualify_lead` CRM push means those outcomes are now derived from real lead+opportunity state. No migrations needed beyond Phase 2/3 (as the prompt anticipated).

**Wiring** — 3 definitions registered; `forms_send` in `RETELL_FUNCTION_NAMES`, action metadata (`scope: crm`), routing-template tool spec + tool list.

## What was verified, and how

`__tests__/leads.test.ts` (7):
- `qualify_lead`: enqueues the `lead-capture` CRM job with the correct pipeline payload (`contactId`, `Name — Service` title, `inbound-voice` source) and fires the staff `new-lead` notification; **skips the CRM sync when no active connection exists**.
- `forms_send`: emails the configured link when email present (recipient + body asserted, no staff task); **staff-task fallback** when the caller has no email; staff-task fallback when no link configured (no email queued).
- Lead workflows route with the `crm` scope; the `new_client_intake` consent validator rejects "no" and accepts "yes".

Full regression suite green; no prior test needed changes this phase.

## Carried forward
- Proactive outbound follow-up sequences (consultation reminder, no-show, post-treatment) remain delayed-job driven; a dedicated outbound sequence UI is out of scope for the inbound build.
