# Dashboard Rework — Design Spec

**Date:** 2026-08-05
**Status:** Draft, pending review
**Scope:** Gravvia Engage admin dashboard + supporting backend

---

## 1. Goal

Turn the current dashboard into a system that serves two distinct audiences from one codebase:

- **Platform staff (Gravvia):** operate and troubleshoot every client — support queue, system errors, agent configuration, recordings.
- **Client users:** a reporting and self-service surface showing their own performance, their own knowledge base, and their own support tickets — and nothing else.

Five subsystems are in scope: RBAC, observability, agent management, support, and client reporting. They ship as one spec, built in five phases.

---

## 2. Current state

**Dashboard** — Next.js 16, Tailwind, 31 source files. Staff nav: Overview, Clients, Calls, Bookings, Analytics, CRM, Users, Support, Settings. Client nav: Overview, Onboarding, Performance, Support. All pages are `'use client'` fetching via `useEffect` + `axios`.

**RBAC** — Four roles (`super_admin`, `admin`, `agent`, `viewer`) defined in two places: the DB `permissions` table (migration `003`) and a hardcoded `ROLE_PERMISSIONS` map in `backend/src/types/auth.types.ts:19`. Only the hardcoded map is read at runtime; the DB table is dead. They have already diverged — `tickets:read` / `tickets:write` exist in code but were never seeded in `003`. Tenant isolation works via `assertClientAccess`, keyed on `clientId === null` meaning platform staff.

**Already in the database, with no UI:** `audit_logs`, `failed_jobs`, `events`, `crm_sync_logs`, `automation_runs`.

**Missing entirely:** any agent-management surface (prompt, knowledge, voice, phone).

---

## 3. Decisions

| Decision | Choice |
|---|---|
| Build order | Permission-first vertical slices (Approach A) |
| Role model | Two role families — platform and client — with separate permission grants |
| Agent editing split | Client edits knowledge (facts); staff edits behavior (prompt, routing, voice) |
| Error capture | New capture layer + unified console over existing log tables |
| Client reporting | Volume trend, outcome breakdown, call log with transcripts. No CSV/email export. |
| Support gaps | Internal notes, SLA timers, auto-tickets from errors. Email ingest deferred. |
| Transcript access | `client_owner` and `client_manager` only — not `client_viewer` |
| Recording access | Platform staff only, for troubleshooting. Never exposed to clients. |
| Visual scope | Keep current styling; rework information architecture and navigation |

### Rejected alternatives

- **Backend-complete-then-UI:** stable API contracts, but nothing demoable until the end and API shapes designed without the screen tend to be subtly wrong.
- **Feature-parallel:** all five subsystems write the same sidebar, session type, permission checks, and `api.ts`. Merge conflicts on every branch.
- **Email ingest (SendGrid Inbound Parse / Postmark):** deferred. Largest single chunk of work and the only piece requiring DNS changes. The `ticket_messages` model accommodates it later without refactor.

---

## 4. Phase 0 — RBAC foundation

### 4.1 Migration `016_rbac_role_families.sql`

Add `roles.scope TEXT NOT NULL CHECK (scope IN ('platform','client'))`.

| Scope | Role | Grants |
|---|---|---|
| platform | `super_admin` | All permissions |
| platform | `support_agent` | Tickets + triage, calls, transcripts, recordings, system logs, agent config |
| platform | `analyst` | Read-only across all tenants; no recordings, no writes |
| client | `client_owner` | Own users, knowledge editing, all own reports, transcripts, tickets |
| client | `client_manager` | Reports, transcripts, tickets, bookings |
| client | `client_viewer` | Reports only — no transcripts, no recordings |

**Backfill mapping:**

| Existing role | `client_id IS NULL` → | `client_id` set → |
|---|---|---|
| `super_admin` | `super_admin` | `client_owner` |
| `admin` | `support_agent` | `client_owner` |
| `agent` | `support_agent` | `client_manager` |
| `viewer` | `analyst` | `client_viewer` |

**New permissions** beyond the existing 15: `transcripts:read`, `recordings:read`, `knowledge:read`, `knowledge:write`, `agents:read`, `agents:write`, `system:read`, `system:write`, `tickets:triage`.

