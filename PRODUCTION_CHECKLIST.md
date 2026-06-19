# Gravvia Engage – Production Checklist

## Infrastructure
- [ ] Supabase project created, URL + service role key added to .env
- [ ] Redis instance provisioned (Redis Cloud / Upstash / Render Redis)
- [ ] Environment variables set on Render (never committed to git)
- [ ] ENCRYPTION_KEY is a cryptographically random 32+ char string
- [ ] JWT_SECRET is a cryptographically random 32+ char string

## Database
- [ ] Run migration 001_initial_schema.sql on production Supabase
- [ ] Run migration 002_rls_policies.sql
- [ ] Run migration 003_seed_roles.sql
- [ ] Run seed.sql with real admin password hash
- [ ] Verify all indexes exist
- [ ] Enable Point-in-Time Recovery on Supabase

## Retell AI
- [ ] Retell agent(s) created and agent IDs stored in clients table
- [ ] Retell webhook URLs configured:
      POST https://api.gravvia.com/webhooks/retell/call-started
      POST https://api.gravvia.com/webhooks/retell/call-ended
      POST https://api.gravvia.com/webhooks/retell/transcript
      POST https://api.gravvia.com/webhooks/retell/summary
- [ ] RETELL_WEBHOOK_SECRET matches what's configured in Retell dashboard
- [ ] Phone numbers added to clients.phone_numbers array

## CRM Integrations
- [ ] Per-client CRM credentials encrypted and stored in crm_connections table
- [ ] testConnection() verified for each active CRM connection
- [ ] Custom field mappings reviewed for each client

## Security
- [ ] CORS origin locked to dashboard domain in production
- [ ] Rate limiting tuned for expected traffic
- [ ] Helmet headers active
- [ ] Audit log retention policy set
- [ ] No raw CRM credentials in logs (encrypted at rest)

## Render Deployment
- [ ] Backend service created (Web Service, Docker)
- [ ] Workers service created (Worker, Docker, Dockerfile.workers)
- [ ] Dashboard service created (Web Service, Docker)
- [ ] Health check path set to /health
- [ ] Auto-deploy from GitHub enabled
- [ ] Environment variables group shared across services

## Monitoring
- [ ] SENTRY_DSN configured (optional but recommended)
- [ ] Uptime monitor on /health endpoint
- [ ] Redis memory alerts configured
- [ ] BullMQ failed-job alerting tested

## Testing Before Launch
- [ ] POST a test call-started webhook and verify DB record created
- [ ] POST a test call-ended webhook and verify CRM sync queued
- [ ] Create a test appointment via POST /booking/create
- [ ] Login to dashboard, verify all pages load
- [ ] Retry a failed job from /dashboard/settings
- [ ] Verify /admin/plugins returns all registered adapters
