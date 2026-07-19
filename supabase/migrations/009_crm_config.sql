-- CRM-specific per-connection settings (e.g. GoHighLevel stageId/calendarId),
-- merged into the adapter config at sync time. The crm-sync worker already
-- read conn.crm_config; this adds the column it expected.
ALTER TABLE crm_connections
  ADD COLUMN IF NOT EXISTS crm_config JSONB NOT NULL DEFAULT '{}';
