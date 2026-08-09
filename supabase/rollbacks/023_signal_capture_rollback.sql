-- ============================================================
-- ROLLBACK for 023_signal_capture.sql
--
-- DESTRUCTIVE. Dropping these columns discards every captured signal, and there
-- is no way to recover them: the data came from post-call analysis that will not
-- be re-run for calls already ended. Snapshot before running:
--
--   CREATE TABLE call_records_signal_backup AS
--     SELECT id, call_reason, referral_source, requested_service,
--            service_available, escalation_reason, quality_score,
--            quality_accuracy, quality_resolution, quality_tone,
--            flagged, flag_reasons, analyzed_at, reviewed_at, reviewed_by
--     FROM call_records WHERE analyzed_at IS NOT NULL;
--   CREATE TABLE knowledge_gaps_backup AS SELECT * FROM knowledge_gaps;
-- ============================================================

DROP FUNCTION IF EXISTS report_quality(UUID, TIMESTAMPTZ, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS record_knowledge_gap(UUID, UUID, TEXT, TEXT);

DROP TABLE IF EXISTS knowledge_gaps;

DROP INDEX IF EXISTS idx_call_records_flagged;
DROP INDEX IF EXISTS idx_call_records_unanalyzed;
DROP INDEX IF EXISTS idx_call_records_reason;
DROP INDEX IF EXISTS idx_call_records_referral;

ALTER TABLE call_records DROP CONSTRAINT IF EXISTS call_records_quality_range;

ALTER TABLE call_records
  DROP COLUMN IF EXISTS call_reason,
  DROP COLUMN IF EXISTS referral_source,
  DROP COLUMN IF EXISTS requested_service,
  DROP COLUMN IF EXISTS service_available,
  DROP COLUMN IF EXISTS escalation_reason,
  DROP COLUMN IF EXISTS quality_score,
  DROP COLUMN IF EXISTS quality_accuracy,
  DROP COLUMN IF EXISTS quality_resolution,
  DROP COLUMN IF EXISTS quality_tone,
  DROP COLUMN IF EXISTS flagged,
  DROP COLUMN IF EXISTS flag_reasons,
  DROP COLUMN IF EXISTS analyzed_at,
  DROP COLUMN IF EXISTS reviewed_at,
  DROP COLUMN IF EXISTS reviewed_by;

DELETE FROM schema_migrations WHERE version = '023';
