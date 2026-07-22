-- ============================================================
-- GRAVVIA ENGAGE – Inbound workflow call sessions
-- Run order: 011  (NEVER edit earlier migrations)
--
-- One row per live call holding the deterministic workflow session state
-- (active workflow + state, workflow stack, collected slots, granted scopes,
-- identity verification, global conversation context). The backend — never the
-- LLM — is the source of truth for where a conversation is; every Retell tool
-- webhook is stateless, so this row is what makes calls resume deterministically.
--
-- Keyed by retell_call_id (what every tool invocation carries) so a session can
-- be opened even if the call_started webhook was missed — the same resilience
-- posture as call_records.recordFromAnalyzed. calls(id) is linked when known.
--
-- Additive only: no existing table or column is modified.
-- ============================================================

CREATE TABLE IF NOT EXISTS call_sessions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  call_id         UUID REFERENCES calls(id) ON DELETE SET NULL,
  retell_call_id  TEXT NOT NULL UNIQUE,
  state           JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_call_sessions_client ON call_sessions(client_id);
CREATE INDEX IF NOT EXISTS idx_call_sessions_retell ON call_sessions(retell_call_id);

-- updated_at trigger (reuses update_updated_at() from 001).
DROP TRIGGER IF EXISTS trg_call_sessions_updated_at ON call_sessions;
CREATE TRIGGER trg_call_sessions_updated_at
  BEFORE UPDATE ON call_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS: same defense-in-depth posture as every other table (see 008 header).
-- The backend uses service_role (bypasses RLS); tenant isolation is enforced in
-- application code. Policies scope by the client_id JWT claim for any future
-- PostgREST/authenticated access.
ALTER TABLE call_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS call_sessions_tenant_select ON call_sessions;
CREATE POLICY call_sessions_tenant_select ON call_sessions
  FOR SELECT TO authenticated
  USING (client_id::text = COALESCE(auth.jwt() ->> 'client_id', ''));
