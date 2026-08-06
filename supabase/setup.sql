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
-- Generated from 20 migrations: 001_initial_schema.sql, 002_rls_policies.sql, 003_seed_roles.sql, 004_multitenant_hardening.sql, 005_retell_provisioning.sql, 006_agent_identity_config.sql, 007_grants.sql, 008_client_dashboard.sql, 009_crm_config.sql, 010_ghl_provisioning.sql, 011_call_sessions.sql, 012_knowledge_tables.sql, 013_waitlist.sql, 014_account_ops.sql, 015_contact_company.sql, 016_rbac_role_families.sql, 017_system_errors.sql, 018_agent_versions.sql, 019_support_ops.sql, 020_reporting.sql
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
-- SOURCE: migrations/015_contact_company.sql
-- ============================================================================

-- Company name on contacts. Inbound voice callers are individuals, but
-- outbound/enriched leads (Clay) are B2B prospects whose company is the
-- primary thing a rep sorts and searches on — and it is the one field the CRM
-- contact record has that we had nowhere to store.
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS company TEXT;

CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company);


-- ============================================================================
-- SOURCE: migrations/016_rbac_role_families.sql
-- ============================================================================

-- ============================================================
-- GRAVVIA ENGAGE – RBAC role families
-- Run order: 016  (NEVER edit earlier migrations)
--
-- Splits roles into two scopes:
--   platform  – Gravvia staff, users.client_id IS NULL
--   client    – tenant users, users.client_id IS NOT NULL
--
-- Also makes the `permissions` table the single source of truth at runtime.
-- Until this migration, backend/src/types/auth.types.ts held a hardcoded
-- ROLE_PERMISSIONS map that was the ONLY thing read at request time, while this
-- table sat unused and had already drifted (tickets:* existed in code, never
-- seeded here). That map is deleted in the same change that ships this file.
--
-- Rollback: supabase/rollbacks/016_rbac_role_families_rollback.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1. Role scope
-- ------------------------------------------------------------
ALTER TABLE roles ADD COLUMN IF NOT EXISTS scope TEXT;

INSERT INTO roles (name, description) VALUES
  ('support_agent',  'Platform staff: support queue, calls, recordings, system logs, agent config'),
  ('analyst',        'Platform staff: read-only across all tenants'),
  ('client_owner',   'Client: owns their account, users, knowledge base and reports'),
  ('client_manager', 'Client: reports, transcripts, tickets, bookings'),
  ('client_viewer',  'Client: reports only')
ON CONFLICT (name) DO NOTHING;

UPDATE roles SET scope = 'platform' WHERE name IN ('super_admin', 'support_agent', 'analyst');
UPDATE roles SET scope = 'client'   WHERE name IN ('client_owner', 'client_manager', 'client_viewer');

-- ------------------------------------------------------------
-- 2. Backfill users onto the new role names
--
-- The old role set (super_admin/admin/agent/viewer) was shared by staff and
-- tenant users, so the same name meant different things depending on client_id.
-- Split on client_id, which is what actually distinguished them.
-- ------------------------------------------------------------
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

UPDATE users SET role = CASE
  WHEN role = 'super_admin' AND client_id IS NULL THEN 'super_admin'
  WHEN role = 'super_admin'                       THEN 'client_owner'
  WHEN role = 'admin'       AND client_id IS NULL THEN 'support_agent'
  WHEN role = 'admin'                             THEN 'client_owner'
  WHEN role = 'agent'       AND client_id IS NULL THEN 'support_agent'
  WHEN role = 'agent'                             THEN 'client_manager'
  WHEN role = 'viewer'      AND client_id IS NULL THEN 'analyst'
  WHEN role = 'viewer'                            THEN 'client_viewer'
  ELSE role
END
WHERE role IN ('super_admin', 'admin', 'agent', 'viewer');

ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (
  role IN ('super_admin', 'support_agent', 'analyst',
           'client_owner', 'client_manager', 'client_viewer')
);

-- Retire the old role rows now that no user references them.
DELETE FROM roles WHERE name IN ('admin', 'agent', 'viewer');

