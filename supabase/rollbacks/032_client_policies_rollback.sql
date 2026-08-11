-- Rollback for 032_client_policies.sql
--
-- client_settings.business_policies was never dropped and has been kept in
-- sync by renderPolicies() on every write, so dropping this table loses no
-- policy text.
DROP TABLE IF EXISTS client_policies;
