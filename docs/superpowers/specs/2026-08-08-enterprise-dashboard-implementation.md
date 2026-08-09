# Enterprise Dashboard — Implementation Spec

**Date:** 2026-08-08
**Product:** Gravvia Engage
**Repo:** `Inbound Agent v4` (working tree at `4ab227f`)
**Source design:** `docs/superpowers/specs/26-08-08-Enterprise-dashboard-design.md`
**Status:** Implementation spec, pending review

---

## 0. Reconciliation with the design doc

The design doc was written against a different picture of the codebase. It names
the product `outbound-backend`, and its companion handoff prompt asks whether
"any HTTP surface exists today beyond webhooks." In this repo the answer is a
16-file `dashboard-api`, a shipped RBAC system, and migrations through `021`.

Four claims in the design doc do not hold here. This spec is built on the
corrections, not the claims.

| Design doc claim | Reality in this repo | Consequence |
|---|---|---|
| §8 "All views read from existing tables. No new core schema." | `invoices`, `sequence_runs`, and `retell_resources` do not exist. Revenue has no invoice source; there is no sequence engine; agent versions live in `agent_config_versions` (migration `018`). | Revenue attribution is derived, not invoiced (§4.2). Sequence performance is cut (§11). Agent versions already exist and are reused. |
| §8 "Permission grants require one new additive table." | Migration `016` already ships 6 roles across 2 scopes and 24 grant strings, resolved from the DB at request time via `permission.service.ts`. | The axes become an overlay on the shipped model, not a replacement (§2). |
| §3.3 demand intelligence reads from existing data | Call reason, referral source, unanswered questions, frustration signals, and per-call quality scores are **not captured anywhere today**. `call_records` carries five booleans and a `raw_analysis` JSONB. | A signal-capture phase gates the entire owner view (§3). This is the critical path. |
| §7 multi-location "built on the existing multi-tenant `client_settings` model" | No location concept exists in any table, route, or type. | Locations are deferred, but every grant ships with a nullable `location_id` from day one so the retrofit is additive (§2.4, §11). |

Three design-doc assumptions **do** hold, and they carry real weight:

- `audit_logs` (`001_initial_schema.sql:378`) already has `user_id`, `action`,
  `entity_type`, `entity_id`, `old_value`, `new_value`, `ip_address`,
  `user_agent`. §2's audit requirement needs a discipline, not a schema.
- `callback_requests` (`014_account_ops.sql:16`) already has the status
  lifecycle that §4's "unreturned callbacks" item needs.
- The AI layer is built: `backend/src/ai/` holds `assistant.service.ts`,
  `copilot.service.ts`, `call-intelligence.service.ts`, `ticket-draft.service.ts`,
  surfaced through `dashboard-api/ai.route.ts`.

One structural defect in the design doc: **§4 has no heading.** The text at
lines 132–146 ("A work queue, not a report…") is the Manager view and is
treated as §4 throughout this spec.

---

## 1. Scope and phase order

Six phases. Each ends shippable. Migrations run `022`–`027`, additive only,
per the convention stated in the `006` header.

| Phase | Contents | Migration | Gates |
|---|---|---|---|
| A | Permission overlay, `client_admin` role, audit discipline | `022` | — |
| B | Signal capture: call reason, referral source, knowledge gaps, flags, quality score | `023` | Gates C and D |
| C | Owner analytics: money, trust, demand, funnel | `024` | B |
| D | Manager work queue | `025` | B |
| E | Admin config: diff-before-publish, sandbox test call, integration health | `026` | A |
| F | AI traceability, weekly digest, alerting, exports, white-label | `027` | C |

**The order is not negotiable on one point.** Phase A ships before any
transcript or configuration surface. Retrofitting access control onto a live
transcript endpoint is the failure mode this ordering exists to prevent, and
the medical tenants make it a compliance question rather than a preference.

Phase B before C is the other hard edge: building charts against signals that
are not captured produces a dashboard of zeroes.

---

## 2. Phase A — Permission model

### 2.1 The reconciliation

The design doc models access as three capability axes (`view` / `act` /
`configure`). Migration `016` already models it as 24 `resource:verb` grant
strings resolved from the `permissions` table.

**These are the same model under two names.** The verb already *is* the axis:
`calls:read` is a view grant, `bookings:write` is an act grant,
`knowledge:write` is a configure grant. Renaming 24 strings across 25 files to
express something the strings already express would be a large, risky, purely
cosmetic change.

So: keep the vocabulary, adopt the axes as the *classification* that decides
which bundle a grant belongs to, and add only the grants that are genuinely
missing.