-- ------------------------------------------------------------
-- 3. Reseed permissions
--
-- Full rebuild rather than an incremental patch: the table had drifted from the
-- code it was supposed to mirror, so the only safe state is a known one.
-- ------------------------------------------------------------
DELETE FROM permissions;

-- super_admin — everything in the vocabulary.
INSERT INTO permissions (role_id, permission)
SELECT r.id, p.permission FROM roles r
CROSS JOIN (VALUES
  ('clients:read'), ('clients:write'),
  ('calls:read'), ('calls:write'),
  ('bookings:read'), ('bookings:write'),
  ('crm:read'), ('crm:write'),
  ('analytics:read'),
  ('settings:read'), ('settings:write'),
  ('users:read'), ('users:write'),
  ('tickets:read'), ('tickets:write'), ('tickets:triage'),
  ('transcripts:read'), ('recordings:read'),
  ('knowledge:read'), ('knowledge:write'),
  ('agents:read'), ('agents:write'),
  ('system:read'), ('system:write')
) AS p(permission)
WHERE r.name = 'super_admin';

-- support_agent — operates and troubleshoots every tenant. No users:write and
-- no settings:write: staff accounts and platform settings stay with super_admin.
INSERT INTO permissions (role_id, permission)
SELECT r.id, p.permission FROM roles r
CROSS JOIN (VALUES
  ('clients:read'), ('clients:write'),
  ('calls:read'), ('calls:write'),
  ('bookings:read'), ('bookings:write'),
  ('crm:read'), ('crm:write'),
  ('analytics:read'),
  ('settings:read'),
  ('users:read'),
  ('tickets:read'), ('tickets:write'), ('tickets:triage'),
  ('transcripts:read'), ('recordings:read'),
  ('knowledge:read'), ('knowledge:write'),
  ('agents:read'), ('agents:write'),
  ('system:read'), ('system:write')
) AS p(permission)
WHERE r.name = 'support_agent';

-- analyst — read-only across all tenants. Deliberately no transcripts:read and
-- no recordings:read: cross-tenant caller PII is not needed to read aggregates.
INSERT INTO permissions (role_id, permission)
SELECT r.id, p.permission FROM roles r
CROSS JOIN (VALUES
  ('clients:read'),
  ('calls:read'),
  ('bookings:read'),
  ('crm:read'),
  ('analytics:read'),
  ('settings:read'),
  ('users:read'),
  ('tickets:read'),
  ('knowledge:read'),
  ('agents:read'),
  ('system:read')
) AS p(permission)
WHERE r.name = 'analyst';

-- client_owner — full control of their own tenant. No agents:* (behavior is
-- staff-owned) and no recordings:read (call audio is staff-only).
INSERT INTO permissions (role_id, permission)
SELECT r.id, p.permission FROM roles r
CROSS JOIN (VALUES
  ('clients:read'),
  ('calls:read'),
  ('bookings:read'), ('bookings:write'),
  ('analytics:read'),
  ('settings:read'),
  ('users:read'), ('users:write'),
  ('tickets:read'), ('tickets:write'),
  ('transcripts:read'),
  ('knowledge:read'), ('knowledge:write')
) AS p(permission)
WHERE r.name = 'client_owner';

-- client_manager — day-to-day use, no user administration, no knowledge edits.
INSERT INTO permissions (role_id, permission)
SELECT r.id, p.permission FROM roles r
CROSS JOIN (VALUES
  ('clients:read'),
  ('calls:read'),
  ('bookings:read'), ('bookings:write'),
  ('analytics:read'),
  ('tickets:read'), ('tickets:write'),
  ('transcripts:read'),
  ('knowledge:read')
) AS p(permission)
WHERE r.name = 'client_manager';

-- client_viewer — reports only. Keeps tickets:write so they can still raise a
-- support request; triage stays platform-only.
INSERT INTO permissions (role_id, permission)
SELECT r.id, p.permission FROM roles r
CROSS JOIN (VALUES
  ('clients:read'),
  ('calls:read'),
  ('bookings:read'),
  ('analytics:read'),
  ('tickets:read'), ('tickets:write')
) AS p(permission)
WHERE r.name = 'client_viewer';

