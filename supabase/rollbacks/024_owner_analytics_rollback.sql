-- ============================================================
-- ROLLBACK for 024_owner_analytics.sql
--
-- Mostly safe: the functions are derived views over data that lives elsewhere,
-- so dropping them loses no facts.
--
-- TWO EXCEPTIONS, both destructive:
--   client_roi_snapshots      – the cumulative ROI series. Recomputable from
--                               go-live via snapshot_client_roi, but the daily
--                               history is gone.
--   client_settings.billing_baseline – staff-entered cost figures that exist
--                               nowhere else. Snapshot before running:
--     CREATE TABLE billing_baseline_backup AS
--       SELECT client_id, billing_baseline FROM client_settings
--       WHERE billing_baseline <> '{}'::jsonb;
--
-- appointments.service_id is dropped too. It is populated going forward by the
-- booking service, so losing it degrades revenue matching back to name-only.
-- ============================================================

DROP FUNCTION IF EXISTS report_readiness(UUID);
DROP FUNCTION IF EXISTS snapshot_client_roi(UUID);
DROP FUNCTION IF EXISTS client_go_live_at(UUID);
DROP FUNCTION IF EXISTS report_funnel(UUID, TIMESTAMPTZ, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS report_peak_times(UUID, TIMESTAMPTZ, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS report_lost_demand(UUID, TIMESTAMPTZ, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS report_referrals(UUID, TIMESTAMPTZ, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS report_call_reasons(UUID, TIMESTAMPTZ, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS report_escalations(UUID, TIMESTAMPTZ, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS report_trust(UUID, TIMESTAMPTZ, TIMESTAMPTZ);
-- report_money depends on appointment_price and is_after_hours; drop it first.
DROP FUNCTION IF EXISTS report_money(UUID, TIMESTAMPTZ, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS appointment_price(UUID);
DROP FUNCTION IF EXISTS is_after_hours(UUID, TIMESTAMPTZ);

DROP TABLE IF EXISTS client_roi_snapshots;

ALTER TABLE client_settings DROP COLUMN IF EXISTS billing_baseline;

DROP INDEX IF EXISTS idx_appointments_service;
DROP INDEX IF EXISTS idx_appointments_client_start;
ALTER TABLE appointments DROP COLUMN IF EXISTS service_id;

DELETE FROM schema_migrations WHERE version = '024';
