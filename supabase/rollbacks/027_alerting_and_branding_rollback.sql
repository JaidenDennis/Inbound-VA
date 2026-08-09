-- ============================================================
-- ROLLBACK for 027_alerting_and_branding.sql
--
-- The two halves are independent — run only the section you need.
--
-- DESTRUCTIVE: client_alert_rules holds every threshold a tenant configured,
-- and client_alert_events is the record of what was sent to whom. Dropping them
-- loses both, and there is no way to reconstruct either. Snapshot first:
--   CREATE TABLE client_alert_rules_backup  AS SELECT * FROM client_alert_rules;
--   CREATE TABLE client_alert_events_backup AS SELECT * FROM client_alert_events;
--
-- clients.branding is left in place by default. Dropping a column is not
-- reversible and the column is inert when nothing reads it — uncomment the
-- statement below only if the column genuinely has to go.
-- ============================================================

DROP TRIGGER IF EXISTS trg_alert_rules_updated_at ON client_alert_rules;
DROP INDEX IF EXISTS idx_alert_events_client;
DROP INDEX IF EXISTS idx_alert_rules_enabled;
DROP INDEX IF EXISTS idx_alert_rules_client;

DROP TABLE IF EXISTS client_alert_events;
DROP TABLE IF EXISTS client_alert_rules;

-- ALTER TABLE clients DROP COLUMN IF EXISTS branding;

DELETE FROM schema_migrations WHERE version = '027';
