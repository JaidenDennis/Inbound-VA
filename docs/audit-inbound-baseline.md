# Inbound Conversation System — Phase 0 Baseline Audit

Date: 2026-07-21
Baseline test status: **27 test files, 165 tests, all passing** (`npx vitest run`)
Repo: `Inbound Agent v4` — backend at `backend/` (Node.js, **TypeScript ESM**, Fastify, Supabase, Redis/BullMQ), dashboard at `dashboard/` (Next.js), schema at `supabase/` (`setup.sql` = consolidated, `migrations/001–010` = incremental).

This audit maps what actually exists against the inbound build prompt's assumptions. **Where they conflict, the codebase wins**; every conflict is flagged in §6 with a proposed adjustment.

---

## 1. Existing structure map

### Entry layer (webhooks & tools)
| Concern | Where | Notes |
|---|---|---|
| Retell event webhook (single URL) | `src/routes/webhooks/retell-dispatcher.route.ts` | `POST /webhooks/retell`; switches on `envelope.event`: `call_started` / `call_ended` / `call_analyzed`. Provisioning points every agent here. |
| Granular legacy webhooks | `call-started.route.ts`, `call-ended.route.ts`, `transcript.route.ts`, `summary.route.ts` | Kept for compatibility; same services as dispatcher. |
| Retell custom tools ("functions") | `src/routes/functions/retell-functions.route.ts` | One Fastify POST route per tool at `/functions/retell/<name>`. Zod-validates `args`, resolves tenant per call, executes, returns `{ …, message }` where `message` is conversational guidance for the LLM. |
| Signature validation | `src/middleware/retell-signature.middleware.ts` → `providers/retell/retell.validator.ts` | HMAC over the exact raw body (custom content-type parser in `app.ts` captures `rawBody`). Applied as `preHandler` to the dispatcher AND every function route. |

**Tenant resolution convention** (used by dispatcher and every tool): `clientService.findByPhoneNumber(call.to_number)` → fallback `clientService.findByAgentId(call.agent_id)`. There is **no shared cross-tenant agent**; each client has its **own provisioned agent**, and multi-tenancy is achieved by per-call tenant resolution + per-client provisioning.

### Orchestration
There is **no `callLifecycle` / `smsLifecycle`**. Call orchestration lives in the dispatcher handlers:
- `call_started` → upsert contact by phone, create `calls` row, publish `call.started`.
- `call_ended` → close `calls` row, upsert `conversations` (summary/sentiment/analysis metadata), publish `call.ended`.
- `call_analyzed` → `callRecordService.recordFromAnalyzed` (dashboard `call_records`, idempotent on `retell_call_id`, resolves tenant independently), upsert `call_summaries`, enqueue transcript processing, enqueue CRM summary push, publish `call.summary.completed`.

**SMS does not exist anywhere** (by design — CLAUDE.md: voice-only launch; design so SMS can be added later).

### Intelligence / automation
There is **no automationEngine / outcomeEngine / sequenceEngine / missedCallRecovery service**. What exists:
- `src/automation/post-call.automation.ts` — the closest thing to an outcome engine. On `call.summary.completed`: derives outcome (`booked` | `qualified_no_booking` | `handoff` | `info_only` | `missed`) from `appointments` + `conversations` flags, enqueues a CRM outcome note, schedules delayed BullMQ follow-ups (lead-recovery 1 h, missed-call nudge 15 min). On `booking.requested`: CRM booking automation (tag + task + opportunity stage move / create), confirmation email now, reminder email 24 h before start.
- `src/automation/index.ts` — `registerAutomationSubscribers()`; idempotent, wired in **both** `app.ts` (API) and `workers/index.ts` (worker process).
- `automation_rules` / `automation_runs` tables exist in schema but are **not read by any code** — the declarative rule engine was never wired. (Relevant: the new workflow engine should not assume it exists.)

