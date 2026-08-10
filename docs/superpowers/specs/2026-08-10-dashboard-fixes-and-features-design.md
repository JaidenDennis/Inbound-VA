# Dashboard fixes and features — design

**Date:** 2026-08-10
**Status:** approved, ready for implementation planning

Seven workstreams from a single round of operator feedback. Three reported
symptoms turned out to be one bug; two requested features turned out to be
already built and blocked on configuration. What remains is smaller than the
list looked.

---

## Findings that reshaped the work

Recorded here because they are the reason several items are not what they
appeared to be.

**Three symptoms, one bug.** "Publish Now doesn't work", "every knowledge-base
tab errors on save" and "hours don't update" were all
`500 Custom Id cannot contain :` from BullMQ, surfaced by the production
`system_errors` table. `agentSync.service.ts` built job ids as
`agent-sync:${clientId}` and `${jobId}:now:${Date.now()}`. BullMQ rejects a
custom job id containing `:` unless it has exactly two of them (a legacy
carve-out for repeatable jobs, `Job.validateOptions`). Everything that changes
what the agent says routes through `requestSync()`, so all three features died
on the same character.

`buildIdempotencyKey` hashes to hex, so every other queue call in the codebase
was unaffected.

**Client alert emails are already implemented.** `alert.service.ts` evaluates
rules, sends mail, records `client_alert_events` and honours a cooldown;
`maintenance.worker.ts` already schedules it. Migration 027 already defines the
`containment_drop` / `integration_down` / `escalation_spike` / `missed_revenue`
metrics with per-rule recipients. Nothing arrives because SMTP auth fails
(`failed_jobs`: `535 Authentication failed`) and `sendMail` is a **logged no-op**
when `SMTP_PASS` is unset. The gap is visibility and credentials, not features.

**User editing is nearly complete.** `updateUserSchema` already covers `name`,
`role`, `is_active`, `password`, with tenant isolation and anti-escalation
guards. Only `email` is missing, plus a self-service path and a self-role guard.

---

## W1 — BullMQ job ids *(complete)*

Separator changed from `:` to `-` in both `jobIdFor()` and the immediate-path id.
Client ids are UUIDs and contain no colons, so the result is colon-free by
construction.

The regression existed because `agent-sync.test.ts` mocked the queue with a bare
`vi.fn()` that accepted anything, and then asserted the broken value. The mock
now replicates BullMQ's real validation, so every test in the file guards the
rule. Four assertions that had pinned the bug were corrected.

**Status:** merged into the working tree, 814 tests green, typecheck and lint
clean. Requires deployment to take effect in production.

---

## W2 — Knowledge categories

Free-text category boxes become a dropdown fed by a staff-editable, per-client
list.

**Schema.** New `knowledge_categories`: `id`, `client_id`, `name`, `sort_order`,
`active`, timestamps. Unique on `(client_id, name)`.

**Deliberate choice: `faqs.category` and `services.category` stay `TEXT` and keep
storing the category name.** A `category_id` foreign key would be cleaner in the
abstract, but `knowledge.service.ts:133` reads `r.category` directly into the
agent prompt payload, and that is the only reader. Keeping the denormalised name
means no FK migration against live rows and no change to prompt building.

The cost of that choice is rename handling, which is therefore explicit: renaming
a category updates every matching `faqs.category` / `services.category` row for
that client in the same transaction. Deleting a category is a soft delete
(`active = false`); rows already pointing at it keep their text.

**API.** Staff-only CRUD at `/knowledge/categories` (platform permission).
Clients get read-only access for populating the dropdown. Writes to
`faqs`/`services` validate that a supplied category is one of the client's
active category names, or null.

**UI.** `<select>` replacing the free-text input on the FAQ and Services forms,
plus a staff-side list editor. `pricing` has no category column and is untouched.

---

## W3 — Policies as titled entries

Today `clients.business_policies` is a bare `TEXT[]` of anonymous strings,
rendered into one broad text box.

**Schema.** New `client_policies`: `id`, `client_id`, `title`, `body`,
`sort_order`, `active`, timestamps.

**Deliberate choice: `clients.business_policies` remains the rendering contract.**
It is read by seven agent templates (`dental-routing`, `law-firm-routing`,
`med-spa`, `med-spa-routing`, `orthodontic-routing`, `restaurant-routing`,
`inbound-routing`), plus `retell-functions.route.ts:671`, `agentDraft.service.ts`,
`configDiff.service.ts` and `client.types.ts`. Migrating all of those to a
relational read is a large blast radius for no user-visible gain.

