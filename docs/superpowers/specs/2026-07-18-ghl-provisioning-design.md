# GoHighLevel Provisioning & Automation — Design Spec

Date: 2026-07-18
Status: Approved approach (A), pending spec review
Scope: Gravvia Engage backend + GHL marketplace app

## Overview

Add a GoHighLevel provisioning layer to the Gravvia Engage backend so that a
connected GHL sub-account (Location) can be set up automatically: pipeline +
stages, custom fields, tags, demo leads (contacts), and opportunities — all
driven by declarative blueprints, applied idempotently, for both Gravvia's own
sub-account and future client sub-accounts.

The GHL dashboard itself has no public API; it is configured once manually in
the GHL UI (guide provided) and later replicated to client sub-accounts via
GHL Snapshots (separate follow-up project, out of scope here).

## Goals

- Merge the existing `feat/ghl-crm-oauth` branch (v2 OAuth service, v2
  adapter, encrypted credential storage) into `main`.
- Add a provisioning service that applies a blueprint to any connected
  location, idempotently and resumably.
- Ship two default blueprints: `gravvia-sales` and `client-inbound`.
- Provide a live smoke test that adds a test client, verifies the OAuth
  connection, provisions the blueprint, and creates one contact + opportunity.

## Non-goals

- SMS, GHL dashboard creation via API, Snapshots automation (later),
  agency-level installs, other CRMs.

## Architecture

Retell Talks → Backend Decides → Database Remembers → CRM Displays.

- All GHL API calls go through the v2 adapter / provisioning service using
  OAuth credentials from `crm_connections` (encrypted, auto-refreshed via
  `ensureFreshGhlCredentials`, single-use refresh-token rotation handled).
- No client-specific logic in code: blueprints are JSON stored per client in
  `client_settings` (key `ghl_blueprint`), with shipped defaults in
  `backend/src/crm/blueprints/`.
- Provisioning runs as a BullMQ job on the existing `crm-sync` queue: retries
  with backoff, dead-letter queue, `MANUAL_REVIEW` status on exhaustion.
  Each run is recorded in `crm_sync_logs` and emits `events`
  (`crm.provision.started` / `completed` / `failed`).

## Connection (OAuth)

- Marketplace app (existing `GHL_CLIENT_ID` / `GHL_CLIENT_SECRET`).
- Redirect URI: `{API_BASE_URL}/crm/level/oauth/callback` — path avoids
  "ghl"/"highlevel" strings which the marketplace rejects.
  Production: `https://gravvia-backend.onrender.com/crm/level/oauth/callback`
  (confirm host in Render; use custom domain if attached).
- Install must target a sub-account (Location); agency installs are rejected
  at token exchange (no `locationId`).
- Scopes (marketplace app must match `GHL_SCOPES` in code):
  - contacts.readonly, contacts.write
  - opportunities.readonly, opportunities.write
  - calendars.readonly, calendars/events.readonly, calendars/events.write
  - locations.readonly
  - locations/customFields.readonly, locations/customFields.write
  - locations/tags.readonly, locations/tags.write
  - pipelines.readonly, pipelines.write, pipelines.create
- Scope strings verified 2026-07-18 against the marketplace app "GI
  Integration 3" (app id 6a5be942bcb170b51b3b9285) via the developer portal;
  all scopes above are ticked and saved on that app. `GHL_SCOPES` in code
  must be updated to match this exact list (pipelines.* are separate from
  opportunities.*).
- The active marketplace app is "GI Integration 3" — its client id/secret
  must replace the old app's GHL_CLIENT_ID / GHL_CLIENT_SECRET in
  backend/.env and the Render environment.
- Scope changes require re-running the install on already-connected locations.

## Components

### 1. Merge `feat/ghl-crm-oauth`

Brings in: `gohighlevel-oauth.service.ts`, v2 `gohighlevel.adapter.ts`
(services.leadconnectorhq.com), `credentials.ts`, OAuth routes
(install-URL + callback), tests. Resolve drift against current `main`
(branch predates recent commits).

### 2. Provisioning service — `backend/src/crm/ghl-provisioning.service.ts`

`applyBlueprint(clientId: string, blueprint: GhlBlueprint): Promise<ProvisionRun>`

Steps, in order, each independently recorded:

1. Pipeline: list pipelines; if name match (case-insensitive) exists, update
   missing stages via Update Pipeline (full-replacement `stages` array,
   retaining existing stage ids); else Create Pipeline
   (`POST /opportunities/pipelines`).
2. Custom fields: list location custom fields; create missing by name
   (Custom Fields V2 API).
3. Tags: list location tags; create missing.
4. Demo leads: upsert contacts by email/phone (contacts upsert endpoint);
   tag them per blueprint.
5. Opportunities: for each demo lead with an opportunity entry, create
   opportunity in the blueprint pipeline/stage if none exists for that
   contact in that pipeline.