### Events
- `src/events/event-bus.ts` — in-process `EventEmitter` singleton. `publish()` persists to the `events` table (upsert on `idempotency_key`, `ignoreDuplicates`) then emits locally. Append-only audit trail + replay source.
- `src/types/event.types.ts` — `EventType` union (call.*, booking.*, crm.sync.*, crm.provision.*, contact.*, automation.*, handoff.*, lead.created, notification.sent) and `NormalizedEvent` shape (`clientId`, optional `callId`/`contactId`/`appointmentId`, `payload`, `source`, `idempotencyKey`).
- `providers/retell/retell.normalizer.ts` — Retell payload → `NormalizedEvent`.

### Actions (tool) layer
There is **no `actionRouter`**. Each Retell tool is a standalone Fastify route (see §2). There is no scope model, no action metadata, no central validation beyond per-route Zod. This is the single biggest structural gap for the inbound build.

### Data access
- `src/db/client.ts` — Supabase JS client (service role). Services and routes call `supabase.from(...)` directly; services (`src/services/*.service.ts`) wrap the common entities: `clientService` (incl. `getSettings`, `findByPhoneNumber`, `findByAgentId`), `contactService` (`findByPhone`, `upsertByPhone`), `callService` (`createCall`, `endCall`, `findByRetellId`, `upsertConversation`, `upsertSummary`), `callRecordService`, `ticketService`, `actionItemService`, `onboardingService`, `userService`, `auditService` (`writeAuditLog`).

### Integrations
- **CRM**: `src/crm/crm.interface.ts` (`ICrmAdapter`: `createOrUpdateContact`, `createLead`, `createNote`, `createTask`, `createAppointment`, `updateConversation`, `pushTranscript`, `pushCallSummary`, `testConnection`) + `crm-registry.ts` built on the generic `PluginRegistry` (`src/plugins/plugin-registry.ts`). Adapters: **gohighlevel (v2 OAuth, real)**, hubspot, salesforce, zoho, webhook. **There is no `noop` adapter** — the generic `webhook` adapter is the forwarder-style fallback; tests mock adapters directly.
  - GHL adapter extras: `listPipelines`, `listCalendars`, calendar-aware `createAppointment` (`calendarId`, `assignedUserId` round-robin support, `ignoreFreeSlotValidation: true`), custom-field mapping.
  - `crm/ghl-provisioning-client.ts` + `ghl-provisioning.service.ts` — low-level GHL primitives (tags, tasks, opportunities, pipelines, custom fields) + resumable blueprint provisioning with per-step persistence and `manual_review` parking.
  - `crm/credentials.ts` + `resolveAdapterConfig` — encrypted credentials, GHL OAuth token refresh at expiry, `needs_reauth` flag.
- **Calendar**: `src/calendar/calendar.interface.ts` (`ICalendarAdapter`: `createEvent`, `updateEvent`, `deleteEvent`, `getAvailableSlots`, `checkConflict`) + registry; adapters: google-calendar, outlook, calendly. Selected via `client_settings.crm_config.calendar_provider`. **GHL calendar is NOT behind this interface** — GHL appointment write-back goes through the CRM adapter's `createAppointment`.
- **Retell**: see §4.

### Booking
`src/booking/booking.service.ts` — first-class service: `createAppointment` (conflict check → insert → best-effort calendar sync → CRM sync enqueue → `booking.requested` event), `confirmAppointment`, `cancelAppointment`, `rescheduleAppointment`, `getAvailability`. **Availability is computed locally** from `client_settings.booking_rules.working_hours` + conflicts against the local `appointments` table (30-min slots) — it does **not** query GHL/Google free-busy.

### Queues / workers / reliability
- `src/queues/queues.ts` — BullMQ queues: `crm-sync`, `booking`, `notifications`, `call-processing`, `transcript-processing`, `analytics`, `maintenance`. Default: 3 attempts, exponential backoff 5 s, `removeOnFail: false`.
- `src/workers/` — one worker per queue; standalone process entry `workers/index.ts` (separate Render service, graceful shutdown). `workers/failure-alerts.ts` wires **central terminal-failure handling** (`onFinalFailure`): `failed_jobs` row + alert email — this is the de facto "retryPolicy"/dead-letter path. GHL provisioning additionally parks exhausted runs as `manual_review`.
- Idempotency: `utils/idempotency.ts` `buildIdempotencyKey(...parts)` used as BullMQ `jobId` and event `idempotency_key` everywhere.
- `utils/`: pino logger with redaction, mailer, rate-limiter, Sentry, crypto (credential encryption), `speech.ts` (`formatPhone`, `spellName` — break-tag TTS readback, wrapped by `verbatim()` in the function routes).

