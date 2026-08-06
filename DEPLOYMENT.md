# Gravvia Engage — Deployment Guide

The single authoritative guide for taking this repo from source to a live,
billable product. It replaces the previous `DEPLOYMENT.md`, `PRODUCTION_CHECKLIST.md`
and `RETELL_INTEGRATION.md`, which had drifted out of sync with the code.

---

## 0. Verified state of this repo

These were measured against the current working tree, not assumed:

| Check | Command | Result |
|---|---|---|
| Type safety | `npm run typecheck --workspace=@gravvia/backend` | Clean, 0 errors |
| Production build | `npm run build --workspace=@gravvia/backend` | Clean, emits `dist/server.js` + `dist/workers/index.js` |
| Test suite | `npm test --workspace=@gravvia/backend` | **159 passed / 159**, 26 files |
| Dashboard types | `tsc --noEmit` in `dashboard/` | Clean, 0 errors |
| Boot | `node dist/server.js` | Listens, registers 9 CRM + calendar plugins, handles SIGTERM |
| Schema | `supabase/setup.sql` | Parses as valid PostgreSQL, 189 statements, 27 tables |
| Test fix in this pass | `ghl-provisioning-client.test.ts` | Was asserting the old `picklistOptions` field name that commit `fc7f074` deliberately replaced with `options`; updated to match the verified-against-live-GHL behavior |

**The code is deployable.** What follows is the wiring, in the order that works.

### Read this before you deploy

> **Render deploys from GitHub, and this working tree is ahead of GitHub.**
>
> At the time of writing there were ~70 uncommitted files plus a local commit not
> yet pushed — including the GHL provisioning work, migrations `009`/`010`, and
> the hardening in this pass. Anything not pushed **does not deploy**, and the
> new code depends on migrations that would not exist in the database.
>
> Before anything else in this guide:
>
> ```bash
> git status                  # review — do not blind-commit
> git add -A
> git commit -m "feat: GHL provisioning, regenerated schema, prod hardening"
> git push origin main
> ```
>
> Then confirm the two match — this is the check that matters:
>
> ```bash
> git rev-parse --short HEAD origin/main   # both must print the same hash
> git status --short                       # must be empty
> ```
>
> Re-run those two commands immediately before every deploy. "I fixed that
> already" and "that fix is on GitHub" are different statements.

---

## 1. Prerequisites

| Service | Plan needed | Why | Rough cost |
|---|---|---|---|
| **Supabase** | Free works to start; Pro for Point-in-Time Recovery | System of record | $0 → $25/mo |
| **Redis** | Upstash free tier works; paid for durability | BullMQ queues | $0 → $10/mo |
| **Render** | **Paid (Starter)** — see note | API + workers + dashboard | ~$21/mo (3 × $7) |
| **Retell AI** | Pay-as-you-go | Voice layer | Per-minute |
| **SMTP** (SendGrid/Postmark) | Free tier fine | Notification email | $0 |

> **Render free tier will not work for this.** Free web services sleep after
> inactivity. A sleeping API means Retell's webhooks hit a cold instance and calls
> fail — the one failure mode you cannot ship to a paying customer. Background
> Workers also require a paid plan outright.

You also need Node 22+ locally. Node 20 fails: `@supabase/supabase-js` requires
native `WebSocket`, which Node 20 does not provide.

---

## 2. Supabase

1. Create a project. Region close to your customers.
2. **SQL Editor → paste the entire contents of `supabase/setup.sql` → Run.**
3. Confirm the final query returns **`tables_created: 27`**. A lower number means
   the script errored partway — scroll up for the first error and fix it before
   continuing. Do not proceed on a partial schema.
4. **Settings → API**, copy: Project URL, `anon` key, `service_role` key.
5. **Settings → Database**, copy the connection string.

### About setup.sql

`setup.sql` is **generated** from `supabase/migrations/*.sql` by
`node supabase/build-setup.mjs`. Never hand-edit it. When you add a migration,
regenerate and commit both.

It was previously hand-maintained and had silently drifted — it was missing 7
tables (`tickets`, `ticket_messages`, `ticket_status_history`, `call_records`,
`client_action_items`, `onboarding_milestones`, `retell_phone_numbers`) and every
column added after migration 008. A fresh project built from the old file would
have deployed successfully and then thrown runtime errors the first time anyone
opened the dashboard's Support, Calls, or Onboarding pages.

If you have an **existing** Supabase project, run only the migrations you have
not applied yet, in numeric order — do not run `setup.sql` over live data.

