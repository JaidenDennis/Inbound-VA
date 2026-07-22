# Enterprise Readiness Checklist — Gravvia Engage

Target: production-ready for real paying customers by **Fri 2026-07-24**.
Reviewed 2026-07-21. Legend: **P0** = launch blocker · **P1** = required for enterprise-grade · **P2** = hardening/polish.

## What was verified green today
- Backend production build (`npm run build`): **clean**.
- Backend tests (`npm run test`): **227 passing / 35 files**.
- Backend typecheck + dashboard typecheck: **clean**.
- `.env` is gitignored (no secret leak); env is Zod-validated at boot; graceful shutdown wired (API + workers); JWT + RBAC + per-tenant `assertClientAccess`; Retell webhook HMAC on raw body; credentials encrypted at rest.

## ✅ Completed in the fix pass (2026-07-21)
- **Migrations 011–014 pushed to Supabase and verified live** (7 new tables + 3 `tickets` columns present; `schema_migrations` tracks all 14). Added a real migration runner: `npm run migrate` (with `--dry`), which baselines the hand-applied 001–010 and applies new ones transactionally.
- **`setup.sql` regenerated** from migrations (now 34 tables, was 27) — fresh-project bootstrap is current again.
- **ESLint fixed and green** — new flat configs for backend (`eslint.config.js`) and dashboard (`eslint.config.mjs`); backend **0 problems**, dashboard **0 errors** (17 style warnings). Fixed 6 real backend lint errors (unused imports, `let`→`const`).
- **CI added** — `.github/workflows/ci.yml` runs typecheck · lint · test(+coverage) · build for backend (with a Redis service) and dashboard on every push/PR to `main`.
- **Coverage gate** — `npm run test:coverage` with thresholds set just under current (lines 45 / branches 37 / funcs 40 / stmts 43) to block regressions; ratchet up as tests are added.
- **Log redaction extended** for the new PHI field (`dob` / `date_of_birth`).
- **Routing-enablement helper** — `npm run routing:enable -- <clientIdOrSlug> [--provision]` flips `workflow_routing` and (opt-in) deploys the `inbound_routing` agent. Built, not run (targets a live Retell agent — you choose the client).
- Declared previously-transitive deps (`pg`, `@types/pg`, `@vitest/coverage-v8`, `typescript-eslint`, `@eslint/js`, dashboard `eslint`).

---

## P0 — Launch blockers

- [x] **Regenerate `setup.sql` and apply migrations 011–014 to the live database.** DONE — migrations pushed and verified live; `setup.sql` regenerated; `npm run migrate` runner added.
- [x] **Fix ESLint.** DONE — flat configs for both workspaces; backend clean, dashboard 0 errors.
- [x] **Add CI.** DONE — `.github/workflows/ci.yml`.
- [ ] **Turn on the workflow engine per client (still OFF by default — action required).** A normally-provisioned client still gets the legacy single-prompt agent. The helper is ready: `npm run routing:enable -- <clientIdOrSlug> --provision` sets `agent_config.workflow_routing = true` AND deploys the `inbound_routing` agent. Run it for each live client, then confirm the deployed agent shows the `route_intent` tool. **(Needs you to pick the client — it makes a live, billable Retell call.)**
- [x] **GHL CRM adapter verified against the LIVE API.** DONE — `npm run verify:ghl` exercises testConnection, listCalendars/listPipelines, `getAvailability` (parsed 80 real slots), and a full createBooking → updateBooking → cancelBooking cycle on the real calendar (cleaned up). **8/8 pass.** This surfaced and fixed two real bugs mocks missed: `updateBooking` needed `ignoreFreeSlotValidation` AND `assignedUserId` (round-robin calendars 400/422 a reschedule otherwise). Also improved CRM error surfacing to include the provider's response body.
- [ ] **Live end-to-end call test of the routing agent.** The CRM/calendar layer is now live-proven; the remaining piece is a real inbound *call*. Once a client is enabled (above), place real inbound calls and confirm: intent routing, a booking that lands on the GHL calendar, a knowledge answer, an identity-gated account flow, a topic switch, and the emergency path. Watch the `events` table for the `workflow.*` trail and `failed_jobs` for silent failures. **(Requires a live phone number — cannot be automated here.)**