`transcripts:read` is granted to `client_owner`, `client_manager`, `super_admin`, `support_agent`. `recordings:read` is granted to `super_admin` and `support_agent` only.

### 4.2 Runtime

Delete `ROLE_PERMISSIONS` from `backend/src/types/auth.types.ts`. `requirePermission` resolves role → permissions from the DB through a process-level cache with a 60-second TTL, invalidated on any write to `permissions`.

The JWT carries only `sub`, `email`, `role`, `clientId`. Permissions stay out of the token so a revoked grant takes effect within 60 seconds rather than at token expiry.

`assertClientAccess` is unchanged and remains the tenant boundary.

### 4.3 Frontend

`GET /auth/me` returns the caller's permission array. `dashboard/src/lib/session.ts` holds it; nav and page guards filter on it. Frontend gating is cosmetic — the backend remains the security boundary, as the existing comment at `session.ts:1-4` already states.

### 4.4 Tests

- Role × route matrix: every `dashboard-api` route asserted allow/deny for all six roles.
- Cross-tenant denial: a client user passing another `clientId` receives 403.
- Drift guard: no permission string referenced in code is absent from the DB seed. This is the test that would have caught the `tickets:*` divergence.

---

## 5. Phase 1 — Observability

### 5.1 Migration `017_system_errors.sql`

```
system_errors
  id, occurred_at, source, severity, client_id,
  request_id, route, method, status_code,
  error_name, message, stack, context jsonb,
  fingerprint, reviewed_at, reviewed_by, ticket_id
```

`source ∈ ('api','worker','webhook','startup')`. `client_id` nullable — null means platform-wide.

Indexes: `(occurred_at DESC)`, `(client_id, occurred_at DESC)`, `(fingerprint)`, and a partial index on `reviewed_at IS NULL`.

`fingerprint` is a hash of source + error name + route + message with numbers and UUIDs normalized out. One outage groups into a single console row with an occurrence count instead of thousands of rows.

### 5.2 Capture points

Four writers, no others:

1. Fastify `setErrorHandler` — 5xx only. 4xx responses are caller errors and would bury real failures.
2. BullMQ worker `failed` event, only once attempts are exhausted. Links to the existing `failed_jobs` row rather than duplicating it.
3. Webhook rejections in `retell-signature.middleware.ts` — signature mismatch, unparseable body.
4. `unhandledRejection` / `uncaughtException`, written before graceful shutdown.

### 5.3 Redaction (security-critical)

A redactor runs over `message`, `stack`, and `context` before insert. It strips values for keys matching `authorization`, `api_key`, `apikey`, `token`, `password`, `secret`, and any value matching a bearer-token or JWT shape.

Error contexts routinely carry live CRM credentials. A miss here exposes them to every holder of `system:read`. This gets dedicated unit tests using credential-bearing fixtures.

### 5.4 Read model

Postgres view `system_activity` normalizes five sources into one shape — `occurred_at, source, severity, client_id, title, detail, ref_id` — unioning `system_errors`, failed `failed_jobs`, failed `crm_sync_logs`, failed `automation_runs`, and error-type `events`. The four pre-existing tables gain no new writes.

### 5.5 Routes

```
GET  /system/activity        ?source&severity&clientId&from&to&reviewed&q&page   system:read
GET  /system/activity/:source/:id                                                system:read
POST /system/activity/:source/:id/review                                         system:write
POST /system/retry/:jobId                                                        system:write
```

`retry` re-enqueues the BullMQ job with its original payload and writes an audit log recording the actor.

### 5.6 Auto-ticket bridge

When a fingerprint crosses **5 occurrences in 15 minutes**, or a `failed_job` exhausts retries for a client, open one ticket at `priority=high`, unassigned, `source='system'`.

Dedupe: before creating, look up an open ticket where `tickets.error_fingerprint` matches. If one exists, attach to it by stamping `system_errors.ticket_id` and incrementing the occurrence count instead of opening a second ticket.

Thresholds are platform-wide constants in source, not per-client configuration — consistent with the CLAUDE.md rule that no client-specific logic lives in code.

### 5.7 Retention

A nightly job purges `system_errors` rows older than 90 days regardless of review state.

### 5.8 UI

