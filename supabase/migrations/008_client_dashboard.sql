-- ============================================================
-- GRAVVIA ENGAGE – Client Dashboard (tickets, onboarding, action items, call records)
-- Run order: 008  (NEVER edit earlier migrations)
--
-- Adds the six tables behind the client-facing dashboard. Idempotent and safe
-- to re-run (IF NOT EXISTS + DROP POLICY ... IF EXISTS).
--
-- SECURITY MODEL (read this before touching the policies below):
--   This app does NOT use Supabase Auth. End-users live in public.users
--   (bcrypt) and authenticate with custom @fastify/jwt tokens. The browser
--   never queries Supabase directly — it calls the Fastify backend, which uses
--   the `service_role` key (bypasses RLS). Tenant isolation is therefore
--   enforced in application code (assertClientAccess / client_id filters), and
--   that is the ACTIVE security boundary — same posture as every other table
--   (see 002_rls_policies.sql).
--
--   The RLS policies here are DEFENSE-IN-DEPTH only. They scope by a `client_id`
--   JWT claim and bind to the `authenticated` role, so IF anything ever connects
--   via PostgREST/anon-key with a Supabase-style JWT, a tenant still cannot read
--   another tenant's rows. They are dormant under the current architecture
--   (service_role bypasses them; nothing connects as `authenticated`).
--
-- NOTE ON FOREIGN KEYS: the spec lists user FKs as `auth.users`, but this app's
--   real users table is public.users — so created_by / changed_by / author_id /
--   assigned_to reference users(id) with ON DELETE SET NULL (mirrors audit_logs)
--   so deleting a user never destroys an audit/message row.
-- ============================================================

