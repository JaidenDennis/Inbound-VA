-- ============================================================
-- GRAVVIA ENGAGE – Enterprise dashboard: signal capture
-- Run order: 023  (NEVER edit earlier migrations)
--
-- The enterprise dashboard's differentiator is demand intelligence: why people
-- call, what they ask for that the business cannot sell them, where they heard
-- about it, and which questions the agent could not answer. NONE of that is
-- captured today. `call_records` carries five booleans and a raw_analysis blob.
--
-- This migration adds the columns those surfaces read. It does not populate
-- them: signals arrive from the moment each agent is re-provisioned with the new
-- custom analysis fields, and NO BACKFILL IS POSSIBLE because the data was never
-- recorded. Every surface reading these columns must therefore state its
-- coverage start date — a trend that silently begins mid-history reads as a
-- collapse in call volume.
--
-- TWO SOURCES, SPLIT BY COST
--   Retell post-call analysis  – cheap, arrives with the call_ended webhook,
--                                already lands in raw_analysis. Good for short
--                                extractions the voice model already has context
--                                for: call reason, referral source, requested
--                                service, escalation reason.
--   Post-call AI pass          – one model call per call, on a queue. Needed for
--                                judgement: quality scoring, frustration
--                                detection, knowledge-gap identification.
--
-- Columns are PROMOTED out of raw_analysis rather than queried from JSONB
-- because every one of them is aggregated or filtered on. raw_analysis stays as
-- the durable record of what the provider actually sent.
--
-- NULL IS NOT ZERO. Every column here is nullable and means "not measured".
-- A surface that renders NULL as 0 turns "we have no data" into "we scored zero",
-- which is a fabricated claim. reporting tests assert this distinction.
--
-- Rollback: supabase/rollbacks/023_signal_capture_rollback.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1. Promoted signal columns
-- ------------------------------------------------------------
ALTER TABLE call_records
  -- From Retell custom analysis.
  ADD COLUMN IF NOT EXISTS call_reason        TEXT,
  ADD COLUMN IF NOT EXISTS referral_source    TEXT,
  ADD COLUMN IF NOT EXISTS requested_service  TEXT,
  ADD COLUMN IF NOT EXISTS service_available  BOOLEAN,
  ADD COLUMN IF NOT EXISTS escalation_reason  TEXT,
  -- From the post-call AI pass. 0.0–10.0, one decimal.
  ADD COLUMN IF NOT EXISTS quality_score      NUMERIC(3,1),
  ADD COLUMN IF NOT EXISTS quality_accuracy   NUMERIC(3,1),
  ADD COLUMN IF NOT EXISTS quality_resolution NUMERIC(3,1),
  ADD COLUMN IF NOT EXISTS quality_tone       NUMERIC(3,1),
  ADD COLUMN IF NOT EXISTS flagged            BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS flag_reasons       TEXT[] NOT NULL DEFAULT '{}',
  -- Stamped when the AI pass completes. NULL means "not analysed", which is how
  -- coverage is computed and how the worker finds its backlog.
  ADD COLUMN IF NOT EXISTS analyzed_at        TIMESTAMPTZ,
  -- Review state for the flagged-call queue. Mirrors system_errors (017) exactly
  -- so the review UI is one component rather than two.
  ADD COLUMN IF NOT EXISTS reviewed_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by        UUID REFERENCES users(id) ON DELETE SET NULL;

-- Scores are a bounded scale, not an arbitrary number. Reject out-of-range
-- rather than clamping: a model returning 47 is a prompt bug, and clamping it to
-- 10 hides the bug behind a plausible-looking figure.
ALTER TABLE call_records DROP CONSTRAINT IF EXISTS call_records_quality_range;
ALTER TABLE call_records ADD CONSTRAINT call_records_quality_range CHECK (
  (quality_score      IS NULL OR (quality_score      >= 0 AND quality_score      <= 10)) AND
  (quality_accuracy   IS NULL OR (quality_accuracy   >= 0 AND quality_accuracy   <= 10)) AND
  (quality_resolution IS NULL OR (quality_resolution >= 0 AND quality_resolution <= 10)) AND
  (quality_tone       IS NULL OR (quality_tone       >= 0 AND quality_tone       <= 10))
);