`/dashboard/system`, gated on `system:read`. Filter bar, grouped-by-fingerprint toggle, detail drawer showing the stack, and row actions: retry, mark reviewed, open client.

---

## 6. Phase 2 — Agent manager

### 6.1 The sync problem

`provisioningService.provisionClient` (`backend/src/services/provisioning.service.ts:46`) renders knowledge into the agent prompt and pushes it to Retell. It currently runs only on demand. A client editing an FAQ therefore changes the database while the live agent keeps answering with the old content.

**Fix:** any write to knowledge or agent config sets `clients.agent_sync_state = 'pending'` and enqueues a re-provision on a new `agent-provisioning` queue, **debounced 60 seconds keyed by `client_id`**. Twelve FAQ edits produce one sync. Failure sets `'failed'`, writes to `system_errors`, and triggers the Phase 1 auto-ticket rule. Both editing surfaces show a badge: `Live` / `Syncing` / `Sync failed — retry`.

### 6.2 Staff-editable (`agents:write`)

Identity (`business_name`, `agent_name`), vertical/template selection, `agent_personality`, `agent_tone`, `agent_response_style`, `voice_id`, model, `agent_config` JSONB, phone number mapping, `booking_enabled`, `booking_rules`, `escalation_rules`.

Prompts remain template-driven; per-vertical templates stay authoritative. Free-text customization goes into a new `client_settings.prompt_overrides JSONB` containing **appended** sections keyed by slot — never a wholesale prompt replacement. This keeps per-client behavior out of source while still allowing bespoke wording.

A read-only **rendered prompt preview** shows the exact text Retell will receive. Staff-only, since the prompt is proprietary. This is the primary troubleshooting tool for unexpected agent behavior.

### 6.3 Client-editable (`knowledge:write`, `client_owner` only)

FAQs, services, pricing, promotions — the relational tables from migration `012`, which already overlay the legacy JSONB columns via `knowledgeService.settingsWithKnowledge`. Plus `notification_emails`.

**Business hours** have no dedicated column today; they live untyped inside `booking_rules` JSONB. This phase gives them a Zod-validated shape, still stored in `booking_rules` — no migration required, and the booking service gains a schema it can rely on:

```ts
{ tz: string,
  weekly: [{ day: 0-6, open: "HH:mm", close: "HH:mm", closed: boolean }],
  exceptions: [{ date: "YYYY-MM-DD", open?: string, close?: string, closed: boolean }] }
```

### 6.4 Migration `018_agent_versions.sql`

```
clients          + agent_sync_state, agent_sync_error, agent_synced_at
client_settings  + prompt_overrides JSONB NOT NULL DEFAULT '{}'
agent_config_versions (id, client_id, version, settings_snapshot jsonb,
                       rendered_prompt text, retell_agent_version,
                       created_by, created_at)
```

A version row is written on every **successful** provision, enabling diff between versions and one-click restore. A bad prompt edit degrades every subsequent call until noticed; without version history, "what changed on Tuesday" is unanswerable.

### 6.5 Validation gate

Before enqueueing a sync: dry-run the template render and reject on missing required identity fields or a prompt exceeding the model's practical size limit. Invalid configuration fails visibly in the dashboard rather than silently on a live call.

### 6.6 Routes

```
GET   /clients/:id/agent                        agents:read
PATCH /clients/:id/agent                        agents:write
GET   /clients/:id/agent/preview                agents:read
GET   /clients/:id/agent/versions               agents:read
POST  /clients/:id/agent/versions/:v/restore    agents:write
POST  /clients/:id/agent/sync                   agents:write   (force, bypass debounce)

GET|POST|PATCH|DELETE /knowledge/faqs           knowledge:read|write
GET|POST|PATCH|DELETE /knowledge/services       knowledge:read|write
GET|POST|PATCH|DELETE /knowledge/pricing        knowledge:read|write
GET|POST|PATCH|DELETE /knowledge/promotions     knowledge:read|write
```

Knowledge routes derive `client_id` from the JWT for client users; staff pass `?clientId`.

### 6.7 UI

- Staff: `/dashboard/clients/[id]/agent` — tabs: Identity, Behavior, Voice & Phone, Knowledge, Prompt Preview, Versions.
- Client: `/dashboard/knowledge` — tabs: FAQs, Services, Pricing, Promotions, Hours & Contacts. Inline-edit tables with a sync badge in the header.