Idempotency: name/email matching before every create; re-running a blueprint
is always safe. Partial failure: the run record stores per-step status; a
retry resumes from the first incomplete step.

Rate limiting: GHL burst limit ~100 requests / 10 s per location — throttle
to ≤5 req/s with a simple limiter in the service.

### 3. Blueprint schema — `backend/src/types/ghl-blueprint.types.ts` (Zod)

```
GhlBlueprint {
  name: string
  pipeline: { name: string; stages: string[] }
  customFields: { name: string; dataType: 'TEXT'|'LARGE_TEXT'|'NUMERICAL'|'DATE'|'SINGLE_OPTIONS'; options?: string[] }[]
  tags: string[]
  demoLeads?: {
    firstName; lastName; email; phone; tags?: string[];
    customFields?: Record<string, string>;
    opportunity?: { name: string; stage: string; monetaryValue?: number }
  }[]
}
```

### 4. Default blueprints — `backend/src/crm/blueprints/`

`gravvia-sales.blueprint.ts` (Gravvia's own sub-account):
- Pipeline "Gravvia Sales": New Lead → Contacted → Demo Booked →
  Demo Completed → Proposal Sent → Negotiation → Closed Won → Closed Lost
- Fields: Company Industry (SINGLE_OPTIONS), Current Call Volume (NUMERICAL),
  Interest Level (SINGLE_OPTIONS: Hot/Warm/Cold), Demo Date (DATE),
  Retell Call ID (TEXT), Call Summary (LARGE_TEXT)
- Tags: inbound-lead, demo-requested, hot-lead, needs-follow-up,
  closed-won, nurture
- Demo leads: ~20 fictional leads (clearly fake domains, 555 numbers) with
  opportunities spread across all stages and varied monetary values so
  dashboard widgets populate.

`client-inbound.blueprint.ts` (default for client sub-accounts):
- Pipeline "Inbound AI Calls": New Inquiry → AI Qualified →
  Booking Requested → Appointment Scheduled → Completed → Won → Lost
- Fields: Service Interest (TEXT), Preferred Time (TEXT),
  AI Qualification Notes (LARGE_TEXT), Last Call Date (DATE),
  Retell Call ID (TEXT)
- Tags: ai-answered, booked, human-handoff, no-answer, follow-up
- No demo leads by default (opt-in flag per client).

### 5. Routes (admin-auth, RBAC, Zod-validated)

- `POST /crm/ghl/provision` — body `{ clientId, blueprint?: name | inline }`;
  enqueues job, returns `{ runId }`.
- `GET /crm/ghl/provision/:runId` — run status incl. per-step results.
- (From merged branch) `GET /crm/ghl/install-url?clientId=` and
  `GET /crm/level/oauth/callback`.

### 6. Data model

Provision runs stored in `crm_sync_logs` (`operation = 'provision'`,
per-step detail in payload JSON). No new tables. Blueprint selection/overrides
in `client_settings`.

## Error handling

- Every GHL call wrapped with typed failure capture (adapter pattern).
- Job retries: 3 attempts, exponential backoff; then DLQ + `MANUAL_REVIEW`.
- 401 → mark connection `needs_reauth`, surface in dashboard, do not retry.
- 429 → respect `Retry-After`, back off, resume.
- No silent failures: every step result lands in `crm_sync_logs` + `events`.

## Dashboard (manual, documented)

`docs/ghl-dashboard-setup.md` (deliverable): click-by-click GHL custom
dashboard with widgets: opportunities by stage (bar), pipeline value (numeric),
leads this week (time series), conversion rate (donut: won vs lost),
appointments booked (numeric). Later: snapshot the configured sub-account for
client rollout (separate spec).

## Testing

- Vitest, GHL API mocked (msw/nock):
  - blueprint apply happy path; idempotent re-apply (0 creates on 2nd run)
  - partial-failure resume; rate-limit backoff; 401 → needs_reauth
  - Zod blueprint validation; route auth/permission checks
- Live smoke test `scripts/ghl-smoke-test.ts` (run by user or on deploy box):
  1. create (or reuse) test client row
  2. print install URL if no connection; else validate token refresh
  3. apply `gravvia-sales` blueprint
  4. create 1 test contact + opportunity; print GHL links to verify
  5. `--cleanup` flag removes test contact/opportunity

## Live verification plan (the "add a client" test)

1. User sets redirect URI + scopes on the marketplace app.
2. Deploy merged code (or run backend locally with ngrok-style URL).
3. User opens install URL, installs on Gravvia sub-account.
4. Run smoke test; verify pipeline/fields/tags/leads appear in GHL.

## Open items

- Exact pipeline-write scope string (see Connection section).
- Render production hostname confirmation.
- Whether `feat/ghl-crm-oauth` needs rebase fixes against current `main`
  (branch predates several commits) — resolved during implementation.
