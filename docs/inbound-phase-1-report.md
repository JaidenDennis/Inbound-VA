# Inbound Build — Phase 1 Verification Report (Core Engine)

Date: 2026-07-21 · Baseline: `docs/audit-inbound-baseline.md` · Tests: **29 files / 180 passing** (`npx vitest run`, up from 27/165 baseline; `npx tsc --noEmit` clean).

## What was built

**Schema (additive)**
- `supabase/migrations/011_call_sessions.sql` — `call_sessions` (id/client_id/call_id/`retell_call_id UNIQUE`/`state JSONB`), updated_at trigger, RLS defense-in-depth policy. Keyed by `retell_call_id` so sessions survive a missed `call_started` webhook. No existing table or column touched.

**Types (additive)**
- `src/types/workflow.types.ts` — `WorkflowDefinition` (declarative: intents, capability, scopes, slots+validators, states, transitions, guards, outcomes, guidance), `CallSessionState` (active frame, stack, granted scopes, identity flag, global conversation context, event seq), `WorkflowContract`, `ActionMetadata`.
- `EventType` extended: `workflow.started|transitioned|paused|resumed|completed|cancelled|failed|switched`, `emergency.flagged`.
- `AgentConfig.workflow_routing?: boolean` — per-client opt-in, DB-configurable (no client logic in code).

**Engine (`src/workflows/`)** — generic, zero workflow-specific logic:
- `engine/workflow-registry.ts` — validates definitions at registration (unknown states/transitions/guard targets, duplicate intent claims), intent→workflow index.
- `engine/workflow-engine.ts` — `routeIntent` (intent→capability→workflow, topic-switch pause/stack/resume), `collectSlots` (workflow-owned validators; invalid values never stored), `transition` (declared transitions only + guard gating), `completeActive`/`cancelActive`/`failActive` (stack pop + resume with the resumed workflow's scopes), `flagEmergency`. Every mutation publishes an audited event through the existing eventBus (persisted `events` rows, idempotent keys via `buildIdempotencyKey`).
- `engine/session-store.ts` — load/create/save against `call_sessions`.
- `engine/action-metadata.ts` — every tool declares `scope`, `requiresVerifiedIdentity`, `idempotent`, `retrySafe`; undeclared tool ⇒ boot-time error.
- `engine/scope-guard.ts` — `enforceScope(tool)` preHandler: for routing-enabled sessions, denies any tool outside the active workflow's granted scopes (and unverified identity-required actions), audits the denial, and answers with conversational recovery guidance. Legacy calls (no session / routing off) pass through untouched — already-provisioned agents are unaffected.
- `definitions/end-call.workflow.ts`, `definitions/emergency.workflow.ts` — first declarative definitions.

**Tool endpoints** (`src/routes/functions/workflow-functions.route.ts`, same conventions as the existing function routes — signature preHandler, Zod args, conversational responses):
- `route_intent` — returns the workflow contract (workflow, state, missing slots, granted scopes, guidance); self-heals a missing session; degrades gracefully if the store is down (never strands a caller).
- `update_workflow` — slot reporting, backend-validated transitions, completion/cancel with automatic resume of stacked topics.
- `emergency_flag` — hard safety path: staff notification + urgent email fire **before and independently of** session flagging; returns the predefined emergency-services response.
- Existing 8 function routes now run `enforceScope(<tool>)` after signature validation.

**Conversation layer**
- `templates/inbound-routing.template.ts` — vertical-neutral routing agent (greeting, intent classification protocol, emergency hard rule with predefined response, knowledge rendered from `client_settings` at provisioning time), registered as vertical `inbound_routing`; provisionable today via the existing `provisionClient(clientId, { template: 'inbound_routing' })`.
- `RETELL_FUNCTION_NAMES` extended with the three new tools (single source of truth for tool-name sync).
- Dispatcher `call_started` now opens the workflow session for routing-enabled clients so enforcement is active from the first tool call.

## What was verified, and how

- **Unit — engine** (`__tests__/workflow-engine.test.ts`, 11 tests): registry validation failures; start/grant; idempotent re-route; fallback for unknown intents; slot validation (client-settings-aware validator, future-date rule, invalid values never overwrite valid ones); undeclared-transition rejection; guard blocking `complete` until `identityVerified`; pause→stack→resume with scope swap; outcome normalization; cancel; emergency flag. Exact event trails asserted.
- **Integration — simulated call** (`__tests__/workflow-routing.test.ts`, 4 tests) through the real Fastify routes with signed Retell payloads (Phase 1 exit test): route an intent → scope-denied support tool (handler provably never ran, denial audited) → booking-scoped tool executes → invalid slot rejected / valid slot recorded → topic switch to `end_call` (stack push) → completion resumes the stacked workflow with slots intact → full ordered event trail (`started, paused, switched, started, completed, resumed`). Plus: legacy calls bypass the guard; `emergency_flag` inserts the staff notification, queues the URGENT email, flags the session, emits `emergency.flagged`, and returns the 9-1-1 response; identity-required action denied until verified, allowed after.
- **Regression**: all 165 baseline tests still pass; the only baseline-test change was extending a Supabase mock chain (`.maybeSingle`) for the new sessions lookup.

## Notes / carried-forward decisions

- Per the audit (conflict #4), the "shared inbound agent" is realized as a shared **template** with per-client provisioned agents — the existing, live-tested multi-tenancy model.
- Unrouted intents grant `FALLBACK_SCOPES` (`booking, knowledge, crm, support`) so the routing agent stays functional while workflow definitions land in Phases 2–5; tighten as coverage grows.
- `update_workflow` is the generic slot/transition reporting tool; dedicated actions (e.g. booking) will also record slots server-side as they become workflow-owned.
