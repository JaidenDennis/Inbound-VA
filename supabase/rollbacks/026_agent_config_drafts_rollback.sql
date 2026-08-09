-- ============================================================
-- ROLLBACK for 026_agent_config_drafts.sql
--
-- DESTRUCTIVE, but only of unpublished work: agent_config_drafts holds edits
-- that were composed and never applied. Dropping it discards them silently —
-- published configuration lives in client_settings and is untouched here.
-- Snapshot first if anyone has a review in flight:
--   CREATE TABLE agent_config_drafts_backup AS SELECT * FROM agent_config_drafts;
-- ============================================================

DROP TRIGGER IF EXISTS trg_agent_config_drafts_updated_at ON agent_config_drafts;
DROP INDEX IF EXISTS idx_agent_config_drafts_client;
DROP TABLE IF EXISTS agent_config_drafts;

DELETE FROM schema_migrations WHERE version = '026';
