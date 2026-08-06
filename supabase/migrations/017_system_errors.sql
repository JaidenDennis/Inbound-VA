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