### App assembly
`src/app.ts` — helmet, CORS (env-driven), rate limit (Redis-backed), JWT, raw-body capture for HMAC, Zod-aware error handler, registers all routes. `src/server.ts` boots API. Dashboard API routes live in `src/dashboard-api/` (auth/JWT + RBAC middleware in `src/middleware/auth.middleware.ts`).

---

## 2. Existing actions inventory (Retell tools + backing services)

Registered tool names are centralized in `RETELL_FUNCTION_NAMES` (`providers/retell/templates/template.types.ts`) and must stay in sync with the routes — this constant is the closest existing analog to a "metadataKeys" module.

| Tool (`/functions/retell/...`) | Inputs (Zod) | Effect / outputs |
|---|---|---|
| `lookup_existing_client` | `phone` | `contactService.findByPhone` + last 3 appointments; returns profile + greeting guidance |
| `check_availability` | `date`, `service_type?` | `bookingService.getAvailability` (local rules), first 8 open slots |
| `qualify_lead` | `name`, `phone`, `email?`, `service_interest`, passthrough extras | `contactService.upsertByPhone` with tags `['lead','voice']`, `custom_fields.service_interest`; verbatim phone/name readback |
| `book_appointment` / `book_consultation` | `contact_name`, `phone`, `start_time` (ISO), `service_type?`/`service_interest?`, `notes?` | Gated on `settings.booking_enabled`; duration from `settings.services`; upsert contact; `bookingService.createAppointment` (→ calendar sync, CRM sync, `booking.requested` event → post-call automation) |
| `schedule_callback` | `caller_name`, `phone`, `preferred_time?`, `topic?` | Contact upsert (tags `['callback','voice']`), `staff_notifications` insert (type `lead`, metadata.kind `callback`), notification email (idempotent jobId) |
| `leave_staff_message` | `caller_name`, `phone`, `message`, `urgency?` | `staff_notifications` (type `escalation`), notification email |
| `request_human_handoff` | `reason`, `phone?` | `conversations.handoff_requested = true`, `staff_notifications` (type `handoff`), notification email. **No live SIP/warm transfer** — notify-and-callback only |

Retell built-in `end_call` tool is always appended by `retell.agent.ts`.

### Required inbound action surface — exists / partial / missing

| Required action | Status | Where / gap |
|---|---|---|
| `route.intent` | **Missing** | Core Phase 1 build. No intent routing exists; each agent's single prompt handles everything. |
| `booking.create` | Exists | `book_appointment` tool + `bookingService.createAppointment` |
| `booking.update` | Partial | `bookingService.rescheduleAppointment` + `/booking` REST routes exist; **no Retell tool**, no caller-side locate-appointment flow |
| `booking.cancel` | Partial | `bookingService.cancelAppointment`; **no Retell tool**, no cancellation-policy enforcement |
| `calendar.getAvailability` | Partial | `check_availability` tool → local rules engine. **Not GHL calendar truth**; CRM adapter has no availability method |
| `contact.lookup` | Exists | `lookup_existing_client` tool |
| `contact.create` / `contact.update` | Exists | `contactService.upsertByPhone` (used by every capture tool) |
| `crm.createLead` | Partial | `ICrmAdapter.createLead` + crm-sync worker `lead` branch exist; `qualify_lead` captures locally but does **not** enqueue a CRM lead |
| `crm.updateLead` | Missing | Only `updateConversation` (contact field update) exists |
| `pipeline.moveStage` | Exists (GHL) | `GhlProvisioningClient.moveOpportunityStage` via `runBookingAutomation`; not exposed as a standalone action |
| `staff.transfer` | Missing | `request_human_handoff` is notify-only; no transfer_call / departmental routing |
| `staff.notify` | Exists | `staff_notifications` table + notifications queue/worker (email) |
| `callback.create` | Partial | `schedule_callback` writes `staff_notifications`; **no `callback_requests` table / status lifecycle** |
| `ticket.create` | Partial | `ticketService` + `tickets` table exist but are **dashboard-scoped** (`created_by`/`assigned_to` reference `users`, no `contact_id`/`call_id`) — built for client↔Gravvia support, not caller complaints |
| `knowledge.search` | Missing | FAQs/services/pricing are **baked into the prompt** at provisioning; no runtime search, no dedicated tables |
| `forms.send` | Missing | — |
| `sms.send` | Missing (by design) | Voice-only launch; keep the action slot so SMS plugs in later |
| `email.send` | Exists | `notificationsQueue` → notifications worker → `utils/mailer.ts` |
| `payment.lookup` | Missing | No payments integration; `invoices` table does **not** exist |
| `membership.lookup` | Missing | Membership exists only as prompt copy (`agent_config.membership_program`) |
| `waitlist.add` | Missing | No table, no action |
| `conversation.save` | Exists | `callService.upsertConversation` (webhook-driven, not a tool) |
| `conversation.tag` | Partial | Contact tags exist; no conversation-level tagging action |
| `conversation.summary` | Exists | Retell `call_analysis` → `call_summaries` via dispatcher |
| `analytics.track` | Partial | `analytics` queue + worker exist; nothing emits per-workflow analytics |
| `automation.trigger` | Partial | Event bus + post-call subscribers; no generic trigger action |
| `emergency.flag` | Missing | — |