---

## 7. Phase 3 — Support platform

### 7.1 Migration `019_support_ops.sql`

```
ticket_messages + visibility TEXT NOT NULL DEFAULT 'client'
                  CHECK (visibility IN ('client','internal'))

tickets + first_response_at, resolved_at,
          sla_response_due_at, sla_resolution_due_at, sla_breached_at,
          auto_closed_at
```

**As built:** `tickets.source` already exists — migration `014` added it with a default of `'dashboard'` and no CHECK constraint, so `019` does not re-add it. Auto-tickets write `source = 'system'` into the existing column; the values in use are `dashboard`, `voice`, `system`.

`error_fingerprint` is added by migration `017` (alongside `system_errors`, which references it) rather than `019`. It is the dedupe key Phase 1 checks before opening a ticket, paired with the `system_errors.ticket_id` backlink.

### 7.2 Internal notes

The `'client'` default is deliberate: every message written before this migration was client-visible, and defaulting to `'internal'` would retroactively hide history from clients. All new writes pass visibility explicitly.

Enforcement lives in `ticket.service.ts`, not in routes. A single `listMessages(ticketId, { includeInternal })` derives `includeInternal` from the caller's permissions and defaults to `false`. Routes cannot leak internal notes by forgetting a filter — only by explicitly requesting them.

**Critical test:** a `client_owner` token fetching a ticket containing internal notes receives zero internal messages, asserted against the API response body rather than the rendered UI. A leaked internal note is the worst and quietest failure in this build.

### 7.3 SLA

Platform-wide constants, measured in calendar hours (not business hours) for launch:

| Priority | First response | Resolution |
|---|---|---|
| `urgent` | 1h | 8h |
| `high` | 4h | 24h |
| `normal` | 24h | 5d |
| `low` | 3d | 14d |

`sla_*_due_at` is computed on create and recomputed on priority change. `first_response_at` stamps on the first `visibility='client'` message authored by a platform user — internal notes do not count as responding to a customer.

A scheduled job runs every 5 minutes, flags breaches, and emails the assignee. No per-ticket timers.

### 7.4 Auto-tickets

Created with `source='system'`, `priority='high'`, unassigned, `error_fingerprint` set to the triggering fingerprint, and a description carrying the error summary and occurrence count. Auto-closes when the fingerprint has been quiet for 24 hours **and** the ticket has no human message. If a person has engaged, it stays open for a person to close.

### 7.5 Queue UI

`/dashboard/support`, staff. Filters: status, priority, assignee, client, SLA state, source. Default sort by time-to-breach ascending, so the queue self-prioritizes. Each row shows a breach countdown that changes state within 25% of remaining budget — signalled by icon and text, not color alone.

### 7.6 Ticket detail

Thread with internal notes visually distinct, status control, assignment, SLA panel, linked system activity when `error_fingerprint` is set, and a link to the client.

### 7.7 Client view

Own tickets only: create, reply, follow status. Assignee identity is hidden — the client sees "Gravvia Support", never a staff member's name.

### 7.8 Notifications

Existing `backend/src/utils/mailer.ts` via the notifications queue: new ticket → staff, staff reply → client, breach → assignee. All become logged no-ops when `SMTP_PASS` is unset, matching current behavior at `mailer.ts:28`.

### 7.9 Triage permissions

Status change, assignment, priority change, and internal notes all require `tickets:triage`, held only by platform roles. Clients may create and reply, nothing more.

---

## 8. Phase 4 — Client reporting

### 8.1 Correctness fix

`callRecordService.getStats` (`backend/src/services/callRecord.service.ts:97-125`) selects raw rows and aggregates in JavaScript. Supabase caps PostgREST responses at 1000 rows by default, so beyond 1000 calls in the selected period the figures shown to clients are silently wrong and always under-count. A 30-day range on a busy client already exceeds this.

All aggregation moves into SQL. This is a correctness fix on numbers shown to paying customers, not an optimization.

### 8.2 Migration `020_reporting.sql`

Three `SECURITY INVOKER` functions, each taking `(p_client_id, p_from, p_to)`:

