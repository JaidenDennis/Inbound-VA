# Gravvia Engage – Deployment Guide (Render)

## Prerequisites
- GitHub repo with this codebase
- Supabase project (free tier works for launch)
- Upstash Redis or Render Redis
- Retell AI account with at least one agent

---

## Step 1: Supabase Setup

1. Create a new Supabase project at https://supabase.com
2. Open SQL Editor → run migrations in order:
   ```
   supabase/migrations/001_initial_schema.sql
   supabase/migrations/002_rls_policies.sql
   supabase/migrations/003_seed_roles.sql
   supabase/seed.sql  ← update the admin password hash first!
   ```
3. Copy the Project URL and Service Role Key

**Generate a real bcrypt hash for the seed admin password:**
```js
import bcrypt from 'bcryptjs';
const hash = await bcrypt.hash('YourSecurePassword!', 10);
console.log(hash);
```

---

## Step 2: Redis Setup

Option A – Upstash (recommended, free tier):
1. Create Redis at https://upstash.com
2. Copy the Redis URL (starts with rediss://)

Option B – Render Redis:
1. Create a Redis instance on Render
2. Copy the Internal Redis URL

---

## Step 3: Render Deployment

### 3a. Create Environment Group
1. Render Dashboard → Env Groups → "gravvia-production"
2. Add all variables from .env.example with real values

### 3b. Deploy Backend API
1. New → Web Service → Connect GitHub repo
2. Name: `gravvia-api`
3. Root Directory: `backend`
4. Environment: `Docker`
5. Dockerfile Path: `Dockerfile`
6. Health Check Path: `/health`
7. Attach env group: `gravvia-production`
8. Add NEXT_PUBLIC_API_URL env var pointing to this service URL

### 3c. Deploy Workers
1. New → Worker → Connect same GitHub repo
2. Name: `gravvia-workers`
3. Root Directory: `backend`
4. Dockerfile Path: `Dockerfile.workers`
5. Attach same env group

### 3d. Deploy Dashboard
1. New → Web Service → Connect GitHub repo
2. Name: `gravvia-dashboard`
3. Root Directory: `dashboard`
4. Environment: `Docker`
5. Add: `NEXT_PUBLIC_API_URL=https://gravvia-api.onrender.com`

---

## Step 4: Configure Retell Webhooks

In your Retell agent settings, add:
```
call_started:   POST https://gravvia-api.onrender.com/webhooks/retell/call-started
call_ended:     POST https://gravvia-api.onrender.com/webhooks/retell/call-ended
transcript:     POST https://gravvia-api.onrender.com/webhooks/retell/transcript
call_analyzed:  POST https://gravvia-api.onrender.com/webhooks/retell/summary
```

Copy the webhook secret and set `RETELL_WEBHOOK_SECRET` in your env group.

---

## Step 5: First Client Setup

Using the API (or SQL directly):
```sql
UPDATE clients SET retell_agent_id = 'your-retell-agent-id'
WHERE slug = 'your-client-slug';
```

Or via dashboard: Clients → Edit → set Retell Agent ID.

---

## Local Development

```bash
# 1. Copy .env
cp .env.example .env
# Fill in real SUPABASE_URL, RETELL keys, etc.

# 2. Start Redis
docker run -p 6379:6379 redis:7-alpine

# 3. Start backend
cd backend && npm install && npm run dev

# 4. Start workers (separate terminal)
cd backend && npm run start:workers

# 5. Start dashboard
cd dashboard && npm install && npm run dev
```

Dashboard: http://localhost:3000
API: http://localhost:3001/health