---

## 3. Schema inventory

Conventions confirmed: `id UUID PK DEFAULT uuid_generate_v4()`, `client_id`/`contact_id`/`call_id` FKs with `ON DELETE CASCADE`/`SET NULL`, `created_at`/`updated_at TIMESTAMPTZ`, `updated_at` triggers, RLS enabled with service-role access, additive migrations `NNN_name.sql`.

**Live tables** (setup.sql + migrations 001–010): `clients` (+ `retell_agent_id`, `retell_llm_id`, `retell_voice_id`, `retell_agent_version`, `retell_last_provisioned_at`, `retell_webhook_secret`, `phone_numbers TEXT[]`), `client_settings` (prompt/personality/tone, `faqs` JSONB, `services` JSONB, `pricing` JSONB, `business_policies`, `booking_enabled`, `booking_rules` JSONB, `notification_emails`, `escalation_rules`, `crm_type`, `crm_config` JSONB, `custom_field_mapping`, `business_name`, `agent_name`, `agent_config` JSONB, `ghl_blueprint` JSONB), `users`, `roles`, `permissions`, `api_keys`, `contacts`, `calls`, `conversations`, `call_transcripts`, `call_summaries`, `appointments`, `crm_connections` (+ `needs_reauth`), `crm_sync_logs` (+ `payload`), `events`, `automation_rules`, `automation_runs`, `failed_jobs`, `staff_notifications`, `audit_logs`, `retell_phone_numbers`, `tickets`, `ticket_status_history`, `ticket_messages`, `onboarding_milestones`, `client_action_items`, `call_records`.

**Prompt-assumed tables that do NOT exist**: `messages`, `invoices`, `sequence_runs`, `retell_resources` (see §6).

### Session-state decision
- `calls` has **no JSONB column** (locked — additive-only rule forbids repurposing).
- `conversations.metadata` JSONB exists, but the `conversations` row is written at call-end/analysis time and carries analysis payload; using it for live per-turn session state would repurpose its meaning and race with `upsertConversation`.
- **Decision: a new `call_sessions` table is required** — `id uuid PK`, `call_id` FK (unique), `client_id` FK, `state JSONB` (active workflow, state, stack, slots, verification status, global conversation context), timestamps. Keyed lookups by `retell_call_id` happen via `calls`; `call_sessions` should also store `retell_call_id` directly so tool calls (which only carry `call.call_id`) can hit it in one query without joining, and so a session can be opened even if the `call_started` webhook was missed (same resilience pattern as `callRecordService.recordFromAnalyzed`).

---

## 4. Retell integration inventory