| Axis | Existing grants | Added in `022` |
|---|---|---|
| view | `clients:read`, `calls:read`, `bookings:read`, `crm:read`, `analytics:read`, `settings:read`, `users:read`, `tickets:read`, `transcripts:read`, `recordings:read`, `knowledge:read`, `agents:read`, `system:read` | `flags:read`, `callbacks:read`, `exports:read` |
| act | `calls:write`, `bookings:write`, `tickets:write`, `tickets:triage`, `system:write` | `flags:write`, `callbacks:write` |
| configure | `clients:write`, `crm:write`, `settings:write`, `users:write`, `knowledge:write`, `agents:write` | `configure:roles`, `configure:alerts` |

`configure:roles` is the single grant separating Owner from Admin, exactly as
the design doc specifies.

### 2.2 The new role

One new client-scope role, `client_admin`, sitting between `client_owner` and
`client_manager`:

| Role | Scope | Shape |
|---|---|---|
| `client_owner` | client | Everything a tenant can do, **including** `configure:roles` and `users:write` |
| `client_admin` | client | Configure agent, knowledge, integrations, hours, alerts. **No** `configure:roles`, **no** `users:write` |
| `client_manager` | client | View and act. No configure grants at all |
| `client_viewer` | client | View only — the read-only compliance role, no new tier needed |

The design doc's Manager has `act` but no `configure`; that is the shipped
`client_manager` with `flags:write` and `callbacks:write` added. Its Owner and
Admin map to `client_owner` and the new `client_admin`.

`client_admin` receives `agents:write`, which is platform-only today. **The
prompt boundary is enforced in the service, not the grant** (§6.3): the grant
opens agent configuration; `agent_prompt` remains rejected for every
client-scope caller.

### 2.3 Per-client editable bundles

The design doc requires bundles editable per client. `permissions` is global
per role, so a per-client edit needs an overlay.

Migration `022` adds:

```sql
CREATE TABLE client_permission_overrides (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,
  permission  TEXT NOT NULL,
  granted     BOOLEAN NOT NULL,          -- true = add, false = revoke
  location_id UUID,                      -- reserved; always NULL until locations ship
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, role, permission)
);
```

Resolution, in `permission.service.ts`:

```
effective(user) = base_grants(user.role)
                ∪ overrides(user.client_id, user.role) WHERE granted
                − overrides(user.client_id, user.role) WHERE NOT granted
```

Platform users (`client_id IS NULL`) skip the overlay entirely — there is no
client to scope it to, and a platform grant must never be reachable from
tenant-editable data.

**The escalation guard.** Without it, a `client_owner` grants themselves
`system:write` and reads every tenant's error console. Two independent
defences, because one is not enough for a privilege boundary:

1. A DB `CHECK` restricting `role` to the four client-scope roles, plus a
   `CHECK` restricting `permission` to an explicit allowlist of client-safe
   grants. `recordings:read`, `system:*`, `clients:write`, and every platform
   grant are absent from that list.
2. A service-layer assertion in the write path that re-checks the allowlist and
   refuses to persist a row outside it, so a future migration relaxing the
   CHECK cannot silently open the hole.

Cache invalidation follows the existing pattern: the 60-second TTL in
`permission.service.ts` is keyed on role today and becomes keyed on
`role + client_id`, invalidated on any write to either table.

### 2.4 Location scoping

`location_id` ships nullable and unused. Nothing reads it in Phase A.

This costs one column now and saves a migration against a populated
permissions table later. It is the only concession this spec makes to
multi-location, which is otherwise deferred (§11).

### 2.5 Audit discipline

`audit_logs` needs no schema change. What it needs is a rule with a test behind
it.

**Rule:** every `configure`-axis write and every transcript read calls
`writeAuditLog` with `old_value` and `new_value` populated.

Enforcement is in `backend/src/services/audit.service.ts`, not at call sites.
Configure-axis routes go through a `withAudit(entityType, loader, mutator)`
wrapper that reads the prior state, applies the mutation, and writes the log in
one place. A route cannot forget to audit, because auditing is how it mutates.

Transcript reads audit differently — there is no before/after state. They write
`action='transcript.view'`, `entity_type='call_transcripts'`, `entity_id=<id>`,
`new_value=NULL`. The value is the access record, not the diff.

**Cost note, stated rather than discovered later:** a busy tenant browsing a
call log generates one audit row per transcript opened. At the volumes in
`report_kpis` this is thousands of rows a month per tenant, not millions, and
`idx_audit_logs_created` already covers the retention sweep. It is affordable.
It would not be if it logged list views, so it does not — only individual
transcript reads.

### 2.6 Routes

