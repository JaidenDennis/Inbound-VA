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
CREATE TABLE clients (
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

CREATE INDEX idx_clients_slug ON clients(slug);
CREATE INDEX idx_clients_status ON clients(status);

-- ─────────────────────────────────────────────
-- CLIENT SETTINGS
-- ─────────────────────────────────────────────
CREATE TABLE client_settings (
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
CREATE TABLE users (
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

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_client_id ON users(client_id);

-- ─────────────────────────────────────────────
-- ROLES & PERMISSIONS (RBAC lookup)
-- ─────────────────────────────────────────────
CREATE TABLE roles (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE permissions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  role_id     UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(role_id, permission)
);

-- ─────────────────────────────────────────────
-- API KEYS
-- ─────────────────────────────────────────────
CREATE TABLE api_keys (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  key_hash     TEXT NOT NULL UNIQUE,
  permissions  TEXT[] NOT NULL DEFAULT '{}',
  last_used_at TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_client ON api_keys(client_id);

-- ─────────────────────────────────────────────
-- CONTACTS
-- ─────────────────────────────────────────────
CREATE TABLE contacts (
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

CREATE INDEX idx_contacts_client ON contacts(client_id);
CREATE INDEX idx_contacts_phone ON contacts(phone);
CREATE INDEX idx_contacts_email ON contacts(email);
CREATE INDEX idx_contacts_crm ON contacts(external_crm_id);

-- ─────────────────────────────────────────────
-- CALLS
-- ─────────────────────────────────────────────
CREATE TABLE calls (
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

CREATE INDEX idx_calls_client ON calls(client_id);
CREATE INDEX idx_calls_contact ON calls(contact_id);
CREATE INDEX idx_calls_retell ON calls(retell_call_id);
CREATE INDEX idx_calls_status ON calls(status);
CREATE INDEX idx_calls_started ON calls(started_at DESC);

-- ─────────────────────────────────────────────
-- CONVERSATIONS
-- ─────────────────────────────────────────────
CREATE TABLE conversations (
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

CREATE INDEX idx_conversations_call ON conversations(call_id);
CREATE INDEX idx_conversations_client ON conversations(client_id);

-- ─────────────────────────────────────────────
-- CALL TRANSCRIPTS
-- ─────────────────────────────────────────────
CREATE TABLE call_transcripts (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  call_id    UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  client_id  UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  transcript JSONB NOT NULL DEFAULT '[]',
  word_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_transcripts_call ON call_transcripts(call_id);
CREATE INDEX idx_transcripts_client ON call_transcripts(client_id);

-- ─────────────────────────────────────────────
-- CALL SUMMARIES
-- ─────────────────────────────────────────────
CREATE TABLE call_summaries (
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

CREATE INDEX idx_summaries_call ON call_summaries(call_id);
CREATE INDEX idx_summaries_client ON call_summaries(client_id);

-- ─────────────────────────────────────────────
-- APPOINTMENTS
-- ─────────────────────────────────────────────
CREATE TABLE appointments (
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

CREATE INDEX idx_appointments_client ON appointments(client_id);
CREATE INDEX idx_appointments_contact ON appointments(contact_id);
CREATE INDEX idx_appointments_start ON appointments(start_time);
CREATE INDEX idx_appointments_status ON appointments(status);

-- ─────────────────────────────────────────────
-- CRM CONNECTIONS
-- ─────────────────────────────────────────────
CREATE TABLE crm_connections (
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

CREATE INDEX idx_crm_connections_client ON crm_connections(client_id);

-- ─────────────────────────────────────────────
-- CRM SYNC LOGS
-- ─────────────────────────────────────────────
CREATE TABLE crm_sync_logs (
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

CREATE INDEX idx_crm_sync_logs_client ON crm_sync_logs(client_id);
CREATE INDEX idx_crm_sync_logs_status ON crm_sync_logs(status);
CREATE INDEX idx_crm_sync_logs_entity ON crm_sync_logs(entity_type, entity_id);

-- ─────────────────────────────────────────────
-- EVENTS
-- ─────────────────────────────────────────────
CREATE TABLE events (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id        UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  event_type       TEXT NOT NULL,
  source           TEXT NOT NULL,
  payload          JSONB NOT NULL DEFAULT '{}',
  processed        BOOLEAN NOT NULL DEFAULT false,
  idempotency_key  TEXT NOT NULL UNIQUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_events_client ON events(client_id);
CREATE INDEX idx_events_type ON events(event_type);
CREATE INDEX idx_events_processed ON events(processed);
CREATE INDEX idx_events_idempotency ON events(idempotency_key);

-- ─────────────────────────────────────────────
-- AUTOMATION RULES
-- ─────────────────────────────────────────────
CREATE TABLE automation_rules (
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

CREATE INDEX idx_automation_rules_client ON automation_rules(client_id);
CREATE INDEX idx_automation_rules_trigger ON automation_rules(trigger);

-- ─────────────────────────────────────────────
-- AUTOMATION RUNS
-- ─────────────────────────────────────────────
CREATE TABLE automation_runs (
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

CREATE INDEX idx_automation_runs_rule ON automation_runs(rule_id);
CREATE INDEX idx_automation_runs_client ON automation_runs(client_id);

-- ─────────────────────────────────────────────
-- FAILED JOBS
-- ─────────────────────────────────────────────
CREATE TABLE failed_jobs (
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

CREATE INDEX idx_failed_jobs_status ON failed_jobs(status);
CREATE INDEX idx_failed_jobs_queue ON failed_jobs(queue_name);

-- ─────────────────────────────────────────────
-- STAFF NOTIFICATIONS
-- ─────────────────────────────────────────────
CREATE TABLE staff_notifications (
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

CREATE INDEX idx_staff_notifications_client ON staff_notifications(client_id);
CREATE INDEX idx_staff_notifications_status ON staff_notifications(status);

-- ─────────────────────────────────────────────
-- AUDIT LOGS
-- ─────────────────────────────────────────────
CREATE TABLE audit_logs (
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

CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_client ON audit_logs(client_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at DESC);

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

CREATE TRIGGER trg_clients_updated_at
  BEFORE UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_client_settings_updated_at
  BEFORE UPDATE ON client_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_contacts_updated_at
  BEFORE UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_calls_updated_at
  BEFORE UPDATE ON calls FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_conversations_updated_at
  BEFORE UPDATE ON conversations FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_appointments_updated_at
  BEFORE UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_crm_connections_updated_at
  BEFORE UPDATE ON crm_connections FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_crm_sync_logs_updated_at
  BEFORE UPDATE ON crm_sync_logs FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_automation_rules_updated_at
  BEFORE UPDATE ON automation_rules FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_failed_jobs_updated_at
  BEFORE UPDATE ON failed_jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at();
