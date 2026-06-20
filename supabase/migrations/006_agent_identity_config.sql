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
