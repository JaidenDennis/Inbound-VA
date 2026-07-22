-- ============================================================
-- GRAVVIA ENGAGE – Waitlist entries (inbound Phase 3)
-- Run order: 013  (NEVER edit earlier migrations)
--
-- Callers who want a slot that isn't available join the waitlist; automation
-- notifies staff (and later the caller) when an opening appears. Additive only.
-- ============================================================

CREATE TABLE IF NOT EXISTS waitlist_entries (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  contact_id      UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  call_id         UUID REFERENCES calls(id) ON DELETE SET NULL,
  service         TEXT,
  preferred_days  TEXT[] NOT NULL DEFAULT '{}',
  preferred_times TEXT,
  notes           TEXT,
  status          TEXT NOT NULL DEFAULT 'waiting'
                  CHECK (status IN ('waiting','notified','booked','cancelled')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_waitlist_client        ON waitlist_entries(client_id);
CREATE INDEX IF NOT EXISTS idx_waitlist_client_status ON waitlist_entries(client_id, status);
CREATE INDEX IF NOT EXISTS idx_waitlist_contact       ON waitlist_entries(contact_id);

DROP TRIGGER IF EXISTS trg_waitlist_entries_updated_at ON waitlist_entries;
CREATE TRIGGER trg_waitlist_entries_updated_at
  BEFORE UPDATE ON waitlist_entries FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS: same defense-in-depth posture as other tables (see 008 header).
ALTER TABLE waitlist_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS waitlist_tenant_select ON waitlist_entries;
CREATE POLICY waitlist_tenant_select ON waitlist_entries
  FOR SELECT TO authenticated
  USING (client_id::text = COALESCE(auth.jwt() ->> 'client_id', ''));