- **SDK**: `providers/retell/retell.client.ts` (`retell-sdk`).
- **Agent definition**: template registry `providers/retell/templates/` — `AgentTemplate.build(ctx) → { responseEngine, agent }`. One template per vertical (`med-spa` today), resolved from `client.industry` (`resolveVertical`). Templates render **everything from `client_settings`** (services, pricing, FAQs, hours, policies, upsell playbook, identity) into `general_prompt` — nothing client-specific in code.
- **Deployment/reconciliation**: `services/provisioning.service.ts` `provisionClient(clientId)` — idempotent create-or-update of Retell LLM (`createOrUpdateResponseEngine`; on update **omits `model`** to avoid the `s2s_model` conflict) and Agent (`createOrUpdateAgent`; webhook_url → `/webhooks/retell`, events `call_started|call_ended|call_analyzed`, pacing/pronunciation settings), persists IDs onto `clients`, maps/purchases phone numbers (`retell_phone_numbers` upsert on `phone_number`), audit-logs. Exposed via `routes/provisioning.route.ts`.
- **Canonical deployed-ID store**: **`clients` columns + `retell_phone_numbers`** — there is **no `retell_resources` table** (see §6).
- **Dynamic variables: NOT USED.** The med-spa template explicitly renders identity/context into the prompt at provisioning time — comment: *"no Retell `{{dynamic_variables}}`, so a raw `{{variable}}` can never be spoken."* Consequently the assumed "boolean dynamic-variable coercion fix" **does not exist in this codebase**.
- **Tools → backend**: templates emit `RetellToolSpec[]` with URLs `${functionBaseUrl}/<name>`; `retell.agent.ts` maps them to Retell custom tools + appends built-in `end_call`. Tool names locked by `RETELL_FUNCTION_NAMES`.
- **Webhook metadata**: no `metadataKeys` constants module exists; the dispatcher reads Retell envelope fields directly.
- **Known Retell fixes actually present**: raw-body HMAC verification; `s2s_model` update guard; `verbatim()` break-tag readback (`utils/speech.ts`); `ignoreFreeSlotValidation` on GHL write-back; GHL round-robin `assignedUserId`.

---

## 5. Gap list → build phases