Instead, every write to `client_policies` re-renders the client's active policies
into `business_policies` as `"Title: Body"` strings, ordered by `sort_order`.
Consumers keep working unchanged, and the agent prompt gets *better* structured
text than the anonymous strings it gets today.

**Migration.** Each existing string becomes one row: `body` = the string,
`title` = `Policy 1..n` for the operator to rename. The old column is retained
and kept in sync — not dropped — so rollback stays safe.

**UI.** Repeating title + body pairs with add/remove/reorder, replacing the
single text area.

---

## W4 — Analytics as a cross-company roll-up

The Analytics tab becomes platform-only and aggregates across every tenant. The
Business tab is **not** touched, and the Money/Trust/Demand/Follow-through
clusters stay where they are.

The aggregation already exists: `report_kpis`, `report_volume` and
`report_outcomes` all accept `p_client_id = NULL` for the platform-wide view
(migration 021), which `callRecordService.getStats(null, …)` already relies on.

**Work:** a new page gated by `requirePlatform`, with a company dropdown
offering "All companies" plus each client, calling the existing endpoints with
the selected scope. No new SQL.

---

## W5 — Users

**Permission matrix (approved):**

| Actor | May edit |
|---|---|
| Platform staff | Any user: email, role, password, active |
| Client admin | Own-company users: email, client-scoped roles only |
| Any user, on self | Email and password only — never their own role |

**Work:**
- Add `email` to `updateUserSchema`, with a uniqueness check against the
  existing `users.email` unique constraint, returning 409 rather than a 500.
- New `PATCH /me` for self-service email and password, so a client user does not
  need `users:write` to change their own details.
- New guard in `PATCH /users/:id`: reject any `role` change where
  `target.id === actor.sub`. Without it, a client admin can still escalate
  themselves within client roles, and the approved matrix does not hold.
- Dashboard UI for editing on the Users tab.

---

## W6 — Make email failures loud

`sendMail` currently resolves silently when `SMTP_PASS` is unset, which is why a
dead mailer is invisible.

**Work:**
- Unconfigured SMTP records a single `system_errors` warning per process rather
  than one per send, so the console says "email is not configured" without
  flooding.
- An auth or send failure records a `system_errors` error with the provider
  message.
- Both feed the existing integration-health surface on `/dashboard/system`.
- Alert evaluation stays best-effort: a dead mailer must not abort the
  maintenance job or block `client_alert_events` from being recorded. The
  existing `notified` flag already distinguishes "attempted" from "delivered".

Credentials themselves are the operator's to supply; this workstream makes their
absence and their failure visible.

---

## W7 — Sentry correlation

**Rejected approach:** pulling Sentry issues into the dashboard console. It
requires a Sentry API token, pagination and rate-limit handling — a second
credential and a sync loop to maintain, to redisplay data Sentry already presents
better.

**Chosen approach:** correlate the two systems already in place.
- Enrich each captured event with client id, route, user id and request id.
- Capture the `event_id` Sentry returns from `captureException`.
- Store it in a new `system_errors.sentry_event_id` column, and log it via pino.
- The dashboard error console deep-links each row to its Sentry issue.

No new credentials, nothing to keep in sync.

---

## Implementation order

1. **W6** — make failures visible before anything depends on email.
2. **W5** and **W7** — small and contained.
3. **W2** and **W3** — share the knowledge-base UI surface.
4. **W4** — self-contained new page.

W1 is already complete and needs only deployment.

## Migrations

Three new migrations, numbered from 029 (028 is the `call_id` unique-constraint
migration applied 2026-08-09):

- `029` — `knowledge_categories` (W2)
- `030` — `client_policies` + backfill from `business_policies` (W3)
- `031` — `system_errors.sentry_event_id` (W7)

Each ships with a rollback file, per the existing convention in
`supabase/rollbacks/`.

## Testing

- **W2/W3:** schema validation, category rename cascade, the
  `business_policies` re-render (its exact string output is the agent's input and
  must be asserted), tenant isolation on the staff-only category endpoints.
- **W5:** the full permission matrix including the self-role-change rejection and
  the duplicate-email 409.
- **W6:** unconfigured vs failing SMTP produce the right severity, warn-once
  behaviour, and alert evaluation completing despite a dead mailer.
- **W7:** `sentry_event_id` recorded when Sentry is configured, and absent
  without it, with no error path either way.
- **W4:** platform-only access control, and that a client-scoped user cannot
  reach the cross-company data.

## Out of scope

- Audit log — confirmed working, no changes.
- Business tab layout and its clusters.
- Retell billing outage and the historical transcript backfill, both tracked
  separately.