```
GET    /clients/:id/roles                     users:read
PATCH  /clients/:id/roles/:role               configure:roles
DELETE /clients/:id/roles/:role/:permission   configure:roles
GET    /auth/me                               (existing — now returns effective grants)
```

`/auth/me` already returns the permission array consumed by
`dashboard/src/lib/session.ts`. It returns the *effective* set after this phase.
Frontend gating stays cosmetic; the backend remains the boundary, as the comment
at `session.ts:1-4` already states.

### 2.7 Tests

- Role × route matrix extended to seven roles. The existing
  `backend/src/__tests__/rbac-route-matrix.test.ts` is the template.
- **Escalation denial:** a `client_owner` attempting to grant `system:write`,
  `recordings:read`, or any platform grant is rejected at both the service and
  the DB.
- Overlay resolution: add, revoke, and add-then-revoke each produce the
  expected effective set.
- Platform users are unaffected by any overlay row.
- Cache invalidation: a revoke takes effect within the TTL, not at token expiry.
- Drift guard (existing): no permission string referenced in code is absent from
  the seed. Extended to cover the overlay allowlist.
- `withAudit` writes `old_value` and `new_value` on every configure route —
  asserted by iterating the route table, so a new route added without the
  wrapper fails the suite.

---

## 3. Phase B — Signal capture

**This is the critical path and the largest single risk in the build.**

The owner view's differentiator is demand intelligence. None of it is captured.
Everything in §3.3 of the design doc — call reasons, source attribution,
knowledge gaps — plus flagged calls (§3.2) and per-call quality scores (§3.2)
requires signals that do not exist in any table today.

### 3.1 Where signals come from

Two sources, deliberately split by cost and reliability:

**Retell post-call analysis** — configured per agent as custom analysis fields.
Cheap, arrives with the `call_ended` webhook, already lands in
`call_records.raw_analysis` (`008_client_dashboard.sql:145`). Suited to short
extractions the voice model already has context for.

**Post-call AI pass** — `backend/src/ai/call-intelligence.service.ts` run on a
queue against the transcript. Costs a model call per call. Suited to judgement:
quality scoring, frustration detection, knowledge-gap identification.

| Signal | Source | Why |
|---|---|---|
| `call_reason` | Retell | The agent knows why the caller rang; extraction is near-free |
| `referral_source` | Retell | Captured conversationally ("how did you hear about us") |
| `requested_service` | Retell | Needed for lost-demand quantification |
| `service_available` | Retell | Whether the agent could book it |
| `escalation_reason` | Retell | Grouping escalations by reason is the §3.2 requirement |
| `unanswered_questions` | AI pass | Requires judging whether the KB answered, not just what was asked |
| `frustration_signal` | AI pass | Needs tone and flow, not keywords |
| `quality_score` | AI pass | Accuracy, resolution, tone — the §3.2 coverage claim |

### 3.2 Migration `023`

Promoted columns on `call_records`, all nullable, all backfilled `NULL`:

```sql
ALTER TABLE call_records
  ADD COLUMN IF NOT EXISTS call_reason        TEXT,
  ADD COLUMN IF NOT EXISTS referral_source    TEXT,
  ADD COLUMN IF NOT EXISTS requested_service  TEXT,
  ADD COLUMN IF NOT EXISTS service_available  BOOLEAN,
  ADD COLUMN IF NOT EXISTS escalation_reason  TEXT,
  ADD COLUMN IF NOT EXISTS quality_score      NUMERIC(3,1),   -- 0.0–10.0
  ADD COLUMN IF NOT EXISTS quality_accuracy   NUMERIC(3,1),
  ADD COLUMN IF NOT EXISTS quality_resolution NUMERIC(3,1),
  ADD COLUMN IF NOT EXISTS quality_tone       NUMERIC(3,1),
  ADD COLUMN IF NOT EXISTS flagged            BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS flag_reasons       TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS analyzed_at        TIMESTAMPTZ;
```

Promoted rather than left in `raw_analysis` because every one of them is
aggregated or filtered on. `raw_analysis` remains the durable record of what
the provider actually sent.

Plus one table for knowledge gaps, which are per-question rather than per-call:

```sql
CREATE TABLE knowledge_gaps (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  call_id      UUID REFERENCES calls(id) ON DELETE SET NULL,
  question     TEXT NOT NULL,
  normalized   TEXT NOT NULL,            -- lowercased, punctuation stripped
  occurrences  INTEGER NOT NULL DEFAULT 1,
  resolved_faq_id UUID REFERENCES faqs(id) ON DELETE SET NULL,
  resolved_at  TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, normalized)
);
```

