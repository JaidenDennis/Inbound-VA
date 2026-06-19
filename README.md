# Gravvia Engage

**Multi-tenant AI voice operations platform** — Retell AI + Fastify + Supabase + Next.js

> Retell Talks → Backend Decides → Database Remembers → CRM Displays

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Retell AI (voice layer)               │
│         call.started / call.ended / transcript / summary │
└───────────────────────┬─────────────────────────────────┘
                        │ HTTPS webhooks (HMAC-SHA256)
                        ▼
┌─────────────────────────────────────────────────────────┐
│               Fastify API  (backend/)                    │
│  • Webhook normalization    • Booking service            │
│  • CRM plugin registry     • Calendar plugin registry   │
│  • JWT auth + RBAC         • Rate limiting               │
│  • Event bus               • Audit logging               │
└───────────┬──────────────────────────┬──────────────────┘
            │                          │
      BullMQ queues              Supabase PostgreSQL
      (Redis)                    (system of record)
            │
   ┌────────▼────────┐
   │    Workers       │
   │  crm-sync       │
   │  booking        │
   │  notifications  │
   │  call-process   │
   │  transcript     │
   │  analytics      │
   └─────────────────┘
```

---

## Plugin Systems

### CRM Adapters
```typescript
import { crmRegistry } from './src/crm/crm-registry.js';

// Register a custom CRM at startup (no core code changes):
crmRegistry.register({
  manifest: { name: 'custom-crm', version: '1.0.0', description: 'My CRM' },
  factory: (config) => new MyCrmAdapter(config),
});
```

Available built-in: `gohighlevel` | `hubspot` | `salesforce` | `zoho` | `webhook`

### Calendar Adapters
```typescript
import { calendarRegistry } from './src/calendar/calendar-registry.js';

calendarRegistry.register({
  manifest: { name: 'acuity', version: '1.0.0', description: 'Acuity Scheduling' },
  factory: (config) => new AcuityAdapter(config),
});
```

Available built-in: `google` | `outlook` | `calendly`

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| API | Node.js · TypeScript · Fastify |
| Database | Supabase PostgreSQL |
| Queue | BullMQ + Redis |
| Dashboard | Next.js 14 · Tailwind |
| Validation | Zod |
| Testing | Vitest |
| Deployment | Render + Docker |

---

## Folder Structure

```
├── backend/src/
│   ├── config/          # Zod env validation
│   ├── db/              # Supabase client
│   ├── types/           # All TypeScript types
│   ├── events/          # Normalized event bus
│   ├── plugins/         # PluginRegistry (generic)
│   ├── crm/             # CRM interface + 5 adapters
│   ├── calendar/        # Calendar interface + 3 adapters
│   ├── booking/         # Booking service
│   ├── queues/          # BullMQ queue definitions + Redis
│   ├── workers/         # 6 async workers
│   ├── providers/retell/# Signature validation + normalizers
│   ├── services/        # client, contact, call, audit
│   ├── middleware/       # JWT auth, RBAC, Retell signature
│   ├── routes/          # API + webhook routes
│   ├── dashboard-api/   # Admin endpoints
│   └── __tests__/       # Vitest test suite
├── dashboard/src/
│   └── app/             # Next.js app router pages
├── supabase/
│   ├── migrations/      # 3 SQL migrations
│   └── seed.sql         # Dev seed data
├── docker-compose.yml
├── DEPLOYMENT.md
└── PRODUCTION_CHECKLIST.md
```

---

## Quick Start

```bash
cp .env.example .env        # fill in values
docker-compose up           # starts redis + api + workers + dashboard
```

See [DEPLOYMENT.md](./DEPLOYMENT.md) for full Render deployment guide.

---

## API Reference

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /webhooks/retell/call-started | HMAC | Call started webhook |
| POST | /webhooks/retell/call-ended | HMAC | Call ended webhook |
| POST | /webhooks/retell/transcript | HMAC | Transcript webhook |
| POST | /webhooks/retell/summary | HMAC | Summary webhook |
| POST | /booking/create | JWT | Create appointment |
| POST | /booking/cancel | JWT | Cancel appointment |
| POST | /booking/update | JWT | Reschedule appointment |
| GET | /booking/availability | JWT | Get available slots |
| POST | /crm/connect | JWT | Connect CRM |
| POST | /crm/sync | JWT | Manual CRM sync |
| GET | /clients | JWT | List clients (tenant-scoped) |
| POST | /clients | JWT | Create client (platform only) |
| PATCH | /clients/:id | JWT | Update client / disable (status) |
| PATCH | /clients/:id/settings | JWT | Edit per-client settings |
| GET | /users | JWT | List users (tenant-scoped) |
| POST | /users | JWT | Create user (no privilege escalation) |
| PATCH | /users/:id | JWT | Update / deactivate user |
| GET | /analytics/overview | JWT | Analytics summary (tenant-scoped) |
| GET | /admin/calls | JWT | Call list |
| POST | /admin/retry-job | JWT | Retry failed job |
| GET | /health | None | Health check |
