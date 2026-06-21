# Gravvia Engage — Production Checklist (Outstanding Items)

Only **remaining** work is listed. Done: Supabase + migrations, admin user,
**rotated secrets**, **backend API live (latest code)**, **dashboard live**, CORS
confirmed, security hardening, and the audit-retention / Sentry / alerting code.

## Now
- [ ] Change the admin password from the seeded default (`Beastmode21!` is in the repo)

## Workers (blocked on Render paid plan)
- [ ] Deploy workers — Option A (separate Background Worker) or Option B (co-locate in the API)
- [ ] Until then, accept that emails, post-call automations, CRM sync, retention purge, and failure alerts do **not** run (core voice + booking + dashboard still work)

## Data protection (blocked on Supabase plan)
- [ ] Enable Point-in-Time Recovery after upgrading the Supabase plan

## Monitoring
- [ ] Uptime monitor on `/health`
- [ ] Redis memory alerts
- [ ] Verify a job-failure alert email arrives (needs workers)
- [ ] Confirm the daily retention purge ran (needs workers; log: "Retention purge complete")

## Pre-launch tests
- [ ] Log in to the dashboard; verify every page loads
- [ ] `GET /admin/plugins` returns all registered CRM + calendar adapters
- [ ] Create a test appointment via `POST /booking/create`
- [ ] Retry a failed job from the dashboard (needs workers)

## Deferred (post-launch)
- [ ] CRM integrations — per-client credentials, `testConnection()`, field mappings
