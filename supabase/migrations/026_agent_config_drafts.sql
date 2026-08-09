-- ============================================================
-- GRAVVIA ENGAGE – Enterprise dashboard: configuration drafts
-- Run order: 026  (NEVER edit earlier migrations)
--
-- WHY THIS TABLE EXISTS
-- Spec §6.2 asks for "diff-before-publish": a structured diff between the
-- current configuration and the pending edit. There is no pending edit today.
-- `PATCH /my-agent` writes client_settings and queues a re-provision in the same
-- request — saving IS publishing, so there has never been a state to diff
-- against, and a client changing their booking window finds out what it did by
-- listening to the next call.
--
-- A draft is that missing state. It holds the proposed patch, unapplied, until
-- someone has read what it changes and pressed publish. §6.4's sandbox test call
-- needs the same thing for a different reason: it provisions a throwaway agent
-- from the pending settings, which have to exist somewhere first.
--
-- ONE DRAFT PER CLIENT, NOT PER USER
-- Two people editing the same agent are editing the same thing, and a per-user
-- draft would let them publish over each other with no sign anything happened.
-- One row per tenant means the second editor sees the first one's pending work
-- and `updated_by` says whose it is.
--
-- THE STALE-DRAFT GUARD
-- A draft is a patch, not a snapshot, so it is only meaningful against the
-- settings it was taken from. If those settings change underneath it — a staff
-- edit, a version restore, an onboarding write — the diff a client reviewed is
-- no longer the diff they would apply. `base_fingerprint` records what the
-- settings looked like when the draft started; publish compares and refuses on
-- a mismatch rather than silently applying a review nobody performed.
--
-- Rollback: supabase/rollbacks/026_agent_config_drafts_rollback.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_config_drafts (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- The proposed change, as a sparse patch over client_settings. Sparse and not
  -- a full snapshot on purpose: a snapshot taken at 09:00 and published at 17:00
  -- silently reverts every field someone else touched in between, because a
  -- snapshot cannot tell "unchanged" apart from "set back to the old value".
  settings_patch    JSONB NOT NULL DEFAULT '{}',

  -- Digest of the client_settings this patch was composed against. See the
  -- stale-draft guard above. Nullable so a draft created before the settings
  -- could be read is refused at publish rather than silently trusted.
  base_fingerprint  TEXT,

  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One pending edit per tenant. The write path upserts on this.
  UNIQUE (client_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_config_drafts_client ON agent_config_drafts(client_id);

DROP TRIGGER IF EXISTS trg_agent_config_drafts_updated_at ON agent_config_drafts;
CREATE TRIGGER trg_agent_config_drafts_updated_at
  BEFORE UPDATE ON agent_config_drafts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS: same posture as the other tenant tables (see 008 header). The API uses
-- the service role and enforces tenancy in middleware; this is the backstop for
-- a token reaching PostgREST directly.
ALTER TABLE agent_config_drafts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS acd_tenant_select ON agent_config_drafts;
CREATE POLICY acd_tenant_select ON agent_config_drafts
  FOR SELECT TO authenticated
  USING (client_id::text = COALESCE(auth.jwt() ->> 'client_id', ''));

-- ------------------------------------------------------------
-- Verification — abort rather than half-migrate
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'agent_config_drafts'
  ) THEN
    RAISE EXCEPTION 'Migration 026: agent_config_drafts was not created';
  END IF;

  -- The uniqueness is the concurrency model, not a nicety: without it two
  -- drafts coexist for one tenant and publish order decides the winner.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'agent_config_drafts' AND c.contype = 'u'
  ) THEN
    RAISE EXCEPTION 'Migration 026: agent_config_drafts is missing its per-client unique constraint';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_agent_config_drafts_updated_at' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Migration 026: updated_at trigger missing';
  END IF;
END $$;
