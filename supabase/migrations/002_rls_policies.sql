-- ============================================================
-- GRAVVIA ENGAGE – Row Level Security Policies
-- Run order: 002
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_sync_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE failed_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Service role bypasses all RLS (used by backend server)
-- No policies needed for service_role — it always bypasses RLS.
-- Anon / authenticated policies are intentionally restrictive.

-- Only service_role can access these tables directly.
-- All access goes through the backend which uses service_role.