`normalized` with a `UNIQUE` is what makes "add this answer" (§3.3) a single
action against a group rather than against one call. The same failure the
`system_errors` fingerprint solves in migration `017`, and solved the same way.

Indexes: `call_records(client_id, flagged) WHERE flagged`,
`call_records(client_id, analyzed_at)`, `knowledge_gaps(client_id, occurrences DESC)`.

### 3.3 The analysis queue

New BullMQ queue `call-analysis`, following the existing worker isolation in
`backend/src/workers/`.

Enqueued from the `call_ended` webhook **after** the transcript lands, since the
AI pass needs it. Debounced per `retell_call_id` for idempotency — the webhook
is retried by the provider and must not produce two model calls.

Failure is not silent: exhausted retries write `system_errors` with
`source='worker'`, which the Phase 1 auto-ticket rule (migration `017`) already
picks up.

**Degradation is explicit.** When `isAiConfigured()` is false, the queue is not
registered and the analysis columns stay `NULL`. Every Phase C surface reading
them must render "not measured", never `0` — a zero is a claim, and a false one.

### 3.4 Retell agent configuration

Custom analysis fields must be added to the provisioning template so they are
configured on every agent, not hand-added per client. This lands in
`backend/src/services/provisioning.service.ts` and the vertical templates.

Existing agents need a re-provision to pick them up. That is the debounced sync
already built in migration `018` (`agent_sync_state`), triggered once per client
as a backfill step, not a new mechanism.

**Signals arrive from the re-provision date forward.** No backfill is possible —
the data was never captured. Every Phase C surface reading these columns states
its coverage start date. A trend chart that silently begins mid-history reads as
a collapse in call volume.

### 3.5 Tests

- Each Retell field maps to its column, and a missing field yields `NULL`, not
  `false` or `0`.
- The AI pass is idempotent per `retell_call_id`; a duplicated webhook produces
  one analysis.
- Knowledge-gap normalization groups "do you take Delta?" and "Do you take
  Delta" into one row with `occurrences = 2`.
- With AI unconfigured, the call completes normally and analysis columns stay
  `NULL`.
- Quality scores outside 0–10 are rejected rather than clamped.

---

## 4. Phase C — Owner analytics

Cluster order is the design doc's and is deliberate: money, then candid failure
data, then insight. Surfacing failure voluntarily is what makes the money
figures credible.

All aggregation happens in SQL. This is settled repo policy, not a preference:
migration `020`'s header records that JavaScript aggregation silently
under-counted every figure past 1000 rows because PostgREST caps responses
there. New reporting functions follow `report_kpis` / `report_volume` /
`report_outcomes` exactly — `SECURITY INVOKER`, `(p_client_id, p_from, p_to)`.

### 4.1 After-hours capture

The primary persuasion metric, and derivable today.

Business hours live untyped inside `client_settings.booking_rules` JSONB. The
prior spec (`2026-08-05`, §6.3) defined the Zod shape; this phase needs it in
SQL. Migration `024` adds:

```sql
CREATE FUNCTION is_after_hours(p_client_id UUID, p_at TIMESTAMPTZ) RETURNS BOOLEAN
```

reading `booking_rules->'weekly'` and `booking_rules->'exceptions'`, evaluated
in the client's timezone via `clients.timezone` — the same rule migration `020`
applies to volume bucketing, and for the same reason: a 7pm Monday call bucketed
in UTC becomes Tuesday for a west-coast tenant.

**A client with no configured hours has no after-hours figure.** The surface
shows "set your business hours to see this" and links to the editor. It does not
assume 9–5, which would invent the headline number.

### 4.2 Revenue attribution

There is no `invoices` table, so revenue is **derived and labelled as an
estimate** everywhere it appears.

```
booked_revenue = Σ over appointments in range where status ∈ ('confirmed','completed')
                 of price(appointment)
```

`price(appointment)` resolves `appointments.service_type` (TEXT) against
`services.name` (`012_knowledge_tables.sql:25` — `UNIQUE(client_id, name)`),
falling back to `pricing.price` by `service_id`, then to a per-client average
ticket.

**`appointments.service_type` is free text, not an FK.** Unmatched values are
counted separately and shown as "N appointments with unmatched services" beside
the figure. Silently dropping them under-reports revenue; silently averaging
them over-reports it. Naming the gap is the only honest option, and it is also
the prompt that gets the client to fix their service names.

Migration `024` adds `appointments.service_id UUID REFERENCES services(id)`,
nullable, populated going forward by the booking service. Match quality improves
without a data migration.

