-- ============================================================
-- GRAVVIA ENGAGE – correlate system_errors with Sentry issues
-- Run order: 030  (NEVER edit earlier migrations)
--
-- The console at /dashboard/system and Sentry have always described the same
-- incidents with no way to get from one to the other. Storing the event id
-- Sentry returns from captureException makes each console row a link.
--
-- Deliberately a plain nullable TEXT: Sentry is optional (SENTRY_DSN unset is a
-- supported deployment), so NULL is the normal state, not a defect.
--
-- Rollback: supabase/rollbacks/030_sentry_event_id_rollback.sql
-- ============================================================

ALTER TABLE system_errors ADD COLUMN IF NOT EXISTS sentry_event_id TEXT;