### Do not run seed.sql in production

`supabase/seed.sql` creates an admin whose password is published in this repo. It
now refuses to run unless you explicitly opt in, and it can no longer overwrite an
existing admin's password. It is for local development only.

---

## 3. Create your admin login

There is deliberately no default admin account and no default password.

In the Supabase SQL Editor, run — with your own values:

```sql
INSERT INTO users (email, name, password_hash, role, is_active)
VALUES (
  'you@yourdomain.com',
  'Your Name',
  crypt('YOUR_STRONG_PASSWORD_HERE', gen_salt('bf', 12)),
  'super_admin',
  true
)
ON CONFLICT (email) DO NOTHING;
```

Use a password manager, 16+ characters. `pgcrypto`'s bcrypt output is verified
correctly by `bcryptjs` in the API, so this hash is portable.

---

## 4. Redis

Create an Upstash Redis database. Copy the connection string — you want the
`rediss://` (TLS) URL. Note that BullMQ holds connections open, so a free tier
with aggressive connection limits will cause intermittent job failures under load.

---

## 5. Render

The repo ships a Blueprint at `render.yaml` defining three services:

| Service | Type | Start command |
|---|---|---|
| `gravvia-backend` | web | `npm run start --workspace=@gravvia/backend` |
| `gravvia-workers` | worker | `npm run start:workers --workspace=@gravvia/backend` |
| `gravvia-dashboard` | web | `npm run start --workspace=@gravvia/dashboard` |

**Render → New → Blueprint → connect this repo.** Render reads `render.yaml` and
prompts for the secrets in the `gravvia-secrets` env group.

### Why workers are a separate service

Without the worker service, jobs enqueue into Redis and never execute. You lose:
email notifications, post-call automations (appointment confirmations, 24h
reminders, lead recovery, missed-call follow-up), CRM sync, transcript and
analytics processing, the daily retention purge, and failed-job alerts.

Inbound calls, the agent talking, booking, lead capture and the dashboard all
still work without workers — those run synchronously in the API. But you are
selling the follow-up automation, so deploy the workers.

**Budget alternative:** set `RUN_WORKERS_IN_API=true` on the API service and skip
the worker service. This co-locates all 7 workers in the API process. Only viable
if the API is always-on. Look for `Workers co-located in the API process` and
`Started 7 workers` in the API logs. Less isolation, fine at launch scale.

### Environment variables

Set these once in **Env Groups → gravvia-secrets** (shared by API and workers):

| Variable | Notes |
|---|---|
| `JWT_SECRET` | 32+ chars, random. Rotating it logs everyone out. |
| `ENCRYPTION_KEY` | 32+ chars. **AES-256-GCM key for CRM credentials at rest. If you lose or change this, every stored CRM credential becomes undecryptable and every client must reconnect their CRM.** Back it up. |
| `SUPABASE_URL` | From step 2 |
| `SUPABASE_SERVICE_ROLE_KEY` | Bypasses RLS. Treat as a root password. |
| `SUPABASE_ANON_KEY` | From step 2 |
| `DATABASE_URL` | From step 2 |
| `REDIS_URL` | From step 4 |
| `RETELL_API_KEY` | Also verifies webhook signatures — see §6 |
| `API_BASE_URL` | The deployed backend URL, e.g. `https://gravvia-backend.onrender.com` |
| `WEBHOOK_BASE_URL` | Same as `API_BASE_URL` unless you use a custom domain |
| `CORS_ORIGINS` | **The dashboard's URL.** See below. |
| `GHL_CLIENT_ID` / `GHL_CLIENT_SECRET` | Only if using GoHighLevel |
| `SMTP_*`, `EMAIL_FROM` | For notification email |
| `ALERT_EMAIL` | Where exhausted-retry job alerts go. Set it. |
| `SENTRY_DSN` | Optional but recommended |

On the **dashboard** service, set `NEXT_PUBLIC_API_URL` to the backend URL. This
is inlined into the client bundle **at build time**, so changing it requires a
redeploy, not a restart.

### The CORS ordering problem

The backend and dashboard reference each other's URLs, so you cannot set both on
the first deploy. Expected sequence:

1. Deploy all three. Dashboard API calls will fail — this is normal.
2. Copy the dashboard's URL into the backend's `CORS_ORIGINS`.
3. Redeploy the backend.