- `report_kpis` — the five existing KPI cards, aggregated in Postgres.
- `report_volume(p_bucket)` — calls per bucket, split answered vs voicemail.
- `report_outcomes` — one row per outcome with counts.

Indexes: `call_records(client_id, started_at DESC)`, `calls(client_id, started_at DESC)`.

### 8.3 Timezone

Bucketing uses `date_trunc(bucket, started_at AT TIME ZONE clients.timezone)`. Bucketing in UTC would place a 7pm Monday call into Tuesday for a west-coast client, making the trend chart wrong at every day boundary — an error that is rarely reported and widely noticed.

Bucket auto-selects: range ≤ 31 days → daily, otherwise weekly.

### 8.4 Outcome derivation

Available signals: `appointment_booked`, `lead_recaptured`, `missed_call_recovered`, `in_voicemail`, `call_successful`, `disconnection_reason`, `calls.status`. Precedence, first match wins:

| Outcome | Condition |
|---|---|
| Appointment booked | `appointment_booked` |
| Lead captured | `lead_recaptured` |
| Transferred to human | `calls.status = 'transferred'` |
| Voicemail | `in_voicemail` |
| Question answered | `call_successful` and none of the above |
| Abandoned | everything else |

Voicemail is evaluated before "Question answered" because Retell can mark a voicemail call `call_successful`; the reverse order would misclassify voicemails as answered questions and inflate the outcome that matters most to a client.

"Question answered" is **inferred, not measured** — the schema carries no FAQ-hit signal today. The UI labels it as a grouping, and this spec records the inference so it is not later mistaken for a hard number.

### 8.5 Two call tables

`calls` and `call_records` are parallel tables both keyed on `retell_call_id`. `calls` holds caller number, recording URL, and the transcript FK; `call_records` holds Retell analysis flags. The call log reads a view `client_call_log` joining them on `retell_call_id`. No data migration — the join hides the seam.

### 8.6 Transcript and recording access

`GET /reports/calls` returns caller number, time, duration, outcome, sentiment, and summary. It never returns `recording_url`. The client detail endpoint selects an explicit column list omitting it, rather than stripping it after selection, so a future `SELECT *` cannot leak it.

`GET /reports/calls/:id/transcript` requires `transcripts:read` — `client_owner`, `client_manager`, and platform staff. `client_viewer` receives 403.

`recordings:read` is platform-only. Recording playback lives on the staff call detail page for troubleshooting.

### 8.7 Routes

```
GET /reports/kpis       ?from&to                      analytics:read
GET /reports/volume     ?from&to&bucket               analytics:read
GET /reports/outcomes   ?from&to                      analytics:read
GET /reports/calls      ?from&to&outcome&q&cursor     calls:read
GET /reports/calls/:id                                calls:read
GET /reports/calls/:id/transcript                     transcripts:read
```

`client_id` comes from the JWT for client users; staff pass `?clientId`. The call log paginates by cursor on `started_at` — offset pagination drifts as new calls arrive mid-browse.

### 8.8 Go-live gate

The "only show stats after go-live" rule stays a UI concern, as documented at `backend/src/dashboard-api/stats.route.ts:8-9`. An empty report for a pre-launch client is correct behavior, not a permission error.

### 8.9 UI

`/dashboard/reports` replaces `/dashboard/stats`: KPI row, volume trend (area chart, answered vs voicemail), outcome breakdown (horizontal bars), call log table with detail drawer. `recharts@2.13` is already a dependency.

**As built:** `/dashboard/stats` is kept as a redirect to `/dashboard/reports` rather than deleted — clients have that URL bookmarked, and a 404 would read as the reporting having been taken away.

Chart specs derived from the `dataviz` skill. Categorical slots 1 and 2 (blue/orange), validated against both surfaces — all six checks pass, worst adjacent CVD ΔE 24.7 light / 26.8 dark against a target of 8. The outcome breakdown deliberately uses **one hue for all six bars**, not six: the categories are nominal and bar length already encodes magnitude, so per-category hues would double-encode length and spend the only free channel on information already on screen. Both charts carry a table view, and the volume chart's legend is always present so identity is never colour-alone.

---

## 9. Navigation and components

### 9.1 Two shells, permission-filtered

Each nav item declares a required permission; the shell filters against the array from `/auth/me`. A group with no visible items is hidden entirely.

