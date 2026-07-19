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
