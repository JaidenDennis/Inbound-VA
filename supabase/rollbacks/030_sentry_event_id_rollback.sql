-- Rollback for 030_sentry_event_id.sql
ALTER TABLE system_errors DROP COLUMN IF EXISTS sentry_event_id;
