-- ============================================================
-- GRAVVIA ENGAGE – allow 'email' as a system_errors source
-- Run order: 029  (NEVER edit earlier migrations)
--
-- Migration 017 fixed the source CHECK at ('api','worker','webhook','startup').
-- Mail delivery is none of those: sendMail is called from routes AND workers,
-- and its failures are a property of one platform-level credential rather than
-- of whichever process happened to make the call. Filing them under 'worker'
-- would scatter one outage across two sources in the console.
--
-- Rollback: supabase/rollbacks/029_email_error_source_rollback.sql
-- ============================================================

ALTER TABLE system_errors DROP CONSTRAINT IF EXISTS system_errors_source_check;

ALTER TABLE system_errors
  ADD CONSTRAINT system_errors_source_check
  CHECK (source IN ('api', 'worker', 'webhook', 'startup', 'email'));
