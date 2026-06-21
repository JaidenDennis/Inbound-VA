# Gravvia Engage — Production Checklist (Outstanding Items)

Only **remaining** work is listed. Done already (no action): Supabase + all
migrations, admin user, backend/workers live, security hardening, Bare Beauty
agent, and the audit-retention / Sentry / failed-job-alerting code.

## Secrets (do first)
- [ ] Rotate Supabase `service_role` + `anon` keys and the DB password
- [ ] Update `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY` / `DATABASE_URL` in the Render env group

## Environment / config (Render `gravvia-production`)
- [ ] `CORS_ORIGINS` = the dashboard's public URL (required — else dashboard API calls are blocked)
- [ ] `JWT_SECRET` set on the **dashboard** service (same value as backend)
- [ ] `NEXT_PUBLIC_API_URL` set on the dashboard (build-time)
- [ ] `SENTRY_DSN` configured (recommended — error reporting is a no-op without it)
- [ ] `ALERT_EMAIL` configured (recommended — job-failure alerts; needs SMTP)
- [ ] `AUDIT_RETENTION_DAYS` reviewed (optional; default 90)

## Deploy
- [ ] Push latest backend code (CORS / retention / Sentry / alerting)
- [ ] Confirm `gravvia-workers` is running on Render
- [ ] Deploy the dashboard (Docker, build context = repo root, **not** Root Directory `backend`)

## Retell
- [ ] If the backend URL changes (migrating to `gravvia-api`), set `WEBHOOK_BASE_URL` and re-provision the agent
- [ ] Provision the remaining clients; populate `clients.phone_numbers`

## Data protection
- [ ] Enable Supabase Point-in-Time Recovery (verify your plan supports it)

## Monitoring
- [ ] Uptime monitor on `/health`
- [ ] Redis memory alerts
- [ ] Verify a job-failure alert email actually arrives (trigger a test failure)
- [ ] Confirm the daily retention purge ran (worker log: "Retention purge complete")

## Pre-launch tests
- [ ] Log in to the dashboard; verify every page loads
- [ ] Retry a failed job from the dashboard / `POST /admin/retry-job`
- [ ] `GET /admin/plugins` returns all registered CRM + calendar adapters
- [ ] Create a test appointment via `POST /booking/create`

## Deferred (post-launch)
- [ ] CRM integrations — per-client credentials, `testConnection()`, field mappings (intentionally deferred)