```
STAFF                          CLIENT
  Operate                        Overview
    Overview                     Reports
    Calls                        Knowledge
    Bookings                     Support
    Support                      Onboarding   (until go-live)
  Clients                        Team         (client_owner only)
    Clients
    Agents
    Onboarding
    CRM
  System
    System Health
    Users
    Audit Log
    Settings
```

Flat lists degrade past roughly seven items; staff now has thirteen. Grouping is the fix.

### 9.2 Client switcher

A combobox in the staff top bar sets an "acting client" held in URL state. Client-scoped staff pages read it instead of requiring navigation through `/dashboard/clients/[id]`.

### 9.3 Components

- `FilterBar` — state synced to the querystring so filtered views are shareable and the back button behaves correctly.
- `DataTable` — extended with sticky header, sort, cursor pagination, density toggle, and distinct empty / loading / error states.
- New: `LogConsole`, `ChartCard`, `Tabs` (URL-synced, `scroll={false}`), `InlineEditTable` (optimistic write with rollback and `react-hot-toast` on failure), `SyncBadge`, `SlaCountdown`.

### 9.4 Accessibility requirements

Three are live risks in this design:

1. **Never color alone.** Error severity and SLA breach both default to "the row is red." Each requires an icon and a text label.
2. **`aria-label` on icon-only buttons.** Retry, mark-reviewed, and open-client actions in the log console have no accessible name otherwise.
3. **`role="alert"` on error feedback**, not a red border alone.

Also required: visible `focus:ring-2` on all interactive elements (never bare `outline-none`), tables wrapped in `overflow-x-auto`, a skip-to-content link (nav is now 13 items), 4.5:1 minimum contrast, a fixed z-index scale of 10/20/30/50 for drawer/modal/toast, and skeletons sized to final content so async blocks do not shift layout.

### 9.5 Explicitly out of scope

Next.js guidance favors data fetching in Server Components; every page here is `'use client'` with `useEffect`. Converting requires moving auth from a localStorage bearer token to httpOnly cookies and reworking `dashboard/src/lib/api.ts` — a separate project touching every page and every route's authentication. Recorded here as a known deferral, not an oversight.

---

## 10. Testing

Vitest, backend-weighted. The security matrix matters more than CRUD coverage:

- Every `dashboard-api` route × all six roles, allow/deny asserted.
- Cross-tenant: a client user requesting another `clientId` receives 403.
- Drift guard: no permission string in code is missing from the DB seed.
- Redactor strips credentials from error `message`, `stack`, and `context`.
- A `client_owner` fetching a ticket with internal notes receives zero internal messages in the response body.
- `client_viewer` receives 403 on transcript; `client_manager` receives 200.
- No client-path response contains `recording_url`.
- SLA due-date computation per priority; `first_response_at` ignores internal notes.
- Outcome precedence ordering; timezone bucketing at a day boundary.
- Provision debounce coalesces N writes into one job.
- Auto-ticket dedupes by fingerprint.

---

## 11. Rollout

Migrations `016` through `020`, strictly additive. Earlier migrations are never edited, per the convention stated in the `006` header.

`016` is the only migration that can lock users out. It ships with:

- its backfill mapping (section 4.1),
- a rollback migration written up front,
- a post-migration verification query asserting every user landed on a valid role in the correct scope.

Work happens on a new branch off `main`. The current branch `fix/voice-consistency` is unrelated. Before branching, the working tree needs resolving: modified files across `DEPLOYMENT.md`, `render.yaml`, `supabase/seed.sql`, `backend/src/routes/health.route.ts`, several deleted docs, and an untracked `backend/scripts/seed-mikes-plumbing.ts`.

---

## 12. Phase summary

| Phase | Contents | Migration |
|---|---|---|
| 0 | RBAC role families, DB as single source of truth, permission-aware nav | `016` |
| 1 | Error capture, redaction, `system_activity` view, console, retention | `017` |
| 2 | Agent manager, debounced Retell sync, version history, knowledge editing | `018` |
| 3 | Internal notes, SLA timers, auto-tickets, staff queue | `019` |
| 4 | SQL aggregation, trend + outcomes, call log with transcripts | `020` |

Each phase ends shippable.
