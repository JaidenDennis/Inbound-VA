-- Rollback for 029_email_error_source.sql
--
-- Rows with source='email' must go first or the tightened constraint cannot be
-- validated. They are diagnostic records, so deleting them loses no business data.

DELETE FROM system_errors WHERE source = 'email';

ALTER TABLE system_errors DROP CONSTRAINT IF EXISTS system_errors_source_check;

ALTER TABLE system_errors
  ADD CONSTRAINT system_errors_source_check
  CHECK (source IN ('api', 'worker', 'webhook', 'startup'));
