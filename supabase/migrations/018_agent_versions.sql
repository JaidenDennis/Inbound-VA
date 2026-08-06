-- ============================================================
-- GRAVVIA ENGAGE – Agent sync state, prompt overrides, version history
-- Run order: 018  (NEVER edit earlier migrations)
--
-- provisionClient() renders the knowledge base into the agent prompt and pushes
-- it to Retell, but until now it only ran on demand. A client editing an FAQ
-- changed the database while the live agent kept answering with the old text.
--
-- These columns make the gap visible and closeable: a knowledge or config write
-- marks the client 'pending', a debounced job re-provisions, and every
-- successful provision snapshots what was actually sent.
-- ============================================================

ALTER TABLE clients ADD COLUMN IF NOT EXISTS agent_sync_state TEXT NOT NULL DEFAULT 'never';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS agent_sync_error TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS agent_sync_requested_at TIMESTAMPTZ;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS agent_synced_at TIMESTAMPTZ;

ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_agent_sync_state_check;
ALTER TABLE clients ADD CONSTRAINT clients_agent_sync_state_check
  CHECK (agent_sync_state IN ('never', 'pending', 'synced', 'failed'));

-- Clients already provisioned are 'synced' — they have an agent live on Retell.
UPDATE clients
SET agent_sync_state = 'synced',
    agent_synced_at = retell_last_provisioned_at
WHERE retell_agent_id IS NOT NULL AND agent_sync_state = 'never';

CREATE INDEX IF NOT EXISTS idx_clients_agent_sync_state ON clients(agent_sync_state)
  WHERE agent_sync_state IN ('pending', 'failed');

-- ------------------------------------------------------------
-- Prompt overrides
--
-- Appended sections keyed by slot, never a wholesale prompt replacement. The
-- per-vertical template stays authoritative, so bespoke wording for one client
-- does not become a branch in source — which the multi-tenant rule forbids.
-- Shape: { "<slot>": "<text>" }
-- ------------------------------------------------------------
ALTER TABLE client_settings ADD COLUMN IF NOT EXISTS prompt_overrides JSONB NOT NULL DEFAULT '{}';

-- ------------------------------------------------------------
-- Version history
--
-- Written only on a SUCCESSFUL provision, so the table is a record of what the
-- agent actually ran with. Answers "what changed on Tuesday" — otherwise
-- unanswerable, because a degraded prompt affects every call silently.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_config_versions (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id             UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  version               INTEGER NOT NULL,
  settings_snapshot     JSONB NOT NULL DEFAULT '{}',
  rendered_prompt       TEXT,
  retell_agent_id       TEXT,
  retell_agent_version  INTEGER,
  vertical              TEXT,
  created_by            UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(client_id, version)
);

CREATE INDEX IF NOT EXISTS idx_agent_versions_client ON agent_config_versions(client_id, version DESC);
