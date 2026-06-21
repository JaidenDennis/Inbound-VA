# Gravvia Engage — Remaining Deployment Steps (Render)

This lists **what's left to do** to finish going live. Foundational pieces are
already done (see "Already in place" below) — don't redo them.

> **Already in place (no action):** Supabase project + migrations `001–007` +
> `data/006`; admin user (`admin@gravvia.com`); backend API + workers running at
> `inbound-va.onrender.com` (native build); Bare Beauty agent provisioned;
> security hardening (scrubbed secrets, AES-256-GCM, rate limits, log redaction,
> configurable CORS); audit retention, Sentry wiring, and failed-job alerting
> (code — needs the env vars below + a deploy to activate).

---

## 1. Rotate the exposed Supabase credentials (do this first)
The `service_role` key, `anon` key, and DB password were committed earlier, so
they must be rotated even though `.env.example` is now scrubbed.
1. Supabase → Settings → API → roll **service_role** and **anon** keys.
2. Supabase → Settings → Database → reset the **password**.
3. Update `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `DATABASE_URL` in the
   Render env group.

## 2. Push the latest backend code
The new backend (configurable CORS, daily retention purge, Sentry, failed-job
alerting) only takes effect once deployed. Push `main`; Render auto-deploys the
backend + workers.

## 3. Add the new env vars to the env group (`gravvia-production`)
On top of the existing keys, set:

| Var | Value | Notes |
|---|---|---|
| `CORS_ORIGINS` | `https://gravvia-dashboard.onrender.com` | **Required** or the dashboard's API calls are blocked. Comma-separate multiple origins. |
| `SENTRY_DSN` | your Sentry DSN | Recommended. Without it, error reporting is a no-op. |
| `ALERT_EMAIL` | ops inbox | Recommended. Receives "manual review" job-failure alerts (needs SMTP configured). |
| `AUDIT_RETENTION_DAYS` | `90` | Optional; default 90. Older `audit_logs`/`events` are purged daily at 03:00. |

## 4. Verify the Workers service
Workers are defined in `render.yaml` and likely already running. Confirm in
Render that **`gravvia-workers`** is live (it runs CRM sync, notifications,
call/transcript processing, booking, and the new retention job). If you
deliberately want a separate Docker worker instead, use:
- New → **Background Worker** → same repo
- **Root Directory:** *(blank / repo root)* · **Dockerfile Path:** `backend/Dockerfile.workers` · **Build Context:** `.`
- Attach the `gravvia-production` env group.

> ⚠️ Do **not** set Root Directory to `backend` with Docker — the Dockerfiles
> build from the **repo root** (they need the root `package-lock.json`). Setting
> it to `backend` makes the build context `backend/` and the build fails.

## 5. Deploy the Dashboard (the main missing service)
- New → **Web Service** → same repo
- **Name:** `gravvia-dashboard`
- **Root Directory:** *(blank / repo root)* · **Dockerfile Path:** `dashboard/Dockerfile` · **Build Context:** `.`
- **Environment vars on this service:**
  - `NEXT_PUBLIC_API_URL=https://inbound-va.onrender.com` — **build-time**; baked
    into the bundle (the Dockerfile declares `ARG NEXT_PUBLIC_API_URL`). Changing
    it later requires a rebuild.
  - `JWT_SECRET=<same value as the backend>` — runtime; the dashboard middleware
    verifies sessions with it. Missing → every `/dashboard` route bounces to login.

## 6. Post-deploy verification
- `GET https://inbound-va.onrender.com/health` → `200`.
- Open the dashboard URL, log in as `admin@gravvia.com`, confirm pages load
  (proves CORS + JWT_SECRET are correct).
- Workers log line `Scheduled daily retention purge (03:00)` on boot.
- (Optional) force a job failure and confirm a `failed_jobs` row + alert email.

## 7. Optional — move the backend onto Docker (`gravvia-api`)
Only if you want to retire the native `inbound-va` service:
1. New → Web Service, **Dockerfile Path:** `backend/Dockerfile`, Build Context `.`,
   Health Check `/health`, env group attached, `PORT=3001`.
2. Set `API_BASE_URL` and `WEBHOOK_BASE_URL` to the new `gravvia-api` URL.
3. **Re-provision the agent** so Retell calls the new URL (otherwise calls keep
   hitting `inbound-va`).
4. Point `NEXT_PUBLIC_API_URL` (dashboard) at the new URL and rebuild.
5. Retire `inbound-va`.

## 8. Still deferred (not blocking launch)
- Provision the other clients + populate `clients.phone_numbers`.
- Enable Supabase Point-in-Time Recovery (verify your plan supports it).
- Uptime monitor on `/health`; Redis memory alerts.
- **CRM integrations** — intentionally deferred.