`cost_per_booked_appointment` needs the client's subscription cost, which lives
in no table. It is entered once as `client_settings.billing_baseline` JSONB
(`{ monthly_cost, receptionist_hourly, hours_per_week }`) by staff during
onboarding. **Absent baseline, the card does not render.** A cost comparison
against an assumed number is a fabricated claim, which `PRODUCT.md` principle 5
forbids.

### 4.3 Cumulative ROI

Anchored on the `onboarding_milestones` row where `stage_key='go_live'` and
`status='complete'`, using `completed_at` (`008_client_dashboard.sql:97`).

Never windowed, never reset — it is renewal insurance and the number only goes
up. Materialized nightly into `client_roi_snapshots` (`client_id`, `as_of`,
`booked_revenue`, `after_hours_revenue`, `recovered_calls`, `total_cost`)
rather than recomputed across all history on every page load.

Pre-go-live clients see the onboarding checklist (§4.6) in this slot, not a
zero.

### 4.4 Trust cluster

- **Containment rate** — `1 − (transferred / total)`, using `calls.status`,
  available today.
- **Escalations grouped by reason** — `call_records.escalation_reason` from
  Phase B. Before Phase B data accumulates, the group is "reason not captured",
  labelled as coverage rather than as a category.
- **Flagged-call queue** — `call_records.flagged` + `flag_reasons`. One click to
  the transcript, gated on `transcripts:read`; recording playback stays
  platform-only per migration `016`'s comment and the design doc's PHI rule.
- **Quality score trend** — `AVG(quality_score)` bucketed like `report_volume`,
  with `COUNT(*) FILTER (WHERE quality_score IS NOT NULL)` shown as coverage.
  The coverage figure is not optional: the differentiating claim is that *every*
  call is scored, and that claim has to be auditable on the surface making it.

### 4.5 Demand intelligence

- **Top call reasons** — ranked, week-over-week delta.
- **Lost demand** — `requested_service` where `service_available = false`,
  counted and, where the service name matches a `services` row the client has
  marked inactive, priced. Where it matches nothing, it is shown as a count with
  no dollar figure. **An estimated dollar figure on a service the client does
  not price is invented**, and §3.3's "missed-revenue quantification" is
  therefore scoped to services that exist and are priced but unbookable.
- **Knowledge gaps** — from `knowledge_gaps`, ordered by `occurrences`. The
  inline "add this answer" action writes an `faqs` row and stamps
  `resolved_faq_id` / `resolved_at`, which triggers the debounced agent
  re-provision from migration `018`. This is the tightest loop in the product:
  a question the agent could not answer becomes an answer it can, in one action.
- **Peak call times** — hour-of-week heatmap in client timezone, framed as a
  staffing decision.
- **Source attribution** — `referral_source` rolled up by channel. Free-text
  values are normalized through a lookup in `lib/vocabulary.ts`, unmatched
  values grouped as "other" with the raw values inspectable.

### 4.6 Onboarding readiness

Shown only while `go_live` is incomplete or `completed_at` is within 30 days,
then retired from the view.

Scored from data already present: `onboarding_milestones`, KB row counts
(`faqs`, `services`, `pricing`), `crm_connections.status`,
`client_settings.notification_emails`, and whether `booking_rules.weekly` is
configured. No new storage.

### 4.7 Routes

```
GET /reports/money        ?from&to&clientId    analytics:read
GET /reports/trust        ?from&to&clientId    analytics:read
GET /reports/demand       ?from&to&clientId    analytics:read
GET /reports/funnel       ?from&to&clientId    analytics:read
GET /reports/readiness    ?clientId            analytics:read
GET /reports/flagged      ?from&to&cursor      flags:read
```

`clientId` resolution uses the existing `resolveClientScope`
(`auth.middleware.ts:87`): client users are pinned to their own tenant, platform
staff may name one or omit it for the cross-tenant view.

### 4.8 Tests

- Every function returns correct figures past 1000 rows — the regression
  migration `020` exists to prevent.
- After-hours evaluates in client timezone across a DST boundary.
- A client with no `booking_rules.weekly` gets `NULL`, not `0`, and the surface
  renders the empty state.
- Unmatched `service_type` values are counted, not dropped or averaged.
- No `billing_baseline` ⇒ the cost card is absent from the response, not zeroed.
- ROI is monotonic across snapshots.
- Quality coverage percentage is correct when only some calls are analyzed.
- No client-path response contains `recording_url` (existing test, extended to
  the new routes).

---

## 5. Phase D — Manager work queue

A work queue, not a report. The design doc's governing rule is the acceptance
criterion: **every item on this screen must be closable.** If a manager cannot
act on it, it belongs in the owner view.

