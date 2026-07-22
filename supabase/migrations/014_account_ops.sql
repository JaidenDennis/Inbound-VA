-- ============================================================
-- GRAVVIA ENGAGE – Account & Ops (inbound Phase 5)
-- Run order: 014  (NEVER edit earlier migrations)
--
-- 1. callback_requests: dedicated lifecycle table for caller callback requests
--    (schedule_callback also keeps writing a staff_notifications alert; this
--    table is the trackable record with a status lifecycle).
-- 2. tickets: additive columns so a CALLER complaint can be stored on the same
--    table the dashboard uses. created_by is already nullable (users FK,
--    ON DELETE SET NULL); a caller-created ticket leaves it NULL and records
--    the contact/call/source instead.
--
-- Additive only. No existing column is modified or repurposed.
-- ============================================================

CREATE TABLE IF NOT EXISTS callback_requests (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id      UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  contact_id     UUID REFERENCES contacts(id) ON DELETE SET NULL,
  call_id        UUID REFERENCES calls(id) ON DELETE SET NULL,
  caller_name    TEXT NOT NULL,
  phone          TEXT NOT NULL,
  preferred_time TEXT,
  reason         TEXT,
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','in_progress','completed','cancelled')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_callback_requests_client        ON callback_requests(client_id);
CREATE INDEX IF NOT EXISTS idx_callback_requests_client_status ON callback_requests(client_id, status);
CREATE INDEX IF NOT EXISTS idx_callback_requests_contact       ON callback_requests(contact_id);

DROP TRIGGER IF EXISTS trg_callback_requests_updated_at ON callback_requests;
CREATE TRIGGER trg_callback_requests_updated_at
  BEFORE UPDATE ON callback_requests FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE callback_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS callback_requests_tenant_select ON callback_requests;
CREATE POLICY callback_requests_tenant_select ON callback_requests
  FOR SELECT TO authenticated
  USING (client_id::text = COALESCE(auth.jwt() ->> 'client_id', ''));

-- Tickets: caller-complaint provenance (additive columns).
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS call_id    UUID REFERENCES calls(id) ON DELETE SET NULL;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS source     TEXT NOT NULL DEFAULT 'dashboard';

CREATE INDEX IF NOT EXISTS idx_tickets_contact ON tickets(contact_id);
CREATE INDEX IF NOT EXISTS idx_tickets_source  ON tickets(source);
