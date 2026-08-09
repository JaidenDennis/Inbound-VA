# Claude Code Handoff — Enterprise Dashboard, Plan 1 (Permissions & Role Model)

Paste this as the opening message in Claude Code, run from the root of
`outbound-backend`. Place `2026-08-08-enterprise-dashboard-design.md` at
`docs/superpowers/specs/` first.

---

## Prompt

You are working in the `outbound-backend` repo (Gravvia Engage). Read
`docs/superpowers/specs/2026-08-08-enterprise-dashboard-design.md` in full
before doing anything else.

Your job in this session is **not** to write code. It is to produce an
implementation plan for **one subsystem only**: the permission and role model
described in §2 of the spec. Use the `superpowers:writing-plans` skill and save
to `docs/superpowers/plans/2026-08-08-dashboard-permissions.md`.

### Phase 0 — Mandatory audit (do this first, do not skip)

Before writing a single task, audit what already exists. Report findings back
to me and wait for confirmation before writing the plan.

Answer each of these with **exact file paths and line references**, not
summaries. Where something does not exist, say so explicitly — "not present"
is a valid and useful finding.

**Auth and identity**
1. Is there any existing authentication or user model? Where do users live —
   Supabase Auth, a `users` table, or nothing yet?
2. How is `client_id` currently resolved on an inbound request? Which module
   owns that resolution?
3. Is there any existing notion of a user *within* a client (staff, seats), or
   is the tenant the smallest unit today?

**Authorization**
4. Any existing permission, role, or access-control code? Middleware, guards,
   route-level checks?
5. What do `src/guards/` currently guard — is it request validation, rate
   limiting, or access control? Report what's actually in there.

**Audit logging**
6. Read the `audit_logs` schema and every call site that writes to it. What
   fields exist, what actor concept (if any) does it record, and is it truly
   append-only?
7. Does anything currently record a *human* action, or only system events?

**Config surface**
8. Enumerate everything in `client_settings` that a client could conceivably
   change. This becomes the `configure:*` grant surface — I need the real list,
   not a sample.
9. Where is agent configuration read at call time? Trace the path from
   `client_settings` to the Retell dynamic variables.

**API surface**
10. Is there any HTTP surface today beyond webhooks? Any REST/RPC layer a
    dashboard could consume, or does that need building?
11. What is the test setup — runner, existing test file locations, how the DB
    is handled in tests?

Present findings as a written audit summary. Flag anything that contradicts
the spec's assumptions — especially §8 (Data sources), which claims no new core
schema is needed beyond one additive table for grants. If that claim is wrong,
say so plainly rather than planning around it.

### Phase 1 — Write the plan

Only after I confirm the audit:

**Scope — build exactly this, nothing more:**
- Three capability axes: `view`, `act`, `configure`, each scoped by resource
  and by location
- Grant storage as an **additive** migration; the existing schema stays locked
- Three preset role bundles: Owner, Manager, Admin (per §2 — Owner and Admin
  differ only on `configure:roles`)
- Enforcement at the API boundary, following the existing guard pattern found
  in the audit
- Every `configure` action and every transcript view writes to `audit_logs`
  with actor, timestamp, resource, and before/after state

**Explicitly out of scope for this plan:** any dashboard UI, analytics
aggregation, the work queue, config versioning, semantic search, notifications.
Those are separate plans. If a task starts reaching into them, stop and flag it.

**Hard constraints:**
- Additive migrations only — do not alter existing tables
- Follow existing patterns: adapter/registry, CRM-agnostic canonical types,
  append-only audit tables
- TDD: every task is failing test → run → implement → run → commit
- Exact file paths in every task, complete code in every step, no
  placeholders, no "add appropriate error handling"
- Deliver full files when writing code, not partial patches

**On PHI:** transcript access enforcement is part of this plan, not a later
one. The medical clients are in the pipeline now, and retrofitting access
control onto a transcript endpoint is exactly the failure mode this ordering
exists to prevent.

Do not begin implementation after writing the plan. Stop and let me review it.