If `CORS_ORIGINS` is unset in production, the API now logs a loud error at boot
naming the problem. Without it, the symptom is "the dashboard loads but every
request fails" with nothing in the API logs — a CORS rejection is enforced by the
browser and never reaches a route handler.

---

## 6. Retell

Set `RETELL_API_KEY`. That is the whole configuration.

**There is no separate webhook secret.** Retell signs both webhook events and
custom-function calls with your API key:

```
X-Retell-Signature: v={unix_ms_timestamp},d={hmac_sha256(rawBody + timestamp, RETELL_API_KEY)}
```

Valid for 5 minutes. Verification lives in
`backend/src/providers/retell/retell.validator.ts` and runs on every webhook and
function endpoint. `RETELL_WEBHOOK_SECRET` is legacy and optional.

Webhook and function URLs are **set automatically during provisioning** — you do
not configure them in the Retell dashboard.

```
POST {WEBHOOK_BASE_URL}/webhooks/retell           # dispatcher: call_started, call_ended, call_analyzed
```

Custom functions the agent calls mid-call, all signature-validated:

```
/functions/retell/check_availability      /functions/retell/schedule_callback
/functions/retell/book_appointment        /functions/retell/leave_staff_message
/functions/retell/book_consultation       /functions/retell/request_human_handoff
/functions/retell/qualify_lead            /functions/retell/lookup_existing_client
```

> **The single most common production failure: stale function URLs.** Function
> URLs are baked into the agent at provisioning time from `WEBHOOK_BASE_URL`. If
> you ever provisioned while that pointed at a dev tunnel (ngrok) or a wrong URL,
> the live agent calls a dead endpoint and 404s mid-call. Fix: set
> `WEBHOOK_BASE_URL` to the deployed backend URL and **re-provision every client**.
> Provisioning is idempotent — re-running is safe and refreshes all URLs.

---

## 7. Onboard your first client

```bash
# 1. Create the client
curl -X POST https://YOUR-API/clients \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Acme Dental","slug":"acme-dental","industry":"dental",
       "timezone":"America/New_York","phoneNumbers":["+15551112222"]}'

# 2. Configure agent + knowledge base (or use the dashboard)
curl -X PATCH https://YOUR-API/clients/CLIENT_ID/settings \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"businessName":"Acme Dental","agentName":"Sam","bookingEnabled":true, ...}'

# 3. Provision the Retell agent (idempotent)
curl -X POST https://YOUR-API/clients/CLIENT_ID/provision \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{}'
```

Provisioning creates the Retell Response Engine + Agent on first run and updates
them in place afterward, keyed on the stored `retell_llm_id` / `retell_agent_id`.
Pass `{"buyAreaCode": 415}` to purchase a new Retell number — **this spends money**.

`business_name` and `agent_name` are rendered into the prompt at provisioning time,
so the agent never speaks a raw `{{variable}}`. Missing values fall back gracefully
(business → client name, agent → "your assistant").

To add a vertical beyond med spa: implement `AgentTemplate` and register it in
`backend/src/providers/retell/templates/index.ts`. No other code changes.

---

## 8. GoHighLevel (optional)

1. Create a marketplace app at `marketplace.gohighlevel.com` → Developer → My Apps.
2. Register the redirect URI: `{API_BASE_URL}/crm/level/oauth/callback`.
   The path deliberately avoids the strings `ghl` and `highlevel` — the
   marketplace rejects redirect URLs containing them.
3. Set `GHL_CLIENT_ID` / `GHL_CLIENT_SECRET`.
4. Per client: `GET /crm/gohighlevel/oauth/install` → complete the OAuth flow →
   `POST /crm/ghl/provision` applies the blueprint (pipelines, custom fields, tags).
5. Track with `GET /crm/ghl/provision/:runId`; status via `GET /crm/:clientId/gohighlevel/status`.

A 401 from GHL sets `needs_reauth` on the connection and surfaces in the dashboard.
See `docs/ghl-dashboard-setup.md` for the click-by-click walkthrough.

Provisioning also writes `custom_field_mapping` (field name → GHL field id) onto
the connection — without it GHL silently drops every custom field on every sync.
Connections provisioned before this, or whose fields were made by hand in the
GHL UI, need a one-time `npm run map:ghl-fields` (add `-- --dry-run` first).

### Clay → CRM outbound leads (optional)

`POST /webhooks/clay/lead` accepts an enriched lead from Clay and queues the CRM
write on the existing crm-sync pipeline (retries, idempotency, `crm_sync_logs`),
so outbound leads land without anyone exporting a CSV.