### 5.1 The unified queue

Migration `025` adds a `manager_queue` view unioning five sources into one
shape — `kind, id, client_id, occurred_at, title, detail, age_seconds,
assignee_id, severity`:

| Kind | Source | Close action |
|---|---|---|
| `flagged_call` | `call_records WHERE flagged AND NOT reviewed` | Mark reviewed |
| `unreturned_callback` | `callback_requests WHERE status='pending'` | Complete / cancel |
| `failed_booking` | `events WHERE type='booking.failed'` | Retry / dismiss |
| `untouched_escalation` | `calls WHERE status='transferred'` with no linked ticket | Open ticket / dismiss |
| `calendar_conflict` | `appointments` overlapping on `(client_id, staff_member_id)` | Reschedule / dismiss |

The union pattern mirrors `system_activity` from migration `017`. The four
pre-existing tables gain no new writes.

`call_records` needs `reviewed_at` / `reviewed_by` for the flagged queue —
added in `025`, matching the `system_errors` review columns exactly so the
review UI is one component.

### 5.2 Unreturned callbacks

Called out separately because it is the design doc's stated worst failure mode:
a promise the agent made and a human did not keep, otherwise invisible.

Age is measured from `callback_requests.created_at`. Ordering is age-descending
by default, so the queue self-prioritizes toward the oldest broken promise.
Breach styling reuses `SlaCountdown` and follows the accessibility rule already
binding in this repo: icon and text, never colour alone.

### 5.3 Today vs. same weekday last week

Enough context to notice a break, not a second analytics surface. Two figures
and a delta: calls handled, and appointments booked. Same weekday, not
day-before — Monday against Sunday is noise.

### 5.4 Live call feed

Reads the existing `client_call_log` view (`020_reporting.sql:152`), which
already excludes `recording_url` by construction. Searchable by phone number
against `from_number`.

Transcript opening is gated on `transcripts:read` and **writes an audit row**
per §2.5.

### 5.5 Routes

```
GET   /queue                ?kind&assignee&cursor   flags:read
POST  /queue/:kind/:id/close                        flags:write
POST  /queue/:kind/:id/assign                       flags:write
GET   /queue/pulse          ?clientId               analytics:read
```

### 5.6 Tests

- Every `kind` has a close action, asserted by iterating the kind enum — this is
  the test that enforces the governing rule.
- Closing is idempotent; a double-submit does not double-write.
- Calendar conflict detection catches exact overlap, partial overlap, and
  containment, and ignores `cancelled` appointments.
- Cross-tenant: a manager cannot close another tenant's item.

---

## 6. Phase E — Admin config

### 6.1 Versioned configuration and revert

Already built. `agent_config_versions` (`018_agent_versions.sql:49`) stores
`settings_snapshot`, `rendered_prompt`, `retell_agent_version`, `created_by`,
written on every successful provision, with restore routes shipped.

This phase adds the **client-facing** surface over it, gated on `agents:write`,
plus `withAudit` coverage per §2.5.

### 6.2 Diff-before-publish

New `GET /clients/:id/agent/diff` returning a structured diff between the
current `client_settings` and the pending edit: changed fields, before/after,
and affected downstream behaviour (booking availability, escalation routing,
KB answers).

The existing dry-run validation gate (`2026-08-05` spec §6.5) already renders
the template before enqueueing. The diff extends it rather than duplicating it.

### 6.3 The prompt boundary

`agent_prompt` and the vertical templates are **not client-editable**. The
service rejects any client-scope write touching them, independent of grants.
`client_settings.prompt_overrides` (migration `018`) remains the only path, and
remains staff-only.

The design doc's framing is correct and the UI must carry it: a stated,
explained boundary reads as a quality guardrail; an unexplained absence reads as
a product limitation. The surface shows what is client-managed, what is
Gravvia-managed, and a request path for changes outside it.

### 6.4 Sandbox test call

Against the pending configuration, before publish.

Implemented as a Retell test agent provisioned from the pending
`settings_snapshot`, called via the web-call API, torn down after. It does not
touch the live agent or the live number.

**This is the highest-uncertainty item in the spec.** It depends on Retell test
agent lifecycle behaviour that has not been verified in this codebase. It is
sequenced last within Phase E, and if it proves unworkable the fallback is the
rendered-prompt preview that already exists — a smaller feature, honestly
labelled, rather than a broken one.

### 6.5 Integration health

`crm_connections.status` and `last_sync_at` exist. Add last-success timestamps
for calendar, telephony, and webhooks by reading the most recent successful
`events` row per type. No new writes; the events are already recorded.

