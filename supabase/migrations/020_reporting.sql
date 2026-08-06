-- ============================================================
-- GRAVVIA ENGAGE – Client reporting: SQL aggregation + call log view
-- Run order: 020  (NEVER edit earlier migrations)
--
-- Fixes a correctness bug, not just a performance one. getStats() selected raw
-- rows and aggregated them in JavaScript; PostgREST caps responses at 1000 rows
-- by default, so past 1000 calls in the selected period every figure shown to a
-- client was silently wrong and always under-counted. A 30-day range on a busy
-- client already exceeds that.
--
-- All aggregation now happens in Postgres, where there is no row cap.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_call_records_client_started ON call_records(client_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_client_started        ON calls(client_id, started_at DESC);

-- ------------------------------------------------------------
-- Outcome derivation
--
-- Precedence, first match wins. Voicemail is checked BEFORE "question
-- answered": Retell can mark a voicemail call_successful, and the reverse order
-- would file voicemails as answered questions — inflating the number clients
-- care about most.
--
-- "Question answered" is INFERRED, not measured: the schema carries no FAQ-hit
-- signal. It means "the call succeeded and was not any of the above".
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION call_outcome(
  p_appointment_booked BOOLEAN,
  p_lead_recaptured    BOOLEAN,
  p_call_status        TEXT,
  p_in_voicemail       BOOLEAN,
  p_call_successful    BOOLEAN
) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_appointment_booked           THEN 'appointment_booked'
    WHEN p_lead_recaptured              THEN 'lead_captured'
    WHEN p_call_status = 'transferred'  THEN 'transferred'
    WHEN p_in_voicemail                 THEN 'voicemail'
    WHEN p_call_successful              THEN 'question_answered'
    ELSE 'abandoned'
  END;
$$;

-- ------------------------------------------------------------
-- KPI cards
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION report_kpis(
  p_client_id UUID,
  p_from      TIMESTAMPTZ,
  p_to        TIMESTAMPTZ
) RETURNS TABLE (
  calls_answered           BIGINT,
  missed_calls_recovered   BIGINT,
  leads_recaptured         BIGINT,
  appointments_booked      BIGINT,
  avg_call_duration_seconds INTEGER,
  total_calls              BIGINT
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT
    COUNT(*) FILTER (WHERE NOT in_voicemail),
    COUNT(*) FILTER (WHERE missed_call_recovered),
    COUNT(*) FILTER (WHERE lead_recaptured),
    COUNT(*) FILTER (WHERE appointment_booked),
    -- Averaged over answered calls only; voicemails would drag it to nonsense.
    COALESCE(ROUND(AVG(duration_seconds) FILTER (WHERE NOT in_voicemail))::INTEGER, 0),
    COUNT(*)
  FROM call_records
  WHERE client_id = p_client_id
    AND started_at >= p_from
    AND started_at <= p_to;
$$;

-- ------------------------------------------------------------
-- Volume trend
--
-- Bucketed in the CLIENT's timezone. Bucketing in UTC puts a 7pm Monday call
-- into Tuesday for a west-coast client, making the chart wrong at every day
-- boundary — an error nobody reports and everybody notices.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION report_volume(
  p_client_id UUID,
  p_from      TIMESTAMPTZ,
  p_to        TIMESTAMPTZ,
  p_bucket    TEXT DEFAULT 'day'
) RETURNS TABLE (
  bucket    TIMESTAMPTZ,
  answered  BIGINT,
  voicemail BIGINT,
  total     BIGINT
)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE
  v_tz TEXT;
  v_unit TEXT;
BEGIN
  SELECT COALESCE(timezone, 'UTC') INTO v_tz FROM clients WHERE id = p_client_id;
  -- Whitelist rather than interpolating caller input into date_trunc.
  v_unit := CASE WHEN p_bucket = 'week' THEN 'week' ELSE 'day' END;

  RETURN QUERY
  SELECT
    date_trunc(v_unit, r.started_at AT TIME ZONE v_tz) AT TIME ZONE v_tz AS bucket,
    COUNT(*) FILTER (WHERE NOT r.in_voicemail),
    COUNT(*) FILTER (WHERE r.in_voicemail),
    COUNT(*)
  FROM call_records r
  WHERE r.client_id = p_client_id
    AND r.started_at >= p_from
    AND r.started_at <= p_to
  GROUP BY 1
  ORDER BY 1;
END;
$$;

-- ------------------------------------------------------------
-- Outcome breakdown
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION report_outcomes(
  p_client_id UUID,
  p_from      TIMESTAMPTZ,
  p_to        TIMESTAMPTZ
) RETURNS TABLE (
  outcome TEXT,
  count   BIGINT
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT
    call_outcome(r.appointment_booked, r.lead_recaptured, c.status, r.in_voicemail, COALESCE(r.call_successful, FALSE)),
    COUNT(*)
  FROM call_records r
  LEFT JOIN calls c ON c.retell_call_id = r.retell_call_id
  WHERE r.client_id = p_client_id
    AND r.started_at >= p_from
    AND r.started_at <= p_to
  GROUP BY 1
  ORDER BY 2 DESC;
$$;

-- ------------------------------------------------------------
-- Call log
--
-- `calls` and `call_records` are parallel tables both keyed on retell_call_id:
-- `calls` holds the caller number, recording and transcript FK, `call_records`
-- holds the Retell analysis flags. The join hides that seam; no data migration.
--
-- recording_url is deliberately NOT in this view. The client call log selects
-- from here, so a future `SELECT *` on the client path cannot leak call audio.
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW client_call_log AS
  SELECT
    r.id                AS id,
    r.client_id,
    r.retell_call_id,
    c.id                AS call_id,
    c.from_number,
    c.to_number,
    c.direction,
    c.status            AS call_status,
    r.started_at,
    r.ended_at,
    r.duration_seconds,
    r.user_sentiment,
    r.in_voicemail,
    r.appointment_booked,
    r.lead_recaptured,
    r.missed_call_recovered,
    call_outcome(
      r.appointment_booked, r.lead_recaptured, c.status, r.in_voicemail, COALESCE(r.call_successful, FALSE)
    )                   AS outcome,
    (t.id IS NOT NULL)  AS has_transcript
  FROM call_records r
  LEFT JOIN calls c ON c.retell_call_id = r.retell_call_id
  LEFT JOIN call_transcripts t ON t.call_id = c.id;