-- ─────────────────────────────────────────────
-- TICKETS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tickets (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  subject     TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  priority    TEXT NOT NULL DEFAULT 'normal'
              CHECK (priority IN ('low','normal','high','urgent')),
  status      TEXT NOT NULL DEFAULT 'investigating'
              CHECK (status IN ('investigating','waiting_on_client','waiting_on_third_party','resolved','closed')),
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tickets_client         ON tickets(client_id);
CREATE INDEX IF NOT EXISTS idx_tickets_client_created ON tickets(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_status         ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_assigned       ON tickets(assigned_to);

-- ─────────────────────────────────────────────
-- TICKET STATUS HISTORY  (append-only → no updated_at, no trigger)
--   One row on creation (from_status = NULL, to_status = 'investigating')
--   and one on every subsequent status change. Current status = latest to_status.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ticket_status_history (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id   UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status   TEXT NOT NULL,
  changed_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ticket_history_ticket  ON ticket_status_history(ticket_id, created_at DESC);

-- ─────────────────────────────────────────────
-- TICKET MESSAGES  (Conversation tab; append-only)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ticket_messages (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id  UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket ON ticket_messages(ticket_id, created_at);

-- ─────────────────────────────────────────────
-- ONBOARDING MILESTONES  (one row per stage per client)
--   8 fixed stages, seeded 'not_started' on client creation. UNIQUE(client_id,
--   stage_key) makes seeding idempotent (ON CONFLICT DO NOTHING).
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS onboarding_milestones (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  stage_key    TEXT NOT NULL
               CHECK (stage_key IN (
                 'account_setup','business_discovery','system_configuration',
                 'crm_integrations','demo_review','testing_qa','go_live',
                 'post_launch_optimization')),
  status       TEXT NOT NULL DEFAULT 'not_started'
               CHECK (status IN ('not_started','in_progress','complete')),
  completed_at TIMESTAMPTZ,
  sort_order   INTEGER NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, stage_key)
);

CREATE INDEX IF NOT EXISTS idx_milestones_client ON onboarding_milestones(client_id, sort_order);

-- ─────────────────────────────────────────────
-- CLIENT ACTION ITEMS  ("Waiting on You")
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_action_items (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','done')),
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_action_items_client ON client_action_items(client_id, status);

-- ─────────────────────────────────────────────
-- CALL RECORDS  (one row per completed Retell call; written by call_analyzed)
--   retell_call_id is UNIQUE → webhook upserts on it (idempotent, dup-safe).
--   client_id resolved from Retell agent_id via clients.retell_agent_id.
--   The three custom booleans come from call_analysis.custom_analysis_data;
--   any not configured on the agent default to false so stats read 0, never break.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS call_records (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id             UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  retell_call_id        TEXT NOT NULL UNIQUE,
  agent_id              TEXT,
  started_at            TIMESTAMPTZ,
  ended_at              TIMESTAMPTZ,
  duration_seconds      INTEGER,
  in_voicemail          BOOLEAN NOT NULL DEFAULT false,
  disconnection_reason  TEXT,
  user_sentiment        TEXT,
  call_successful       BOOLEAN,
  appointment_booked    BOOLEAN NOT NULL DEFAULT false,
  lead_recaptured       BOOLEAN NOT NULL DEFAULT false,
  missed_call_recovered BOOLEAN NOT NULL DEFAULT false,
  raw_analysis          JSONB NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_call_records_client         ON call_records(client_id);
CREATE INDEX IF NOT EXISTS idx_call_records_client_started ON call_records(client_id, started_at DESC);

-- ─────────────────────────────────────────────
-- updated_at triggers (reuse update_updated_at() from 001).
-- Only the mutable tables; history/messages/call_records are append-only.
-- ─────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_tickets_updated_at ON tickets;
CREATE TRIGGER trg_tickets_updated_at
  BEFORE UPDATE ON tickets FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_milestones_updated_at ON onboarding_milestones;
CREATE TRIGGER trg_milestones_updated_at
  BEFORE UPDATE ON onboarding_milestones FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_action_items_updated_at ON client_action_items;
CREATE TRIGGER trg_action_items_updated_at
  BEFORE UPDATE ON client_action_items FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─────────────────────────────────────────────
-- BACKFILL: seed the 8 onboarding milestones for every existing client.
-- New clients get theirs from clientService.create(); this covers rows that
-- already exist. Idempotent via ON CONFLICT.
-- ─────────────────────────────────────────────
INSERT INTO onboarding_milestones (client_id, stage_key, status, sort_order)
SELECT c.id, s.stage_key, 'not_started', s.sort_order
FROM clients c
CROSS JOIN (VALUES
  ('account_setup',             1),
  ('business_discovery',        2),
  ('system_configuration',      3),
  ('crm_integrations',          4),
  ('demo_review',               5),
  ('testing_qa',                6),
  ('go_live',                   7),
  ('post_launch_optimization',  8)
) AS s(stage_key, sort_order)
ON CONFLICT (client_id, stage_key) DO NOTHING;

-- ============================================================
-- ROW LEVEL SECURITY  (defense-in-depth — see header note)
-- ============================================================
ALTER TABLE tickets               ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_messages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_action_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_records          ENABLE ROW LEVEL SECURITY;

-- Resolve the tenant from the request JWT's `client_id` claim (PostgREST sets
-- request.jwt.claims). Returns NULL when unset/blank so the policies deny by
-- default. STABLE: evaluated once per statement. service_role bypasses RLS and
-- never invokes these, so the backend is unaffected.
CREATE OR REPLACE FUNCTION current_jwt_client_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(
    current_setting('request.jwt.claims', true)::jsonb ->> 'client_id',
    ''
  )::uuid;
$$;

-- Tables that carry client_id directly.
DROP POLICY IF EXISTS tenant_isolation ON tickets;
CREATE POLICY tenant_isolation ON tickets
  FOR ALL TO authenticated
  USING      (client_id = current_jwt_client_id())
  WITH CHECK (client_id = current_jwt_client_id());

DROP POLICY IF EXISTS tenant_isolation ON onboarding_milestones;
CREATE POLICY tenant_isolation ON onboarding_milestones
  FOR ALL TO authenticated
  USING      (client_id = current_jwt_client_id())
  WITH CHECK (client_id = current_jwt_client_id());

DROP POLICY IF EXISTS tenant_isolation ON client_action_items;
CREATE POLICY tenant_isolation ON client_action_items
  FOR ALL TO authenticated
  USING      (client_id = current_jwt_client_id())
  WITH CHECK (client_id = current_jwt_client_id());

DROP POLICY IF EXISTS tenant_isolation ON call_records;
CREATE POLICY tenant_isolation ON call_records
  FOR ALL TO authenticated
  USING      (client_id = current_jwt_client_id())
  WITH CHECK (client_id = current_jwt_client_id());

-- Child tables inherit the tenant from their parent ticket.
DROP POLICY IF EXISTS tenant_isolation ON ticket_status_history;
CREATE POLICY tenant_isolation ON ticket_status_history
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM tickets t
    WHERE t.id = ticket_status_history.ticket_id
      AND t.client_id = current_jwt_client_id()))
  WITH CHECK (EXISTS (
    SELECT 1 FROM tickets t
    WHERE t.id = ticket_status_history.ticket_id
      AND t.client_id = current_jwt_client_id()));

DROP POLICY IF EXISTS tenant_isolation ON ticket_messages;
CREATE POLICY tenant_isolation ON ticket_messages
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM tickets t
    WHERE t.id = ticket_messages.ticket_id
      AND t.client_id = current_jwt_client_id()))
  WITH CHECK (EXISTS (
    SELECT 1 FROM tickets t
    WHERE t.id = ticket_messages.ticket_id
      AND t.client_id = current_jwt_client_id()));

-- Keep the Supabase role grants intact for the new objects (mirrors 007 so the
-- backend's service_role never hits "permission denied" on these tables).
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