-- Partial index: the flagged queue reads a small slice of a large table.
CREATE INDEX IF NOT EXISTS idx_call_records_flagged
  ON call_records(client_id, started_at DESC) WHERE flagged;

-- The worker's backlog scan, and the coverage denominator.
CREATE INDEX IF NOT EXISTS idx_call_records_unanalyzed
  ON call_records(client_id, started_at DESC) WHERE analyzed_at IS NULL;

-- Demand intelligence groups on these.
CREATE INDEX IF NOT EXISTS idx_call_records_reason
  ON call_records(client_id, call_reason) WHERE call_reason IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_call_records_referral
  ON call_records(client_id, referral_source) WHERE referral_source IS NOT NULL;

-- ------------------------------------------------------------
-- 2. Knowledge gaps
--
-- Per-question rather than per-call: the same unanswered question asked forty
-- times is ONE thing to fix, not forty. `normalized` + UNIQUE is what turns the
-- list into a work queue — the same shape migration 017 uses for error
-- fingerprints, and for the same reason.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge_gaps (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  -- The most recent call that asked it. Not a full join table: the value is the
  -- question and its frequency, and one example is enough to listen to.
  call_id         UUID REFERENCES calls(id) ON DELETE SET NULL,
  question        TEXT NOT NULL,
  normalized      TEXT NOT NULL,
  occurrences     INTEGER NOT NULL DEFAULT 1,
  -- Set when someone uses the inline "add this answer" action. The gap is kept
  -- rather than deleted so the loop is measurable: how many gaps did we close.
  resolved_faq_id UUID REFERENCES faqs(id) ON DELETE SET NULL,
  resolved_at     TIMESTAMPTZ,
  resolved_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, normalized)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_gaps_open
  ON knowledge_gaps(client_id, occurrences DESC) WHERE resolved_at IS NULL;

ALTER TABLE knowledge_gaps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS knowledge_gaps_tenant_select ON knowledge_gaps;
CREATE POLICY knowledge_gaps_tenant_select ON knowledge_gaps
  FOR SELECT TO authenticated
  USING (client_id::text = COALESCE(auth.jwt() ->> 'client_id', ''));

-- ------------------------------------------------------------
-- 3. Recording a gap
--
-- Upsert-with-increment in one statement so two workers analysing two calls
-- that asked the same question cannot race into a duplicate or a lost count.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION record_knowledge_gap(
  p_client_id  UUID,
  p_call_id    UUID,
  p_question   TEXT,
  p_normalized TEXT
) RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO knowledge_gaps (client_id, call_id, question, normalized)
  VALUES (p_client_id, p_call_id, p_question, p_normalized)
  ON CONFLICT (client_id, normalized) DO UPDATE
    SET occurrences  = knowledge_gaps.occurrences + 1,
        last_seen_at = NOW(),
        call_id      = EXCLUDED.call_id
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ------------------------------------------------------------
-- 4. Coverage
--
-- The product claims every call is scored, unlike human QA which samples. That
-- claim has to be auditable on the surface making it, so coverage is a first
-- class figure rather than something the UI infers from nulls.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION report_quality(
  p_client_id UUID,
  p_from      TIMESTAMPTZ,
  p_to        TIMESTAMPTZ
) RETURNS TABLE (
  analyzed_calls  BIGINT,
  total_calls     BIGINT,
  avg_score       NUMERIC,
  avg_accuracy    NUMERIC,
  avg_resolution  NUMERIC,
  avg_tone        NUMERIC,
  flagged_calls   BIGINT
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT
    COUNT(*) FILTER (WHERE analyzed_at IS NOT NULL),
    COUNT(*),
    -- AVG over an all-NULL set is NULL, not 0. That is the correct answer to
    -- "what is the average score" when nothing has been scored, and the API
    -- passes it through as null rather than coalescing it.
    ROUND(AVG(quality_score), 1),
    ROUND(AVG(quality_accuracy), 1),
    ROUND(AVG(quality_resolution), 1),
    ROUND(AVG(quality_tone), 1),
    COUNT(*) FILTER (WHERE flagged)
  FROM call_records
  WHERE client_id = p_client_id
    AND started_at >= p_from
    AND started_at <= p_to;
$$;