**Reused as-is** (extend, don't replace): tenant resolution, signature middleware + raw-body capture, event bus + `events` audit trail, `buildIdempotencyKey`, BullMQ queues/workers + central `onFinalFailure`, booking service + `booking.requested` automation chain, CRM plugin registry + GHL adapter/provisioning client, template/provisioning pipeline, `staff_notifications`, mailer, speech utils, dashboard RBAC.

**To build:**

| # | Item | Phase |
|---|---|---|
| 1 | `src/workflows/engine/` — generic state machine (states, transitions, guards, slot validation, stack, event emission) | 1 |
| 2 | `call_sessions` migration (011) + session service | 1 |
| 3 | `route.intent` tool + capability→workflow mapping | 1 |
| 4 | Action registry with metadata (scope, `requiresVerifiedIdentity`, `idempotent`, `retrySafe`) + central scope enforcement wrapping the existing function-route pattern | 1 |
| 5 | Shared inbound agent template (greeting + intent classification + emergency hard rule) + `emergency.flag` + `end_call` workflow | 1 |
| 6 | Workflow transition events (extend `EventType` additively: `workflow.*`) | 1 |
| 7 | Migrations: `services`, `pricing`, `faqs`, `promotions` tables + `knowledge.search` + knowledge workflows (currently JSONB blobs in `client_settings` — see §6 conflict) | 2 |
| 8 | CRM adapter calendar methods `getAvailability`/`createBooking`/`updateBooking`/`cancelBooking` (canonical types; GHL implements; **noop adapter to be created**) | 3 |
| 9 | Booking workflows (book/reschedule/cancel/waitlist/inquiry), cancellation policy, `waitlist_entries` migration | 3 |
| 10 | Lead workflows (`lead_qualification` → actually enqueue `crm.createLead`, `new_client_intake`, `intake_forms`, `forms.send`), follow-up generation via existing delayed-job pattern (no sequenceEngine exists — see §6) | 4 |
| 11 | `identity_verification` guard + account workflows (`membership.lookup`, `payment.lookup` — see §6 re: no payments backend), `documentation_requests` | 5 |
| 12 | `callback_requests` migration + status lifecycle; caller-complaint path on `tickets` (additive `contact_id`/`call_id`/`source` columns) ; `staff_transfer` (Retell `transfer_call` tool) ; `multi_location_routing`, `language_selection` | 5 |

---

## 6. Conflicts: prompt assumptions vs. codebase reality (codebase wins)

1. **"actionRouter" does not exist.** Tools are individual Fastify routes with per-route Zod. **Adjustment**: build the action registry + scope enforcement as a layer the existing function routes register into (one dispatcher route `/functions/retell/:name` or a shared `preHandler` chain), preserving the current URL scheme so already-provisioned agents keep working. Do not invent a parallel routing idiom.
2. **No callLifecycle/smsLifecycle/automationEngine/outcomeEngine/sequenceEngine/missedCallRecovery modules.** Their responsibilities live in the dispatcher route, `post-call.automation.ts`, and delayed BullMQ jobs. **Adjustment**: follow-ups and "sequences" are implemented as delayed idempotent jobs (existing pattern); missed-call behavior extends `post-call.automation.ts`.
3. **JavaScript assumption is wrong.** Codebase is TypeScript ESM with `.js` import specifiers. Workflow definitions will be `src/workflows/definitions/<name>.ts`.
4. **"Single shared inbound agent" conflicts with the per-client-agent architecture.** Existing model: one agent **per client**, prompt fully rendered from `client_settings` at provisioning time, no dynamic variables; tenant resolved per call. **Adjustment**: keep per-client agents and provisioning-time context injection (equivalent multi-tenancy, already live-tested). The shared *template* is the shared artifact. Per-call dynamic variables (language/voice switching) can be added later via Retell inbound webhook dynamic variables without breaking this model.
5. **`retell_resources` table does not exist.** Canonical deployed IDs = `clients.retell_*` columns + `retell_phone_numbers`. **Adjustment**: keep this as the source of truth; do not add a `retell_resources` table.
6. **`metadataKeys` module and the boolean dynamic-variable coercion fix do not exist** (no dynamic variables are used). **Adjustment**: `RETELL_FUNCTION_NAMES` remains the tool-name constant; add workflow/tool constants there. Boolean coercion becomes relevant only if dynamic variables are introduced.
7. **No noop CRM adapter.** The generic `webhook` adapter is the forwarder fallback. **Adjustment**: create a true `noop` adapter when the calendar methods are added to `ICrmAdapter` (Phase 3), stubbing every method — this also simplifies tests.
8. **Knowledge data lives in `client_settings` JSONB** (`faqs`, `services`, `pricing` arrays), not relational tables, and is baked into prompts. **Adjustment (additive)**: create the new relational tables in Phase 2 for `knowledge.search` and dashboard CRUD; keep the JSONB columns untouched (locked) and have provisioning/knowledge-search read relational-first with JSONB fallback so existing clients keep working without a data migration.
9. **`tickets` is dashboard-scoped** (user-to-user). **Adjustment**: additive columns (`contact_id`, `call_id`, `source`) rather than a parallel complaints table.
10. **Availability truth is local rules, not GHL calendar.** The prompt requires GHL calendar as booking truth. **Adjustment (Phase 3)**: add `getAvailability`/booking methods to the CRM adapter; make `bookingService` consult the adapter when the client has an active GHL connection with a configured `calendarId`, falling back to the existing local rules engine otherwise. Local `appointments` remains the mirror/audit copy (already the pattern).
11. **No payments/membership backend exists** (`invoices` table absent, no billing integration). **Adjustment**: Phase 5 `payment.lookup`/`membership.lookup` are scoped to what GHL + `client_settings` can answer (policy text, membership program description, request-and-callback for balances) unless a payments integration is added; account workflows must degrade gracefully.
12. **`messages` / `sequence_runs` tables absent** — SMS is deliberately out of scope for launch; nothing depends on them. No adjustment needed beyond keeping action slots (`sms.send`) unimplemented-but-reserved.

---

## 7. Verification

- Full test suite run on this baseline: `npx vitest run` → **27 files / 165 tests passed** (5.7 s).
- Every file cited above was read directly from the working tree on `main` (HEAD `e3d89a8`).
