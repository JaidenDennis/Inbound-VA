-- ============================================================
-- ROLLBACK for 025_manager_queue.sql
--
-- The view and the pulse function are derived; dropping them loses nothing.
--
-- DESTRUCTIVE: queue_dismissals holds the record of which derived items a human
-- has already judged fine. Dropping it makes every previously-dismissed
-- escalation and calendar conflict reappear in the queue. Snapshot first:
--   CREATE TABLE queue_dismissals_backup AS SELECT * FROM queue_dismissals;
-- ============================================================

DROP FUNCTION IF EXISTS report_pulse(UUID);
DROP VIEW IF EXISTS manager_queue;

DROP INDEX IF EXISTS idx_failed_jobs_client;
DROP INDEX IF EXISTS idx_calls_transferred;

DROP TABLE IF EXISTS queue_dismissals;

DELETE FROM schema_migrations WHERE version = '025';