## P1 — Required for enterprise-grade

- [ ] **Production data plane, not free tier.** Supabase free tier auto-pauses (known cause of NXDOMAIN → 401 login failures) and Redis must be durable. Move Supabase + Redis to paid/always-on plans; confirm connection pooling and that `DATABASE_URL` points at the pooler.
- [ ] **Dashboard has zero tests.** Add smoke/e2e coverage for the critical paths: login, client create/edit, call list + detail, CRM connect, booking view. At minimum a Playwright happy-path per page.
- [ ] **No dashboard UI for the new inbound config.** Services/pricing/FAQs/promotions, waitlist, callbacks, and the `workflow_routing` toggle are all DB-only right now. Add CRUD screens (or, as a stopgap for Friday, seed scripts + a documented SQL/settings procedure) so non-engineers can configure a tenant.
- [ ] **Enforce a coverage gate.** Add `vitest --coverage` with a threshold (e.g. 70% lines on `backend/src`) to CI so coverage can't silently regress.
- [ ] **CRM uninstall / re-auth handling.** There is no inbound CRM webhook route; if the GHL marketplace app is uninstalled or a token is revoked, `crm_connections.needs_reauth` won't flip automatically until a sync fails. Add the GHL install/uninstall webhook handler, or document the manual re-auth runbook.
- [ ] **Observability is wired but unproven in prod.** Confirm `SENTRY_DSN` is set for both API and workers. Add alerting on the three failure signals that already exist: rows landing in `failed_jobs`, provisioning runs parked as `manual_review`, and `crm_sync_logs.status = 'failed'`. A simple daily digest email or Sentry alert is enough for launch.
- [ ] **Confirm log redaction covers the new fields.** `LOG_REDACT_PATHS` exists; verify it redacts anything sensitive introduced by the new tools (caller DOB in `verify_identity`, emails, document-request details) so PHI/PII never lands in logs.
- [ ] **Idempotency/replay sanity on the live webhook.** Re-deliver a Retell `call_analyzed` event and confirm no duplicate calls/summaries/CRM pushes (the idempotency keys are there — verify on the real endpoint).

## P2 — Hardening & polish (post-Friday acceptable)

- [ ] Per-tenant rate limits on the tool endpoints (limits are global today).
- [ ] Secret rotation runbook for `JWT_SECRET` and `ENCRYPTION_KEY` (rotating `ENCRYPTION_KEY` requires re-encrypting stored CRM credentials — document the procedure).
- [ ] Backup/PITR policy documented; test a restore.
- [ ] On-call runbook: how to drain `failed_jobs`, re-run a `manual_review` provisioning, and re-auth a CRM connection.
- [ ] Per-call Retell dynamic variables for **live** language/voice switching (`set_language` captures the preference today but doesn't switch voice mid-call).
- [ ] SMS channel (deferred by design — `sms.send` slot reserved; confirm the launch is truly voice-only).
- [ ] Merge `feat/inbound-workflow-engine` via PR review; delete stale root docs already removed in the working tree if intended.
- [ ] Load test: concurrent calls hitting `route_intent` + tool endpoints; confirm Redis/DB headroom and worker concurrency settings.

---

## Suggested order for the week
1. **Mon/Tue:** P0 DB (regenerate + apply migrations), enable routing on a test client, ESLint config, CI skeleton.
2. **Wed:** Live end-to-end call testing against real Retell + GHL; fix whatever the real call surfaces.
3. **Thu:** P1 — paid data plane, dashboard config screens (or documented stopgap), observability alerts, dashboard smoke tests.
4. **Fri:** Regression pass (CI green), coverage gate, PR merge, final live smoke on each production tenant.
