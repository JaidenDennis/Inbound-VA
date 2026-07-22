-- ============================================================================
-- GRAVVIA ENGAGE — COMPLETE SUPABASE SETUP (single file)
-- ============================================================================
--
--   >>> GENERATED FILE — DO NOT EDIT BY HAND. <<<
--   Source: supabase/migrations/*.sql
--   Regenerate: node supabase/build-setup.mjs
--
-- HOW TO USE
--   Paste this entire file into the Supabase SQL Editor and run it once.
--   It is idempotent — safe to re-run after adding migrations.
--
-- WHAT IT CREATES
--   • Extensions (uuid-ossp, pgcrypto)
--   • All tables, indexes, constraints and updated_at triggers
--   • Row Level Security + tenant-isolation policies
--   • Supabase role grants (service_role needs these or every query 42501s)
--   • The RBAC roles/permissions seed
--
-- WHAT IT DOES *NOT* CREATE
--   • Any admin user. There is no default login and no default password.
--     Create your first super_admin explicitly — see the block at the end.
--   • Any sample/demo client data. See supabase/seed.sql for that (dev only).
--
-- Generated from 14 migrations: 001_initial_schema.sql, 002_rls_policies.sql, 003_seed_roles.sql, 004_multitenant_hardening.sql, 005_retell_provisioning.sql, 006_agent_identity_config.sql, 007_grants.sql, 008_client_dashboard.sql, 009_crm_config.sql, 010_ghl_provisioning.sql, 011_call_sessions.sql, 012_knowledge_tables.sql, 013_waitlist.sql, 014_account_ops.sql
-- ============================================================================


-- ============================================================================
-- SOURCE: migrations/001_initial_schema.sql
-- ============================================================================

-- ============================================================
-- GRAVVIA ENGAGE – Initial Schema Migration
-- Run order: 001
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────────
-- CLIENTS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clients (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  industry        TEXT NOT NULL DEFAULT 'other',
  timezone        TEXT NOT NULL DEFAULT 'America/New_York',
  phone_numbers   TEXT[] NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','suspended')),
  retell_agent_id TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clients_slug ON clients(slug);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);

-- ─────────────────────────────────────────────
-- CLIENT SETTINGS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_settings (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id             UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  agent_prompt          TEXT NOT NULL DEFAULT '',
  agent_personality     TEXT NOT NULL DEFAULT 'professional',
  agent_tone            TEXT NOT NULL DEFAULT 'friendly',
  agent_response_style  TEXT NOT NULL DEFAULT 'concise',
  faqs                  JSONB NOT NULL DEFAULT '[]',
  services              JSONB NOT NULL DEFAULT '[]',
  pricing               JSONB NOT NULL DEFAULT '[]',
  business_policies     TEXT[] NOT NULL DEFAULT '{}',
  booking_enabled       BOOLEAN NOT NULL DEFAULT false,
  booking_rules         JSONB NOT NULL DEFAULT '{}',
  notification_emails   TEXT[] NOT NULL DEFAULT '{}',
  escalation_rules      JSONB NOT NULL DEFAULT '[]',
  crm_type              TEXT NOT NULL DEFAULT 'none',
  crm_config            JSONB NOT NULL DEFAULT '{}',
  custom_field_mapping  JSONB NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(client_id)
);

-- ─────────────────────────────────────────────
-- USERS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('super_admin','admin','agent','viewer')),
  client_id     UUID REFERENCES clients(id) ON DELETE SET NULL,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_client_id ON users(client_id);

-- ─────────────────────────────────────────────
-- ROLES & PERMISSIONS (RBAC lookup)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roles (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS permissions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  role_id     UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(role_id, permission)
);

-- ─────────────────────────────────────────────
-- API KEYS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_keys (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  key_hash     TEXT NOT NULL UNIQUE,
  permissions  TEXT[] NOT NULL DEFAULT '{}',
  last_used_at TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_client ON api_keys(client_id);

-- ─────────────────────────────────────────────
-- CONTACTS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contacts (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id        UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  external_crm_id  TEXT,
  first_name       TEXT NOT NULL DEFAULT '',
  last_name        TEXT NOT NULL DEFAULT '',
  email            TEXT,
  phone            TEXT NOT NULL,
  notes            TEXT,
  tags             TEXT[] NOT NULL DEFAULT '{}',
  custom_fields    JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contacts_client ON contacts(client_id);
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
CREATE INDEX IF NOT EXISTS idx_contacts_crm ON contacts(external_crm_id);

-- ─────────────────────────────────────────────
-- CALLS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS calls (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id        UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  contact_id       UUID REFERENCES contacts(id) ON DELETE SET NULL,
  retell_call_id   TEXT NOT NULL UNIQUE,
  direction        TEXT NOT NULL DEFAULT 'inbound' CHECK (direction IN ('inbound','outbound')),
  from_number      TEXT NOT NULL,
  to_number        TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed','failed','transferred')),
  duration_seconds INTEGER,
  recording_url    TEXT,
  started_at       TIMESTAMPTZ NOT NULL,
  ended_at         TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calls_client ON calls(client_id);
CREATE INDEX IF NOT EXISTS idx_calls_contact ON calls(contact_id);
CREATE INDEX IF NOT EXISTS idx_calls_retell ON calls(retell_call_id);
CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(status);
CREATE INDEX IF NOT EXISTS idx_calls_started ON calls(started_at DESC);

-- ─────────────────────────────────────────────
-- CONVERSATIONS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  call_id           UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  contact_id        UUID REFERENCES contacts(id) ON DELETE SET NULL,
  intent            TEXT,
  sentiment         TEXT,
  lead_captured     BOOLEAN NOT NULL DEFAULT false,
  booking_requested BOOLEAN NOT NULL DEFAULT false,
  handoff_requested BOOLEAN NOT NULL DEFAULT false,
  summary           TEXT,
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_call ON conversations(call_id);
CREATE INDEX IF NOT EXISTS idx_conversations_client ON conversations(client_id);

-- ─────────────────────────────────────────────
-- CALL TRANSCRIPTS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS call_transcripts (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  call_id    UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  client_id  UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  transcript JSONB NOT NULL DEFAULT '[]',
  word_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transcripts_call ON call_transcripts(call_id);
CREATE INDEX IF NOT EXISTS idx_transcripts_client ON call_transcripts(client_id);

-- ─────────────────────────────────────────────
-- CALL SUMMARIES
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS call_summaries (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  call_id             UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  summary             TEXT NOT NULL,
  action_items        TEXT[] NOT NULL DEFAULT '{}',
  key_topics          TEXT[] NOT NULL DEFAULT '{}',
  sentiment           TEXT NOT NULL DEFAULT 'neutral' CHECK (sentiment IN ('positive','neutral','negative')),
  follow_up_required  BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_summaries_call ON call_summaries(call_id);
CREATE INDEX IF NOT EXISTS idx_summaries_client ON call_summaries(client_id);

-- ─────────────────────────────────────────────
-- APPOINTMENTS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS appointments (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id            UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  contact_id           UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  call_id              UUID REFERENCES calls(id) ON DELETE SET NULL,
  external_calendar_id TEXT,
  title                TEXT NOT NULL,
  description          TEXT,
  start_time           TIMESTAMPTZ NOT NULL,
  end_time             TIMESTAMPTZ NOT NULL,
  timezone             TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','cancelled','rescheduled','completed','no_show')),
  service_type         TEXT,
  staff_member_id      UUID,
  notes                TEXT,
  reminder_sent        BOOLEAN NOT NULL DEFAULT false,
  metadata             JSONB NOT NULL DEFAULT '{}',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appointments_client ON appointments(client_id);
CREATE INDEX IF NOT EXISTS idx_appointments_contact ON appointments(contact_id);
CREATE INDEX IF NOT EXISTS idx_appointments_start ON appointments(start_time);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);

-- ─────────────────────────────────────────────
-- CRM CONNECTIONS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_connections (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id             UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  crm_type              TEXT NOT NULL,
  credentials_encrypted TEXT NOT NULL,
  pipeline_id           TEXT,
  stage_mapping         JSONB NOT NULL DEFAULT '{}',
  custom_field_mapping  JSONB NOT NULL DEFAULT '{}',
  is_active             BOOLEAN NOT NULL DEFAULT true,
  last_sync_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(client_id, crm_type)
);

CREATE INDEX IF NOT EXISTS idx_crm_connections_client ON crm_connections(client_id);

-- ─────────────────────────────────────────────
-- CRM SYNC LOGS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_sync_logs (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  crm_connection_id   UUID NOT NULL REFERENCES crm_connections(id) ON DELETE CASCADE,
  entity_type         TEXT NOT NULL,
  entity_id           UUID NOT NULL,
  operation           TEXT NOT NULL CHECK (operation IN ('create','update','delete')),
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('success','failed','pending')),
  external_id         TEXT,
  error_message       TEXT,
  attempts            INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_sync_logs_client ON crm_sync_logs(client_id);
CREATE INDEX IF NOT EXISTS idx_crm_sync_logs_status ON crm_sync_logs(status);
CREATE INDEX IF NOT EXISTS idx_crm_sync_logs_entity ON crm_sync_logs(entity_type, entity_id);

-- ─────────────────────────────────────────────
-- EVENTS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS events (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id        UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  event_type       TEXT NOT NULL,
  source           TEXT NOT NULL,
  payload          JSONB NOT NULL DEFAULT '{}',
  processed        BOOLEAN NOT NULL DEFAULT false,
  idempotency_key  TEXT NOT NULL UNIQUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_client ON events(client_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_processed ON events(processed);
CREATE INDEX IF NOT EXISTS idx_events_idempotency ON events(idempotency_key);

-- ─────────────────────────────────────────────
-- AUTOMATION RULES
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS automation_rules (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id  UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  trigger    TEXT NOT NULL,
  conditions JSONB NOT NULL DEFAULT '[]',
  actions    JSONB NOT NULL DEFAULT '[]',
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_rules_client ON automation_rules(client_id);
CREATE INDEX IF NOT EXISTS idx_automation_rules_trigger ON automation_rules(trigger);

-- ─────────────────────────────────────────────
-- AUTOMATION RUNS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS automation_runs (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rule_id          UUID NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
  client_id        UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  trigger_event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed')),
  result           JSONB,
  error_message    TEXT,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_automation_runs_rule ON automation_runs(rule_id);
CREATE INDEX IF NOT EXISTS idx_automation_runs_client ON automation_runs(client_id);

-- ─────────────────────────────────────────────
-- FAILED JOBS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS failed_jobs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  queue_name    TEXT NOT NULL,
  job_id        TEXT NOT NULL,
  job_data      JSONB NOT NULL DEFAULT '{}',
  error_message TEXT NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'failed' CHECK (status IN ('failed','manual_review','resolved')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_failed_jobs_status ON failed_jobs(status);
CREATE INDEX IF NOT EXISTS idx_failed_jobs_queue ON failed_jobs(queue_name);

-- ─────────────────────────────────────────────
-- STAFF NOTIFICATIONS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff_notifications (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id        UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  call_id          UUID REFERENCES calls(id) ON DELETE SET NULL,
  type             TEXT NOT NULL CHECK (type IN ('handoff','lead','booking','escalation')),
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','connected','missed','resolved')),
  message          TEXT NOT NULL,
  recipient_email  TEXT,
  metadata         JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_notifications_client ON staff_notifications(client_id);
CREATE INDEX IF NOT EXISTS idx_staff_notifications_status ON staff_notifications(status);

-- ─────────────────────────────────────────────
-- AUDIT LOGS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  client_id   UUID REFERENCES clients(id) ON DELETE CASCADE,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   UUID,
  old_value   JSONB,
  new_value   JSONB,
  ip_address  INET,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_client ON audit_logs(client_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);

-- ─────────────────────────────────────────────
-- AUTO-UPDATE updated_at triggers
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_clients_updated_at ON clients;
CREATE TRIGGER trg_clients_updated_at
  BEFORE UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_client_settings_updated_at ON client_settings;
CREATE TRIGGER trg_client_settings_updated_at
  BEFORE UPDATE ON client_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_contacts_updated_at ON contacts;
CREATE TRIGGER trg_contacts_updated_at
  BEFORE UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_calls_updated_at ON calls;
CREATE TRIGGER trg_calls_updated_at
  BEFORE UPDATE ON calls FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_conversations_updated_at ON conversations;
CREATE TRIGGER trg_conversations_updated_at
  BEFORE UPDATE ON conversations FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_appointments_updated_at ON appointments;
CREATE TRIGGER trg_appointments_updated_at
  BEFORE UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_crm_connections_updated_at ON crm_connections;
CREATE TRIGGER trg_crm_connections_updated_at
  BEFORE UPDATE ON crm_connections FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_crm_sync_logs_updated_at ON crm_sync_logs;
CREATE TRIGGER trg_crm_sync_logs_updated_at
  BEFORE UPDATE ON crm_sync_logs FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_automation_rules_updated_at ON automation_rules;
CREATE TRIGGER trg_automation_rules_updated_at
  BEFORE UPDATE ON automation_rules FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_failed_jobs_updated_at ON failed_jobs;
CREATE TRIGGER trg_failed_jobs_updated_at
  BEFORE UPDATE ON failed_jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================================
-- SOURCE: migrations/002_rls_policies.sql
-- ============================================================================

-- ============================================================
-- GRAVVIA ENGAGE – Row Level Security Policies
-- Run order: 002
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_sync_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE failed_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Service role bypasses all RLS (used by backend server)
-- No policies needed for service_role — it always bypasses RLS.
-- Anon / authenticated policies are intentionally restrictive.

-- Only service_role can access these tables directly.
-- All access goes through the backend which uses service_role.


-- ============================================================================
-- SOURCE: migrations/003_seed_roles.sql
-- ============================================================================

-- ============================================================
-- GRAVVIA ENGAGE – Seed default roles
-- Run order: 003
-- ============================================================

INSERT INTO roles (name, description) VALUES
  ('super_admin', 'Full platform access'),
  ('admin', 'Client admin with full client access'),
  ('agent', 'Operational agent with limited write access'),
  ('viewer', 'Read-only access')
ON CONFLICT (name) DO NOTHING;

-- Seed permissions for super_admin
INSERT INTO permissions (role_id, permission)
SELECT r.id, p.permission FROM roles r
CROSS JOIN (VALUES
  ('clients:read'), ('clients:write'),
  ('calls:read'), ('calls:write'),
  ('bookings:read'), ('bookings:write'),
  ('crm:read'), ('crm:write'),
  ('analytics:read'),
  ('settings:read'), ('settings:write'),
  ('users:read'), ('users:write')
) AS p(permission)
WHERE r.name = 'super_admin'
ON CONFLICT (role_id, permission) DO NOTHING;

-- admin
INSERT INTO permissions (role_id, permission)
SELECT r.id, p.permission FROM roles r
CROSS JOIN (VALUES
  ('clients:read'), ('clients:write'),
  ('calls:read'), ('calls:write'),
  ('bookings:read'), ('bookings:write'),
  ('crm:read'), ('crm:write'),
  ('analytics:read'),
  ('settings:read'), ('settings:write'),
  ('users:read')
) AS p(permission)
WHERE r.name = 'admin'
ON CONFLICT (role_id, permission) DO NOTHING;

-- agent
INSERT INTO permissions (role_id, permission)
SELECT r.id, p.permission FROM roles r
CROSS JOIN (VALUES
  ('clients:read'),
  ('calls:read'),
  ('bookings:read'), ('bookings:write'),
  ('crm:read'),
  ('analytics:read')
) AS p(permission)
WHERE r.name = 'agent'
ON CONFLICT (role_id, permission) DO NOTHING;

-- viewer
INSERT INTO permissions (role_id, permission)
SELECT r.id, p.permission FROM roles r
CROSS JOIN (VALUES
  ('clients:read'),
  ('calls:read'),
  ('bookings:read'),
  ('analytics:read')
) AS p(permission)
WHERE r.name = 'viewer'
ON CONFLICT (role_id, permission) DO NOTHING;


-- ============================================================================
-- SOURCE: migrations/004_multitenant_hardening.sql
-- ============================================================================

-- ============================================================
-- GRAVVIA ENGAGE – Multi-tenant hardening
-- Run order: 004
-- Adds constraints relied on by the application code after the
-- multi-tenant / production-readiness fixes.
-- ============================================================

-- 1. De-duplicate CRM sync logs so retries UPDATE one row instead of
--    inserting a new row each attempt. The crm-sync worker upserts on
--    (client_id, entity_type, entity_id, operation).
--    Clean up any pre-existing duplicates first, keeping the newest row.
DELETE FROM crm_sync_logs a
USING crm_sync_logs b
WHERE a.ctid < b.ctid
  AND a.client_id = b.client_id
  AND a.entity_type = b.entity_type
  AND a.entity_id = b.entity_id
  AND a.operation = b.operation;

ALTER TABLE crm_sync_logs
  DROP CONSTRAINT IF EXISTS uq_crm_sync_entity;
ALTER TABLE crm_sync_logs
  ADD CONSTRAINT uq_crm_sync_entity
  UNIQUE (client_id, entity_type, entity_id, operation);

-- 2. Prevent the same Retell agent from mapping to two clients
--    (webhook tenant resolution must be unambiguous).
CREATE UNIQUE INDEX IF NOT EXISTS uq_clients_retell_agent
  ON clients(retell_agent_id) WHERE retell_agent_id IS NOT NULL;

-- 3. OPTIONAL: per-client Retell webhook secret. Only needed if clients use
--    SEPARATE Retell accounts. Safe to leave NULL when all clients share one
--    Retell workspace (the global RETELL_WEBHOOK_SECRET env var is used then).
ALTER TABLE clients ADD COLUMN IF NOT EXISTS retell_webhook_secret TEXT;


-- ============================================================================
-- SOURCE: migrations/005_retell_provisioning.sql
-- ============================================================================

-- ============================================================
-- GRAVVIA ENGAGE – Retell per-client agent provisioning
-- Run order: 005  (NEVER edit earlier migrations)
-- Adds columns needed to idempotently create/UPDATE a client's Retell agent.
-- clients.retell_agent_id already exists (001); these store the linked
-- Response Engine (Retell LLM), chosen voice, and provisioning metadata.
-- ============================================================

ALTER TABLE clients ADD COLUMN IF NOT EXISTS retell_llm_id          TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS retell_voice_id        TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS retell_agent_version   INTEGER;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS retell_last_provisioned_at TIMESTAMPTZ;

-- Map a phone number to its agent (one row per number). Optional convenience
-- table; clients.phone_numbers remains the source of truth for routing.
CREATE TABLE IF NOT EXISTS retell_phone_numbers (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id          UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  phone_number       TEXT NOT NULL UNIQUE,
  retell_agent_id    TEXT,
  provider           TEXT NOT NULL DEFAULT 'retell',   -- retell | imported
  purchased          BOOLEAN NOT NULL DEFAULT false,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_retell_phone_numbers_client ON retell_phone_numbers(client_id);

ALTER TABLE retell_phone_numbers ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_retell_phone_numbers_updated_at ON retell_phone_numbers;
CREATE TRIGGER trg_retell_phone_numbers_updated_at
  BEFORE UPDATE ON retell_phone_numbers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================================
-- SOURCE: migrations/006_agent_identity_config.sql
-- ============================================================================

-- ============================================================
-- GRAVVIA ENGAGE – Per-client agent identity & offerings config
-- Run order: 006  (NEVER edit earlier migrations)
-- Adds business_name / agent_name (so the agent never speaks a raw
-- {{variable}} — values are rendered into the prompt at provisioning) and a
-- flexible agent_config for vertical offerings (membership, packages, etc.)
-- that drive upsell decisions without hardcoding any client into the template.
-- ============================================================

ALTER TABLE client_settings ADD COLUMN IF NOT EXISTS business_name TEXT;
ALTER TABLE client_settings ADD COLUMN IF NOT EXISTS agent_name    TEXT;
ALTER TABLE client_settings ADD COLUMN IF NOT EXISTS agent_config  JSONB NOT NULL DEFAULT '{}';


-- ============================================================================
-- SOURCE: migrations/007_grants.sql
-- ============================================================================

-- ============================================================
-- GRAVVIA ENGAGE – Restore Supabase role grants on the public schema
-- Run order: 007  (NEVER edit earlier migrations)
--
-- WHY: the backend connects with the Supabase `service_role` key (god-mode,
-- bypasses RLS). If the public tables were created without the default Supabase
-- grants, `service_role` gets "permission denied for table ..." (SQLSTATE 42501)
-- on every query. Services that swallow the error (e.g. clientService.findById)
-- then surface it as a misleading "Client not found".
--
-- This grants `service_role` full DML on all current + future objects, and the
-- usual USAGE to anon/authenticated. Idempotent and safe to re-run.
-- ============================================================

-- Schema usage for the standard Supabase roles.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Full access for the backend's service_role on everything that exists now.
GRANT ALL ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- And on everything created later (so new migrations don't reintroduce the bug).
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


-- ============================================================================
-- SOURCE: migrations/008_client_dashboard.sql
-- ============================================================================

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


-- ============================================================================
-- SOURCE: migrations/009_crm_config.sql
-- ============================================================================

-- CRM-specific per-connection settings (e.g. GoHighLevel stageId/calendarId),
-- merged into the adapter config at sync time. The crm-sync worker already
-- read conn.crm_config; this adds the column it expected.
ALTER TABLE crm_connections
  ADD COLUMN IF NOT EXISTS crm_config JSONB NOT NULL DEFAULT '{}';


-- ============================================================================
-- SOURCE: migrations/010_ghl_provisioning.sql
-- ============================================================================

-- ─────────────────────────────────────────────
-- 010: GHL BLUEPRINT PROVISIONING
-- Provision runs are recorded in crm_sync_logs: one row per run with
-- entity_type='provision_run', entity_id=runId (UUID), operation='provision',
-- and per-step detail in payload. The existing UNIQUE
-- (client_id, entity_type, entity_id, operation) keeps upserts on one row.
-- ─────────────────────────────────────────────

-- Widen the inline CHECKs from 001 (Postgres autogenerates
-- <table>_<column>_check names for inline column CHECK constraints).
ALTER TABLE crm_sync_logs DROP CONSTRAINT IF EXISTS crm_sync_logs_operation_check;
ALTER TABLE crm_sync_logs ADD CONSTRAINT crm_sync_logs_operation_check
  CHECK (operation IN ('create','update','delete','provision'));

ALTER TABLE crm_sync_logs DROP CONSTRAINT IF EXISTS crm_sync_logs_status_check;
ALTER TABLE crm_sync_logs ADD CONSTRAINT crm_sync_logs_status_check
  CHECK (status IN ('success','failed','pending','manual_review'));

-- Per-step run detail: { blueprintName, steps: [{ step, status, ... }] }
ALTER TABLE crm_sync_logs ADD COLUMN IF NOT EXISTS payload JSONB;

-- The provision route guards against concurrent runs per connection.
CREATE INDEX IF NOT EXISTS idx_crm_sync_logs_connection
  ON crm_sync_logs(crm_connection_id);

-- 401 from the CRM means the OAuth install must be re-run. Surfaced in the
-- dashboard status endpoint; cleared by a successful OAuth callback.
ALTER TABLE crm_connections ADD COLUMN IF NOT EXISTS needs_reauth BOOLEAN NOT NULL DEFAULT false;

-- Per-client blueprint override; NULL falls back to a shipped default.
ALTER TABLE client_settings ADD COLUMN IF NOT EXISTS ghl_blueprint JSONB;


-- ============================================================================
-- SOURCE: migrations/011_call_sessions.sql
-- ============================================================================

-- ============================================================
-- GRAVVIA ENGAGE – Inbound workflow call sessions
-- Run order: 011  (NEVER edit earlier migrations)
--
-- One row per live call holding the deterministic workflow session state
-- (active workflow + state, workflow stack, collected slots, granted scopes,
-- identity verification, global conversation context). The backend — never the
-- LLM — is the source of truth for where a conversation is; every Retell tool
-- webhook is stateless, so this row is what makes calls resume deterministically.
--
-- Keyed by retell_call_id (what every tool invocation carries) so a session can
-- be opened even if the call_started webhook was missed — the same resilience
-- posture as call_records.recordFromAnalyzed. calls(id) is linked when known.
--
-- Additive only: no existing table or column is modified.
-- ============================================================

CREATE TABLE IF NOT EXISTS call_sessions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  call_id         UUID REFERENCES calls(id) ON DELETE SET NULL,
  retell_call_id  TEXT NOT NULL UNIQUE,
  state           JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_call_sessions_client ON call_sessions(client_id);
CREATE INDEX IF NOT EXISTS idx_call_sessions_retell ON call_sessions(retell_call_id);

-- updated_at trigger (reuses update_updated_at() from 001).
DROP TRIGGER IF EXISTS trg_call_sessions_updated_at ON call_sessions;
CREATE TRIGGER trg_call_sessions_updated_at
  BEFORE UPDATE ON call_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS: same defense-in-depth posture as every other table (see 008 header).
-- The backend uses service_role (bypasses RLS); tenant isolation is enforced in
-- application code. Policies scope by the client_id JWT claim for any future
-- PostgREST/authenticated access.
ALTER TABLE call_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS call_sessions_tenant_select ON call_sessions;
CREATE POLICY call_sessions_tenant_select ON call_sessions
  FOR SELECT TO authenticated
  USING (client_id::text = COALESCE(auth.jwt() ->> 'client_id', ''));


-- ============================================================================
-- SOURCE: migrations/012_knowledge_tables.sql
-- ============================================================================

-- ============================================================
-- GRAVVIA ENGAGE – Relational knowledge tables (inbound Phase 2)
-- Run order: 012  (NEVER edit earlier migrations)
--
-- services / pricing / faqs / promotions become first-class rows so
-- knowledge.search can query them and the dashboard can CRUD them per client.
--
-- ADDITIVE ONLY: the existing client_settings JSONB columns (services,
-- pricing, faqs) are locked and untouched. The backend reads RELATIONAL-FIRST
-- with JSONB FALLBACK, so existing clients keep working with no data
-- migration; rows here take precedence once created.
-- ============================================================

CREATE TABLE IF NOT EXISTS services (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id        UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  price            NUMERIC(10,2),
  category         TEXT,
  active           BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(client_id, name)
);

CREATE INDEX IF NOT EXISTS idx_services_client        ON services(client_id);
CREATE INDEX IF NOT EXISTS idx_services_client_active ON services(client_id, active);

CREATE TABLE IF NOT EXISTS pricing (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  service_id    UUID REFERENCES services(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  price         NUMERIC(10,2) NOT NULL,
  member_price  NUMERIC(10,2),
  unit          TEXT,
  notes         TEXT,
  upsell_note   TEXT,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pricing_client        ON pricing(client_id);
CREATE INDEX IF NOT EXISTS idx_pricing_client_active ON pricing(client_id, active);
CREATE INDEX IF NOT EXISTS idx_pricing_service       ON pricing(service_id);

CREATE TABLE IF NOT EXISTS faqs (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id  UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  question   TEXT NOT NULL,
  answer     TEXT NOT NULL,
  category   TEXT,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_faqs_client        ON faqs(client_id);
CREATE INDEX IF NOT EXISTS idx_faqs_client_active ON faqs(client_id, active);

CREATE TABLE IF NOT EXISTS promotions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  eligibility TEXT,
  starts_at   TIMESTAMPTZ,
  ends_at     TIMESTAMPTZ,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_promotions_client        ON promotions(client_id);
CREATE INDEX IF NOT EXISTS idx_promotions_client_active ON promotions(client_id, active);

-- updated_at triggers (reuse update_updated_at() from 001).
DROP TRIGGER IF EXISTS trg_services_updated_at ON services;
CREATE TRIGGER trg_services_updated_at
  BEFORE UPDATE ON services FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_pricing_updated_at ON pricing;
CREATE TRIGGER trg_pricing_updated_at
  BEFORE UPDATE ON pricing FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_faqs_updated_at ON faqs;
CREATE TRIGGER trg_faqs_updated_at
  BEFORE UPDATE ON faqs FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_promotions_updated_at ON promotions;
CREATE TRIGGER trg_promotions_updated_at
  BEFORE UPDATE ON promotions FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS: same defense-in-depth posture as other tables (see 008 header).
ALTER TABLE services   ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing    ENABLE ROW LEVEL SECURITY;
ALTER TABLE faqs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS services_tenant_select ON services;
CREATE POLICY services_tenant_select ON services
  FOR SELECT TO authenticated
  USING (client_id::text = COALESCE(auth.jwt() ->> 'client_id', ''));
DROP POLICY IF EXISTS pricing_tenant_select ON pricing;
CREATE POLICY pricing_tenant_select ON pricing
  FOR SELECT TO authenticated
  USING (client_id::text = COALESCE(auth.jwt() ->> 'client_id', ''));
DROP POLICY IF EXISTS faqs_tenant_select ON faqs;
CREATE POLICY faqs_tenant_select ON faqs
  FOR SELECT TO authenticated
  USING (client_id::text = COALESCE(auth.jwt() ->> 'client_id', ''));
DROP POLICY IF EXISTS promotions_tenant_select ON promotions;
CREATE POLICY promotions_tenant_select ON promotions
  FOR SELECT TO authenticated
  USING (client_id::text = COALESCE(auth.jwt() ->> 'client_id', ''));


-- ============================================================================
-- SOURCE: migrations/013_waitlist.sql
-- ============================================================================

-- ============================================================
-- GRAVVIA ENGAGE – Waitlist entries (inbound Phase 3)
-- Run order: 013  (NEVER edit earlier migrations)
--
-- Callers who want a slot that isn't available join the waitlist; automation
-- notifies staff (and later the caller) when an opening appears. Additive only.
-- ============================================================

CREATE TABLE IF NOT EXISTS waitlist_entries (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  contact_id      UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  call_id         UUID REFERENCES calls(id) ON DELETE SET NULL,
  service         TEXT,
  preferred_days  TEXT[] NOT NULL DEFAULT '{}',
  preferred_times TEXT,
  notes           TEXT,
  status          TEXT NOT NULL DEFAULT 'waiting'
                  CHECK (status IN ('waiting','notified','booked','cancelled')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_waitlist_client        ON waitlist_entries(client_id);
CREATE INDEX IF NOT EXISTS idx_waitlist_client_status ON waitlist_entries(client_id, status);
CREATE INDEX IF NOT EXISTS idx_waitlist_contact       ON waitlist_entries(contact_id);

DROP TRIGGER IF EXISTS trg_waitlist_entries_updated_at ON waitlist_entries;
CREATE TRIGGER trg_waitlist_entries_updated_at
  BEFORE UPDATE ON waitlist_entries FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS: same defense-in-depth posture as other tables (see 008 header).
ALTER TABLE waitlist_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS waitlist_tenant_select ON waitlist_entries;
CREATE POLICY waitlist_tenant_select ON waitlist_entries
  FOR SELECT TO authenticated
  USING (client_id::text = COALESCE(auth.jwt() ->> 'client_id', ''));


-- ============================================================================
-- SOURCE: migrations/014_account_ops.sql
-- ============================================================================

-- ============================================================
-- GRAVVIA ENGAGE – Account & Ops (inbound Phase 5)
-- Run order: 014  (NEVER edit earlier migrations)
--
-- 1. callback_requests: dedicated lifecycle table for caller callback requests
--    (schedule_callback also keeps writing a staff_notifications alert; this
--    table is the trackable record with a status lifecycle).
-- 2. tickets: additive columns so a CALLER complaint can be stored on the same
--    table the dashboard uses. created_by is already nullable (users FK,
--    ON DELETE SET NULL); a caller-created ticket leaves it NULL and records
--    the contact/call/source instead.
--
-- Additive only. No existing column is modified or repurposed.
-- ============================================================

CREATE TABLE IF NOT EXISTS callback_requests (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id      UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  contact_id     UUID REFERENCES contacts(id) ON DELETE SET NULL,
  call_id        UUID REFERENCES calls(id) ON DELETE SET NULL,
  caller_name    TEXT NOT NULL,
  phone          TEXT NOT NULL,
  preferred_time TEXT,
  reason         TEXT,
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','in_progress','completed','cancelled')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_callback_requests_client        ON callback_requests(client_id);
CREATE INDEX IF NOT EXISTS idx_callback_requests_client_status ON callback_requests(client_id, status);
CREATE INDEX IF NOT EXISTS idx_callback_requests_contact       ON callback_requests(contact_id);

DROP TRIGGER IF EXISTS trg_callback_requests_updated_at ON callback_requests;
CREATE TRIGGER trg_callback_requests_updated_at
  BEFORE UPDATE ON callback_requests FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE callback_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS callback_requests_tenant_select ON callback_requests;
CREATE POLICY callback_requests_tenant_select ON callback_requests
  FOR SELECT TO authenticated
  USING (client_id::text = COALESCE(auth.jwt() ->> 'client_id', ''));

-- Tickets: caller-complaint provenance (additive columns).
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS call_id    UUID REFERENCES calls(id) ON DELETE SET NULL;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS source     TEXT NOT NULL DEFAULT 'dashboard';

CREATE INDEX IF NOT EXISTS idx_tickets_contact ON tickets(contact_id);
CREATE INDEX IF NOT EXISTS idx_tickets_source  ON tickets(source);


-- ============================================================================
-- BOOTSTRAP YOUR FIRST SUPER ADMIN
-- ----------------------------------------------------------------------------
-- Deliberately NOT automatic. A shipped default admin password is the single
-- most common way a launched SaaS gets taken over on day one.
--
-- To create your login: replace BOTH placeholders below, uncomment the block,
-- and run it. The password is hashed with pgcrypto's bcrypt, which is the same
-- algorithm bcryptjs verifies against in the API — so the hash is portable.
--
-- Use a password manager. Minimum 16 characters.
-- ============================================================================

-- INSERT INTO users (email, name, password_hash, role, is_active)
-- VALUES (
--   'you@yourdomain.com',                        -- << your email
--   'Your Name',                                 -- << your name
--   crypt('REPLACE_WITH_A_STRONG_PASSWORD', gen_salt('bf', 12)),
--   'super_admin',
--   true
-- )
-- ON CONFLICT (email) DO NOTHING;

-- ============================================================================
-- VERIFY THE INSTALL
-- ----------------------------------------------------------------------------
-- Expect 27 rows. A lower count means the script did not finish — scroll up in
-- the SQL Editor output for the first error and fix that before deploying.
-- ============================================================================

SELECT count(*) AS tables_created
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