Surfaces alongside the existing Connections tab rather than as a new route.

### 6.6 Tests

- A client-scope caller writing `agent_prompt` receives 403 with every grant
  including `agents:write`.
- Diff correctly reports added, removed, and changed fields, including nested
  JSONB.
- Restore writes an audit row with the actor and the full before/after.
- Sandbox provisioning tears down its test agent even when the call fails.

---

## 7. Phase F — AI layer, delivery, and presentation

### 7.1 The three AI rules

The design doc's rules are enforceable, so this spec enforces them:

1. **Every claim is traceable.** Each insight returns a `call_ids` array with
   the prose. The UI renders no insight without a working click-through. An
   insight with an empty `call_ids` is dropped by the service, not rendered
   without its link — untraceable insight is decoration.
2. **Anomaly detection over summarization.** The service is given period-over-
   period deltas, not raw figures, and instructed to report deviation. Output
   restating a chart is a prompt failure with a test behind it.
3. **Weekly digest by email.** Via the existing notifications queue and
   `backend/src/utils/mailer.ts`, which already degrades to a logged no-op when
   `SMTP_PASS` is unset (`mailer.ts:28`). For owners who never log in, the
   digest is the product.

### 7.2 Alerting

Threshold alerts on containment drop, integration down, escalation spike, and
missed-revenue threshold. Stored in `client_alert_rules` (migration `027`),
evaluated by a scheduled job on the existing 5-minute cadence used by the SLA
sweep.

Email ships in this phase. **Slack and SMS are deferred** — each is a separate
provider integration with its own credentials, retry semantics, and failure
modes, and neither is required to make the alerting loop useful.

**Mobile push for high-intent leads is deferred entirely.** There is no mobile
app in this repo and no push infrastructure; the design doc's own framing ("most
owners will not log in") is served by the digest and by email alerting in the
meantime. Recorded as a real deferral, not an omission.

### 7.3 Exports

CSV on all owner clusters, generated server-side and streamed — a client-side
export of a paginated table exports the page, not the report.

**PDF is deferred.** It needs a rendering dependency and a layout system for
every cluster, and it is the lowest-value half of "CSV and PDF": CSV is what
gets loaded into a spreadsheet and actually used. Scheduled recurring reports
attach the CSV.

### 7.4 White-label

`clients.branding JSONB` (`{ logo_url, primary_hex, wordmark_text }`), migration
`027`.

**The design doc calls this "low build cost." In this design system it is not.**
`DESIGN.md` records that chroma is reserved for state — green, amber, and red
mean good, fair, and bad, and interactive affordance is achromatic *precisely so
a call-to-action can never be misread as a healthy row*. A client-supplied
`primary_hex` in the lamp hue range destroys the one rule the whole palette is
derived from.

So branding is scoped to what cannot collide with state:

- Logo replaces the "GE" monogram tile in the rail.
- `wordmark_text` replaces the product name in the header.
- `primary_hex` is applied **only** to the login panel housing and the digest
  email header, and is rejected at save time if it falls within the lamp hue
  ranges. The rejection message explains why rather than silently substituting.

Custom domain is deferred — it is a Render and DNS change per tenant, not a
dashboard feature.

### 7.5 Semantic transcript search

Natural-language search across transcripts, scoped by permission, subject to the
same PHI gating and access logging as direct viewing.

Requires embeddings: `pgvector` on Supabase, an embedding column on
`call_transcripts`, a backfill across existing transcripts, and an embedding
step in the transcript webhook path.

**Sequenced last in Phase F and shippable separately.** It is the only item here
with a new infrastructure dependency, and the phase should not be held hostage
to it. If `pgvector` provisioning slips, Phase F ships without it and search
remains keyword-based against `call_transcripts.content`, which works today.

Every search result that reveals transcript content writes an audit row per
§2.5 — the search surface is a transcript read surface, and gating the detail
view while leaving search open would be a hole.

---

## 8. Cross-cutting requirements

### 8.1 PHI and transcripts

Hard requirements, restated because they cut across every phase:

- Transcript and recording access gated by explicit grant. `recordings:read`
  stays platform-only, per migration `016`.
- Every transcript view audited (§2.5), including via search (§7.5).
- Redaction on display for configured PHI fields. The existing redactor from
  migration `017` (`system_errors`) is the pattern; PHI field configuration is
  per-client in `client_settings`.
- Retention policy visible in the UI. The 90-day `system_errors` sweep already
  exists; transcript retention is a per-client setting surfaced read-only to
  clients and editable by staff.

### 8.2 Design system

This is a visual **extension**, not a revamp. `DESIGN.md` is binding:

