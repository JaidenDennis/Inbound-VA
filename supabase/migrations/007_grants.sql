-- ============================================================
-- GRAVVIA ENGAGE – Restore Supabase role grants on the public schema
-- Run order: 007  (NEVER edit earlier migrations)
--
-- WHY: the backend connects with the Supabase `service_role` key (god-mode,
-- bypasses RLS). If the public tables were created without the default Supabase
-- grants, `service_role` gets "permission denied for table ..." (SQLSTATE 42501)
-- on every query. Services that swallow the error (e.g. clientService.findById)
-- then surface it as a misleading "Client not found".
--
-- This grants `service_role` full DML on all current + future objects, and the
-- usual USAGE to anon/authenticated. Idempotent and safe to re-run.
-- ============================================================

-- Schema usage for the standard Supabase roles.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Full access for the backend's service_role on everything that exists now.
GRANT ALL ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- And on everything created later (so new migrations don't reintroduce the bug).
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;