-- ------------------------------------------------------------
-- 4. Verification — abort the transaction rather than half-migrate
--
-- A partially applied role migration locks people out of the dashboard with no
-- obvious cause, so every invariant is asserted here while we can still roll back.
-- ------------------------------------------------------------
DO $$
DECLARE
  bad_scope   INTEGER;
  bad_role    INTEGER;
  no_scope    INTEGER;
  no_grants   INTEGER;
BEGIN
  -- Every user's role must exist in roles, with a scope matching their tenancy.
  SELECT COUNT(*) INTO bad_role
  FROM users u LEFT JOIN roles r ON r.name = u.role
  WHERE r.id IS NULL;
  IF bad_role > 0 THEN
    RAISE EXCEPTION 'Migration 016: % user(s) hold a role with no matching roles row', bad_role;
  END IF;

  SELECT COUNT(*) INTO bad_scope
  FROM users u JOIN roles r ON r.name = u.role
  WHERE (u.client_id IS NULL AND r.scope <> 'platform')
     OR (u.client_id IS NOT NULL AND r.scope <> 'client');
  IF bad_scope > 0 THEN
    RAISE EXCEPTION 'Migration 016: % user(s) hold a role in the wrong scope for their client_id', bad_scope;
  END IF;

  SELECT COUNT(*) INTO no_scope FROM roles WHERE scope IS NULL;
  IF no_scope > 0 THEN
    RAISE EXCEPTION 'Migration 016: % role(s) have no scope', no_scope;
  END IF;

  SELECT COUNT(*) INTO no_grants
  FROM roles r LEFT JOIN permissions p ON p.role_id = r.id
  WHERE p.id IS NULL;
  IF no_grants > 0 THEN
    RAISE EXCEPTION 'Migration 016: % role(s) have zero permissions', no_grants;
  END IF;
END $$;

-- Scope is only NOT NULL once every row is known good.
ALTER TABLE roles ALTER COLUMN scope SET NOT NULL;
ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_scope_check;
ALTER TABLE roles ADD CONSTRAINT roles_scope_check CHECK (scope IN ('platform', 'client'));

CREATE INDEX IF NOT EXISTS idx_permissions_role ON permissions(role_id);


-- ============================================================================
-- SOURCE: migrations/017_system_errors.sql
-- ============================================================================

-- ============================================================
-- GRAVVIA ENGAGE – System error capture + unified activity view
-- Run order: 017  (NEVER edit earlier migrations)
--
-- Before this migration nothing recorded runtime faults. failed_jobs captured
-- exhausted queue jobs and crm_sync_logs captured CRM failures, but a 500 from a
-- route, a rejected webhook signature, or an unhandled rejection left no trace
-- anywhere — the process logged a line to stdout and that was it.
--
-- system_errors is the missing writer. system_activity is the single read model
-- the console queries, unioning this table with the four that already existed.
-- ============================================================