1. Set `CLAY_INGEST_SECRET` (16+ chars) and `CLAY_DEFAULT_CLIENT_ID` (the client
   whose CRM connection the leads land in — Gravvia's own sub-account).
2. In Clay, add an **HTTP API** column pointed at
   `{API_BASE_URL}/webhooks/clay/lead` with header
   `Authorization: Bearer {CLAY_INGEST_SECRET}`.

Unset `CLAY_INGEST_SECRET` disables the endpoint (503) — it never falls open.
Full field mapping and the Clay-side setup: `docs/clay-to-crm-outbound.md`.

---

## 9. Smoke tests before you sell

Run every one of these against production. Do not skip.

- [ ] `GET /health` returns **200** with `database: ok` and `redis: ok`. A 503 means a dependency is down — do not launch.
- [ ] Log in to the dashboard. Every page loads: Clients, Calls, Bookings, CRM, Analytics, Support, Users, Onboarding.
- [ ] `GET /admin/plugins` lists all CRM + calendar adapters.
- [ ] `POST /booking/create` creates a test appointment; it appears in the dashboard.
- [ ] **Place a real inbound call to a provisioned number.** The agent answers, handles an FAQ, and books.
- [ ] After that call: transcript and summary appear in the dashboard within ~1 minute. *(If they never appear, your workers are not running.)*
- [ ] Confirmation email arrives for the test booking.
- [ ] Worker logs show `Started 7 workers`.
- [ ] Force a job failure; confirm it lands in `failed_jobs` as `manual_review` and `ALERT_EMAIL` receives the alert.
- [ ] Retry that failed job from the dashboard.
- [ ] Next day: worker logs show `Retention purge complete`.

---

## 10. Operational runbook

**Uptime monitoring.** Point your monitor at `/health` (returns 503 when a
dependency is down, pulling the instance out of rotation) and `/health/live` for
liveness only — use `/health/live` for anything that pages you, so a transient
Redis blip doesn't wake you at 3am.

**Symptom → cause:**

| Symptom | Likely cause |
|---|---|
| Agent 404s mid-call on a function | Stale `WEBHOOK_BASE_URL` baked into the agent → re-provision (§6) |
| Dashboard loads, every request fails | `CORS_ORIGINS` missing the dashboard URL |
| Transcripts/summaries/emails never arrive | Worker service not running |
| `permission denied for table` (42501) | Supabase grants missing → re-run migration `007` |
| "Client not found" on a client that exists | Usually 42501 above, swallowed by the service layer |
| CRM sync stops for one client | `needs_reauth` set → client must redo OAuth |
| Login works, dashboard bounces to /login | Cookie not set (check `SameSite`/`Secure` behind a proxy) |

**Reliability behavior already built in:** idempotency keys on every event, BullMQ
retries with exponential backoff, exhausted retries → `failed_jobs` with
`status = manual_review` (never silent), Sentry capture on 5xx, log redaction of
auth/signature headers, graceful shutdown on SIGTERM, daily retention purge.

---

## 11. Known limitations

- **No SMS.** Voice only, by design. The event and queue architecture accommodates it later without refactoring.
- **Workers require a paid Render plan.** Or set `RUN_WORKERS_IN_API=true`.
- **Point-in-Time Recovery requires Supabase Pro.** Enable it before you hold real customer data you cannot afford to lose.
- **CRM adapters beyond GoHighLevel** (HubSpot, Salesforce, Zoho, generic webhook) are implemented and unit-tested, but have not been exercised against live tenant credentials. Validate against a sandbox before selling into one.
- **Calendar adapters** (Google, Outlook, Calendly) are wired but likewise unproven against live accounts.

---

## 12. Go-live checklist

- [ ] All work committed and pushed; `origin/main` matches local `HEAD`
- [ ] `supabase/setup.sql` run; `tables_created` = 27
- [ ] Admin user created with a strong password; no default account exists
- [ ] All three Render services deployed and green
- [ ] `CORS_ORIGINS` set to the dashboard URL; backend redeployed
- [ ] `ENCRYPTION_KEY` backed up somewhere you will still have in a year
- [ ] `WEBHOOK_BASE_URL` = deployed API URL; all clients provisioned against it
- [ ] Every §9 smoke test passed, including a real phone call
- [ ] Uptime monitor on `/health/live`; Sentry receiving events
- [ ] Supabase PITR enabled (or a documented decision to accept the risk)
- [ ] `ALERT_EMAIL` set and verified to deliver
