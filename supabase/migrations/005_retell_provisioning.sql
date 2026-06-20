-- ============================================================
-- GRAVVIA ENGAGE – Retell per-client agent provisioning
-- Run order: 005  (NEVER edit earlier migrations)
-- Adds columns needed to idempotently create/UPDATE a client's Retell agent.
-- clients.retell_agent_id already exists (001); these store the linked
-- Response Engine (Retell LLM), chosen voice, and provisioning metadata.
-- ============================================================

ALTER TABLE clients ADD COLUMN IF NOT EXISTS retell_llm_id          TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS retell_voice_id        TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS retell_agent_version   INTEGER;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS retell_last_provisioned_at TIMESTAMPTZ;

-- Map a phone number to its agent (one row per number). Optional convenience
-- table; clients.phone_numbers remains the source of truth for routing.
CREATE TABLE IF NOT EXISTS retell_phone_numbers (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id          UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  phone_number       TEXT NOT NULL UNIQUE,
  retell_agent_id    TEXT,
  provider           TEXT NOT NULL DEFAULT 'retell',   -- retell | imported
  purchased          BOOLEAN NOT NULL DEFAULT false,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_retell_phone_numbers_client ON retell_phone_numbers(client_id);

ALTER TABLE retell_phone_numbers ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_retell_phone_numbers_updated_at ON retell_phone_numbers;
CREATE TRIGGER trg_retell_phone_numbers_updated_at
  BEFORE UPDATE ON retell_phone_numbers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