- Chroma reserved for state. New surfaces use `StatusLamp` for status and
  achromatic ink for affordance.
- New charts extend `.viz-root`. **The two existing categorical slots (teal
  `#1E7A90`, mulberry `#9B4D93`) have not been re-run through the numeric
  CVD/contrast gate** — `DESIGN.md` says so explicitly. A third slot requires
  re-validating all three, not appending one.
- Tables use `components/Table.tsx` primitives. Commit `c716883` migrated the
  last hand-rolled ones; do not reintroduce any.
- Freshness: any polling surface shows its age and switches to the amber
  `stale ·` label past 90s, keeping last-good values rather than blanking.
- Destructive actions use `ConfirmDialog` and name the consequence.

### 8.3 Data-fetching architecture

Every dashboard page is `'use client'` with `useEffect` + `axios`. Converting to
Server Components requires moving auth from a localStorage bearer token to
httpOnly cookies and reworking `lib/api.ts` — a separate project touching every
page and every route.

Carried forward from the `2026-08-05` spec §9.5 as a known deferral, restated
here so it is not rediscovered as a surprise mid-build.

---

## 9. Testing

Vitest, backend-weighted. The security matrix matters more than CRUD coverage.
Beyond the per-phase tests above, the suite gains:

- **Seven-role × every-route matrix**, allow/deny asserted.
- **Privilege escalation**: no client-scope override can produce a platform
  grant, asserted at both service and DB layers.
- **Audit completeness**: iterating the configure-axis route table, every route
  writes `old_value` and `new_value`. A new route without `withAudit` fails.
- **Transcript access**: `client_viewer` 403, `client_manager` 200, and an audit
  row exists after the 200.
- **No `recording_url` on any client-scope response**, extended to all new routes.
- **Aggregation past 1000 rows** for every new reporting function.
- **Unmeasured ≠ zero**: with AI unconfigured, every Phase C surface returns
  `null` and no surface returns `0`. This is the test that protects the
  never-fabricate-trust principle in code rather than in prose.

---

## 10. Rollout

Migrations `022`–`027`, additive. Earlier migrations are never edited.

`022` is the only one that can lock users out. It ships with a rollback written
up front (following `supabase/rollbacks/016_rbac_role_families_rollback.sql`)
and a post-migration verification block that aborts the transaction rather than
half-migrating — the pattern proven at `016_rbac_role_families.sql:180`.

Work happens on a branch off `main`. The tree is clean at `4ab227f`.

Phase B carries a **staged rollout**: enable signal capture on one internal
tenant first, verify the Retell fields arrive and the AI pass costs what it is
expected to cost, then re-provision the rest. A per-call model invocation across
every tenant is the first genuinely per-call recurring cost in this system, and
it should be measured on one tenant before it is measured on the bill.

---

## 11. Out of scope

Carried from the design doc:

- Voice prompt editing by clients (§6.3 makes the boundary explicit)
- Replacing GHL for small clients
- Real-time call monitoring / barge-in
- Billing and subscription management UI
- Peer benchmarking — deferred, not rejected. Needs tenant density within a
  single vertical plus explicit data-sharing consent.

Added by this spec, with reasons:

- **Sequence performance** (design doc §3.4). No `sequence_runs` table and no
  sequence engine exists. This is a subsystem to build, not a report to write.
- **Multi-location** (design doc §7). No location concept exists anywhere.
  Requires `locations`, a `location_id` on `calls` and `appointments`,
  backfill, and scoping across every query. Its own spec. `location_id` ships
  nullable on permission grants (§2.4) so the retrofit stays additive.
- **Mobile push notifications** (§7.2). No app, no push infrastructure.
- **PDF export** (§7.3). CSV ships; PDF needs a rendering stack.
- **Custom domains** (§7.4). Render and DNS per tenant, not a dashboard feature.
- **Slack and SMS alert channels** (§7.2). Email ships first.

---

## 12. Success criteria

From the design doc, with the measurement that proves each:

| Criterion | Proof |
|---|---|
| An owner states the agent's dollar value within ten seconds of landing | Money cluster renders above the fold with a figure or an explicit "configure this to see it", never a zero |
| A manager clears the day's exception queue without leaving the view | Every `kind` in `manager_queue` has a close action, asserted by test (§5.6) |
| An admin changes config, previews the diff, tests it, publishes, and reverts — without Gravvia | The Phase E loop end-to-end, with the prompt boundary visibly stated |
| A compliance reviewer gets transcript read with no other capability, every access retrievable | `client_viewer` + `transcripts:read` override; every view queryable from `audit_logs` (§2.5, §9) |
