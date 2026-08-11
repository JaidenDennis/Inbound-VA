-- ============================================================
-- GRAVVIA ENGAGE – policies as titled entries
-- Run order: 032  (NEVER edit earlier migrations)
--
-- client_settings.business_policies is a bare TEXT[] of anonymous strings,
-- rendered in the console as one broad text box that operators find hard to
-- fill in well. Policies become rows with a title and a body.
--
-- client_settings.business_policies IS DELIBERATELY KEPT and stays the
-- agent-facing contract. It is read by seven Retell templates plus
-- retell-functions.route.ts, agentDraft.service.ts, configDiff.service.ts and
-- client.types.ts (via ClientSettings). Migrating all of those to a relational
-- read is a large blast radius for no user-visible gain, so every write to
-- client_policies re-renders that array instead.
--
-- DEVIATION FROM THE TASK BRIEF: the brief's draft SQL backfilled from
-- `clients.business_policies` / verified against `clients c`. That column
-- lives on `client_settings`, not `clients` (confirmed against the live
-- schema: `clients` has no `business_policies` column at all — see migration
-- 001 line 42, which puts it on `client_settings`; and client.types.ts, where
-- `business_policies` is a field of `ClientSettings`, not `Client`). Running
-- the brief's literal SQL against production would fail with "column
-- c.business_policies does not exist". This migration backfills from
-- `client_settings` instead; `client_policies.client_id` still references
-- `clients(id)`, which is correct either way.
--
-- Backfill gives each existing string its own row, body = the string, title =
-- "Policy N" for the operator to rename. Nothing is lost and nothing is guessed.
--
-- Rollback: supabase/rollbacks/032_client_policies_rollback.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS client_policies (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id  UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_policies_client ON client_policies(client_id);

DROP TRIGGER IF EXISTS trg_client_policies_updated_at ON client_policies;
CREATE TRIGGER trg_client_policies_updated_at
  BEFORE UPDATE ON client_policies FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE client_policies ENABLE ROW LEVEL SECURITY;

-- Backfill. Guarded so re-running the migration cannot duplicate rows.
INSERT INTO client_policies (client_id, title, body, sort_order)
SELECT cs.client_id,
       'Policy ' || p.ord::text,
       p.policy,
       p.ord - 1
FROM client_settings cs
CROSS JOIN LATERAL unnest(cs.business_policies) WITH ORDINALITY AS p(policy, ord)
WHERE COALESCE(array_length(cs.business_policies, 1), 0) > 0
  AND NOT EXISTS (SELECT 1 FROM client_policies cp WHERE cp.client_id = cs.client_id);
