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