CREATE TABLE IF NOT EXISTS system_errors (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source        TEXT NOT NULL CHECK (source IN ('api', 'worker', 'webhook', 'startup')),
  severity      TEXT NOT NULL DEFAULT 'error' CHECK (severity IN ('warn', 'error', 'fatal')),
  -- NULL means platform-wide: the fault had no tenant, or we could not tell.
  client_id     UUID REFERENCES clients(id) ON DELETE SET NULL,
  request_id    TEXT,
  route         TEXT,
  method        TEXT,
  status_code   INTEGER,
  error_name    TEXT NOT NULL DEFAULT 'Error',
  message       TEXT NOT NULL,
  stack         TEXT,
  context       JSONB NOT NULL DEFAULT '{}',
  -- Hash of source + error_name + route + normalized message. Groups one outage
  -- into a single console row instead of thousands of near-identical ones.
  fingerprint   TEXT NOT NULL,
  reviewed_at   TIMESTAMPTZ,
  reviewed_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  ticket_id     UUID REFERENCES tickets(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_errors_occurred    ON system_errors(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_errors_client      ON system_errors(client_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_errors_fingerprint ON system_errors(fingerprint, occurred_at DESC);
-- Partial: the console's default view is "what still needs attention".
CREATE INDEX IF NOT EXISTS idx_system_errors_unreviewed  ON system_errors(occurred_at DESC)
  WHERE reviewed_at IS NULL;

-- Backlink so a fingerprint that already has a ticket attaches to it instead of
-- opening a new one on every recurrence.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS error_fingerprint TEXT;
CREATE INDEX IF NOT EXISTS idx_tickets_error_fingerprint ON tickets(error_fingerprint)
  WHERE error_fingerprint IS NOT NULL;

-- ------------------------------------------------------------
-- Unified read model
--
-- Five sources, one shape. The four pre-existing tables gain no new writes —
-- the console reads them through here, so nothing is duplicated and nothing
-- has to be kept in sync.
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW system_activity AS
  SELECT
    e.id,
    'system_error'::TEXT           AS kind,
    e.source,
    e.severity,
    e.client_id,
    e.occurred_at,
    COALESCE(e.error_name, 'Error') AS title,
    e.message                       AS detail,
    e.fingerprint,
    e.reviewed_at,
    e.id::TEXT                      AS ref_id
  FROM system_errors e

  UNION ALL

  SELECT
    j.id,
    'failed_job'::TEXT,
    'worker'::TEXT,
    CASE WHEN j.status = 'resolved' THEN 'warn' ELSE 'error' END,
    -- failed_jobs predates tenant tagging; most payloads carry clientId, so
    -- recover it when the value actually looks like a UUID.
    CASE
      WHEN j.job_data->>'clientId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN (j.job_data->>'clientId')::UUID
      WHEN j.job_data->>'client_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN (j.job_data->>'client_id')::UUID
    END,
    j.created_at,
    j.queue_name,
    j.error_message,
    NULL::TEXT,
    CASE WHEN j.status = 'resolved' THEN j.updated_at END,
    j.id::TEXT
  FROM failed_jobs j

  UNION ALL

  SELECT
    c.id,
    'crm_sync'::TEXT,
    'worker'::TEXT,
    'error'::TEXT,
    c.client_id,
    c.created_at,
    c.entity_type || ' ' || c.operation,
    COALESCE(c.error_message, 'CRM sync failed'),
    NULL::TEXT,
    NULL::TIMESTAMPTZ,
    c.id::TEXT
  FROM crm_sync_logs c
  WHERE c.status = 'failed'

  UNION ALL

  SELECT
    a.id,
    'automation_run'::TEXT,
    'worker'::TEXT,
    'error'::TEXT,
    a.client_id,
    a.started_at,
    'automation run'::TEXT,
    COALESCE(a.error_message, 'Automation run failed'),
    NULL::TEXT,
    a.completed_at,
    a.id::TEXT
  FROM automation_runs a
  WHERE a.status = 'failed'

  UNION ALL

  SELECT
    v.id,
    'event'::TEXT,
    'webhook'::TEXT,
    'warn'::TEXT,
    v.client_id,
    v.created_at,
    v.event_type,
    COALESCE(v.payload->>'error', v.event_type),
    NULL::TEXT,
    CASE WHEN v.processed THEN v.created_at END,
    v.id::TEXT
  FROM events v
  WHERE v.event_type LIKE '%failed%' OR v.event_type LIKE '%error%';


-- ============================================================================
-- SOURCE: migrations/018_agent_versions.sql
-- ============================================================================

-- ============================================================
-- GRAVVIA ENGAGE – Agent sync state, prompt overrides, version history
-- Run order: 018  (NEVER edit earlier migrations)
--
-- provisionClient() renders the knowledge base into the agent prompt and pushes
-- it to Retell, but until now it only ran on demand. A client editing an FAQ
-- changed the database while the live agent kept answering with the old text.
--
-- These columns make the gap visible and closeable: a knowledge or config write
-- marks the client 'pending', a debounced job re-provisions, and every
-- successful provision snapshots what was actually sent.
-- ============================================================

ALTER TABLE clients ADD COLUMN IF NOT EXISTS agent_sync_state TEXT NOT NULL DEFAULT 'never';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS agent_sync_error TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS agent_sync_requested_at TIMESTAMPTZ;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS agent_synced_at TIMESTAMPTZ;

ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_agent_sync_state_check;
ALTER TABLE clients ADD CONSTRAINT clients_agent_sync_state_check
  CHECK (agent_sync_state IN ('never', 'pending', 'synced', 'failed'));

-- Clients already provisioned are 'synced' — they have an agent live on Retell.
UPDATE clients
SET agent_sync_state = 'synced',
    agent_synced_at = retell_last_provisioned_at
WHERE retell_agent_id IS NOT NULL AND agent_sync_state = 'never';

CREATE INDEX IF NOT EXISTS idx_clients_agent_sync_state ON clients(agent_sync_state)
  WHERE agent_sync_state IN ('pending', 'failed');

-- ------------------------------------------------------------
-- Prompt overrides
--
-- Appended sections keyed by slot, never a wholesale prompt replacement. The
-- per-vertical template stays authoritative, so bespoke wording for one client
-- does not become a branch in source — which the multi-tenant rule forbids.
-- Shape: { "<slot>": "<text>" }
-- ------------------------------------------------------------
ALTER TABLE client_settings ADD COLUMN IF NOT EXISTS prompt_overrides JSONB NOT NULL DEFAULT '{}';

-- ------------------------------------------------------------
-- Version history
--
-- Written only on a SUCCESSFUL provision, so the table is a record of what the
-- agent actually ran with. Answers "what changed on Tuesday" — otherwise
-- unanswerable, because a degraded prompt affects every call silently.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_config_versions (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id             UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  version               INTEGER NOT NULL,
  settings_snapshot     JSONB NOT NULL DEFAULT '{}',
  rendered_prompt       TEXT,
  retell_agent_id       TEXT,
  retell_agent_version  INTEGER,
  vertical              TEXT,
  created_by            UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(client_id, version)
);

CREATE INDEX IF NOT EXISTS idx_agent_versions_client ON agent_config_versions(client_id, version DESC);


-- ============================================================================
-- SOURCE: migrations/019_support_ops.sql
-- ============================================================================

-- ============================================================
-- GRAVVIA ENGAGE – Support operations: internal notes, SLA, auto-tickets
-- Run order: 019  (NEVER edit earlier migrations)
--
-- tickets/ticket_messages/ticket_status_history already exist (008), and 014
-- added contact_id/call_id/source. This migration adds what turns them from a
-- record into a queue: staff-only notes, response clocks, and the columns the
-- auto-ticket bridge in 017 needs.
-- ============================================================

-- ------------------------------------------------------------
-- Internal notes
--
-- Default 'client' is deliberate. Every message written before this migration
-- was visible to the client, so defaulting to 'internal' would retroactively
-- hide history that clients have already read. New writes always pass
-- visibility explicitly — see TicketService.addMessage.
-- ------------------------------------------------------------
ALTER TABLE ticket_messages ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'client';

ALTER TABLE ticket_messages DROP CONSTRAINT IF EXISTS ticket_messages_visibility_check;
ALTER TABLE ticket_messages ADD CONSTRAINT ticket_messages_visibility_check
  CHECK (visibility IN ('client', 'internal'));

-- The client thread query filters on this; a partial index keeps it cheap.
CREATE INDEX IF NOT EXISTS idx_ticket_messages_client_visible
  ON ticket_messages(ticket_id, created_at)
  WHERE visibility = 'client';

-- ------------------------------------------------------------
-- SLA clocks
--
-- Stored rather than computed on read so a priority change re-baselines the
-- deadline once, and the breach sweep is a plain indexed query instead of a
-- full scan with per-row arithmetic.
-- ------------------------------------------------------------
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS first_response_at       TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS resolved_at             TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sla_response_due_at     TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sla_resolution_due_at   TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sla_breached_at         TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS auto_closed_at          TIMESTAMPTZ;

-- Open tickets sorted by how close they are to breaching: the queue's default
-- ordering, so it prioritises itself.
CREATE INDEX IF NOT EXISTS idx_tickets_open_by_due
  ON tickets(sla_response_due_at)
  WHERE status IN ('investigating', 'waiting_on_client', 'waiting_on_third_party');

CREATE INDEX IF NOT EXISTS idx_tickets_assigned ON tickets(assigned_to)
  WHERE assigned_to IS NOT NULL;

-- ------------------------------------------------------------
-- Backfill deadlines for tickets that predate the SLA
--
-- Calendar hours, matching SLA_TARGETS in ticket.service.ts. Existing tickets
-- get a deadline measured from when they were created, so the queue is not
-- split between rows that have a clock and rows that never will.
-- ------------------------------------------------------------
UPDATE tickets SET
  sla_response_due_at = created_at + (CASE priority
    WHEN 'urgent' THEN INTERVAL '1 hour'
    WHEN 'high'   THEN INTERVAL '4 hours'
    WHEN 'normal' THEN INTERVAL '24 hours'
    ELSE               INTERVAL '3 days'
  END),
  sla_resolution_due_at = created_at + (CASE priority
    WHEN 'urgent' THEN INTERVAL '8 hours'
    WHEN 'high'   THEN INTERVAL '24 hours'
    WHEN 'normal' THEN INTERVAL '5 days'
    ELSE               INTERVAL '14 days'
  END)
WHERE sla_response_due_at IS NULL;

-- Tickets already closed should not sit in the queue looking overdue.
UPDATE tickets SET resolved_at = updated_at
WHERE status IN ('resolved', 'closed') AND resolved_at IS NULL;


-- ============================================================================
-- SOURCE: migrations/020_reporting.sql
-- ============================================================================

-- ============================================================
-- GRAVVIA ENGAGE – Client reporting: SQL aggregation + call log view
-- Run order: 020  (NEVER edit earlier migrations)
--
-- Fixes a correctness bug, not just a performance one. getStats() selected raw
-- rows and aggregated them in JavaScript; PostgREST caps responses at 1000 rows
-- by default, so past 1000 calls in the selected period every figure shown to a
-- client was silently wrong and always under-counted. A 30-day range on a busy
-- client already exceeds that.
--
-- All aggregation now happens in Postgres, where there is no row cap.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_call_records_client_started ON call_records(client_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_client_started        ON calls(client_id, started_at DESC);

-- ------------------------------------------------------------
-- Outcome derivation
--
-- Precedence, first match wins. Voicemail is checked BEFORE "question
-- answered": Retell can mark a voicemail call_successful, and the reverse order
-- would file voicemails as answered questions — inflating the number clients
-- care about most.
--
-- "Question answered" is INFERRED, not measured: the schema carries no FAQ-hit
-- signal. It means "the call succeeded and was not any of the above".
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION call_outcome(
  p_appointment_booked BOOLEAN,
  p_lead_recaptured    BOOLEAN,
  p_call_status        TEXT,
  p_in_voicemail       BOOLEAN,
  p_call_successful    BOOLEAN
) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_appointment_booked           THEN 'appointment_booked'
    WHEN p_lead_recaptured              THEN 'lead_captured'
    WHEN p_call_status = 'transferred'  THEN 'transferred'
    WHEN p_in_voicemail                 THEN 'voicemail'
    WHEN p_call_successful              THEN 'question_answered'
    ELSE 'abandoned'
  END;
$$;

-- ------------------------------------------------------------
-- KPI cards
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION report_kpis(
  p_client_id UUID,
  p_from      TIMESTAMPTZ,
  p_to        TIMESTAMPTZ
) RETURNS TABLE (
  calls_answered           BIGINT,
  missed_calls_recovered   BIGINT,
  leads_recaptured         BIGINT,
  appointments_booked      BIGINT,
  avg_call_duration_seconds INTEGER,
  total_calls              BIGINT
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT
    COUNT(*) FILTER (WHERE NOT in_voicemail),
    COUNT(*) FILTER (WHERE missed_call_recovered),
    COUNT(*) FILTER (WHERE lead_recaptured),
    COUNT(*) FILTER (WHERE appointment_booked),
    -- Averaged over answered calls only; voicemails would drag it to nonsense.
    COALESCE(ROUND(AVG(duration_seconds) FILTER (WHERE NOT in_voicemail))::INTEGER, 0),
    COUNT(*)
  FROM call_records
  WHERE client_id = p_client_id
    AND started_at >= p_from
    AND started_at <= p_to;
$$;

-- ------------------------------------------------------------
-- Volume trend
--
-- Bucketed in the CLIENT's timezone. Bucketing in UTC puts a 7pm Monday call
-- into Tuesday for a west-coast client, making the chart wrong at every day
-- boundary — an error nobody reports and everybody notices.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION report_volume(
  p_client_id UUID,
  p_from      TIMESTAMPTZ,
  p_to        TIMESTAMPTZ,
  p_bucket    TEXT DEFAULT 'day'
) RETURNS TABLE (
  bucket    TIMESTAMPTZ,
  answered  BIGINT,
  voicemail BIGINT,
  total     BIGINT
)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE
  v_tz TEXT;
  v_unit TEXT;
BEGIN
  SELECT COALESCE(timezone, 'UTC') INTO v_tz FROM clients WHERE id = p_client_id;
  -- Whitelist rather than interpolating caller input into date_trunc.
  v_unit := CASE WHEN p_bucket = 'week' THEN 'week' ELSE 'day' END;

  RETURN QUERY
  SELECT
    date_trunc(v_unit, r.started_at AT TIME ZONE v_tz) AT TIME ZONE v_tz AS bucket,
    COUNT(*) FILTER (WHERE NOT r.in_voicemail),
    COUNT(*) FILTER (WHERE r.in_voicemail),
    COUNT(*)
  FROM call_records r
  WHERE r.client_id = p_client_id
    AND r.started_at >= p_from
    AND r.started_at <= p_to
  GROUP BY 1
  ORDER BY 1;
END;
$$;

-- ------------------------------------------------------------
-- Outcome breakdown
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION report_outcomes(
  p_client_id UUID,
  p_from      TIMESTAMPTZ,
  p_to        TIMESTAMPTZ
) RETURNS TABLE (
  outcome TEXT,
  count   BIGINT
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT
    call_outcome(r.appointment_booked, r.lead_recaptured, c.status, r.in_voicemail, COALESCE(r.call_successful, FALSE)),
    COUNT(*)
  FROM call_records r
  LEFT JOIN calls c ON c.retell_call_id = r.retell_call_id
  WHERE r.client_id = p_client_id
    AND r.started_at >= p_from
    AND r.started_at <= p_to
  GROUP BY 1
  ORDER BY 2 DESC;
$$;

-- ------------------------------------------------------------
-- Call log
--
-- `calls` and `call_records` are parallel tables both keyed on retell_call_id:
-- `calls` holds the caller number, recording and transcript FK, `call_records`
-- holds the Retell analysis flags. The join hides that seam; no data migration.
--
-- recording_url is deliberately NOT in this view. The client call log selects
-- from here, so a future `SELECT *` on the client path cannot leak call audio.
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW client_call_log AS
  SELECT
    r.id                AS id,
    r.client_id,
    r.retell_call_id,
    c.id                AS call_id,
    c.from_number,
    c.to_number,
    c.direction,
    c.status            AS call_status,
    r.started_at,
    r.ended_at,
    r.duration_seconds,
    r.user_sentiment,
    r.in_voicemail,
    r.appointment_booked,
    r.lead_recaptured,
    r.missed_call_recovered,
    call_outcome(
      r.appointment_booked, r.lead_recaptured, c.status, r.in_voicemail, COALESCE(r.call_successful, FALSE)
    )                   AS outcome,
    (t.id IS NOT NULL)  AS has_transcript
  FROM call_records r
  LEFT JOIN calls c ON c.retell_call_id = r.retell_call_id
  LEFT JOIN call_transcripts t ON t.call_id = c.id;


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
