# Gravvia Engage — Remaining Deployment Steps (Render)

What's left to finish going live. Foundational work is done — don't redo it.

> **Already live / done (no action):** Supabase + migrations `001–007` + `data/006`;
> admin user; **backend API live** (`inbound-va.onrender.com`, native build) with
> **rotated** Supabase creds and the **latest code deployed**; **dashboard live**;
> CORS allow-list confirmed; security hardening (AES-256-GCM, rate limits, log
> redaction); audit-retention / Sentry / failed-job-alerting code shipped.

---

## 1. Change the admin password (do now)
The seeded login `admin@gravvia.com` / `Beastmode21!` is in the committed seed
file — treat it as public. Log in, then change it via **Dashboard → Users** (or
`PATCH /users/:id` with a new `password`).

## 2. Deploy the Workers — needs a Render paid plan (currently NOT deployed)
Render Background Workers require a paid instance, so this is blocked until you
upgrade. **Until workers run, these don't happen** (jobs just queue in Redis):
- email notifications (handoff / callback / staff messages),
- post-call automations (appointment confirmations + 24h reminders, lead recovery,
  missed-call follow-up),
- CRM sync, transcript / call / analytics processing,
- the daily retention purge and failed-job alerts.

**The core still works without workers:** inbound calls, the agent talking,
booking, lead capture, lookups, and the dashboard — those run synchronously in
the API. You're only missing the async follow-ups above, which resume once
workers are deployed.

**Option A — separate worker service (when on a paid plan):**
- New → **Background Worker** → same repo · Root Directory *(blank)* · Docker ·
  Dockerfile `backend/Dockerfile.workers` · Build Context `.` · attach the
  backend env group. Verify the log shows `Started 7 workers`.

**Option B — co-locate workers in the API (no extra cost if the API is already a
paid, always-on Web Service):** set **`RUN_WORKERS_IN_API=true`** on the API
service's env, then redeploy. The API process then also runs all 7 workers +
the retention schedule (look for `Workers co-located in the API process` and
`Started 7 workers` in the API logs). Trade-off: less isolation than the
architecture's default — fine at launch scale. Only works if the API never
spins down (free-tier web services sleep, which would stall the queues).

## 3. Enable Supabase Point-in-Time Recovery (after you upgrade the Supabase plan)
Not available on the current plan — enable it once upgraded.

## 4. Monitoring (when ready)
- Uptime monitor on `https://inbound-va.onrender.com/health`.
- Redis memory alerts.
- After workers are up: confirm a failure-alert email arrives and that the daily
  retention purge logged `Retention purge complete`.

## 5. Pre-launch smoke tests
- Log in to the dashboard; every page loads.
- `GET /admin/plugins` returns the CRM + calendar adapters.
- Create a test appointment via `POST /booking/create`.
- (After workers) retry a failed job from the dashboard.

---

## Decisions / deferred
- **Backend on Docker?** No — staying on the working native build (a migration
  would force an agent re-provision for no functional gain).
- **CRM integrations** — intentionally deferred (per-client creds + field maps).
