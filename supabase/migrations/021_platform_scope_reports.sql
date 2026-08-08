-- ============================================================
-- 021 — Platform-wide reporting scope
--
-- The reporting functions were written for one tenant at a time, so every
-- staff-facing page that called them had to name a client. Staff have no
-- single client, which is why the Calls, Onboarding and Overview pages
-- rendered empty rather than showing the estate.
--
-- A NULL p_client_id now means "every client". Client-scoped callers still
-- pass their own id and are unaffected — the predicate short-circuits.
--
-- Tenant isolation is unchanged: NULL is only ever reachable from a platform
-- role, which the API enforces before the RPC is called.
-- ============================================================

-- ------------------------------------------------------------
-- KPIs
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
  WHERE (p_client_id IS NULL OR client_id = p_client_id)
    AND started_at >= p_from
    AND started_at <= p_to;
$$;

-- ------------------------------------------------------------
-- Volume trend
--
-- Bucketed in the CLIENT's timezone. With no client named there is no single
-- correct timezone, so the platform view buckets in UTC — stated here because
-- a cross-tenant chart silently using one tenant's timezone would be worse.
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
  IF p_client_id IS NULL THEN
    v_tz := 'UTC';
  ELSE
    SELECT COALESCE(timezone, 'UTC') INTO v_tz FROM clients WHERE id = p_client_id;
    v_tz := COALESCE(v_tz, 'UTC');
  END IF;

  -- Whitelist rather than interpolating caller input into date_trunc.
  v_unit := CASE WHEN p_bucket = 'week' THEN 'week' ELSE 'day' END;

  RETURN QUERY
  SELECT
    date_trunc(v_unit, r.started_at AT TIME ZONE v_tz) AT TIME ZONE v_tz AS bucket,
    COUNT(*) FILTER (WHERE NOT r.in_voicemail),
    COUNT(*) FILTER (WHERE r.in_voicemail),
    COUNT(*)
  FROM call_records r
  WHERE (p_client_id IS NULL OR r.client_id = p_client_id)
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
  WHERE (p_client_id IS NULL OR r.client_id = p_client_id)
    AND r.started_at >= p_from
    AND r.started_at <= p_to
  GROUP BY 1
  ORDER BY 2 DESC;
$$;

-- ------------------------------------------------------------
-- Remove fabricated demo phone numbers
--
-- supabase/seed.sql seeded reserved-fiction 555 numbers onto three sample
-- clients. The vertical seed files reuse two of those slugs and their
-- ON CONFLICT clause does not touch phone_numbers, so the fake numbers
-- survived onto real demo agents and showed in the dashboard as though a
-- number were assigned. Nothing in Retell ever mapped to them.
--
-- Only the exact seeded values are cleared, so a real number that happens to
-- sit alongside one is left in place.
-- ------------------------------------------------------------
UPDATE clients
SET phone_numbers = ARRAY(
  SELECT n FROM unnest(phone_numbers) AS n
  WHERE n NOT IN ('+12125550100', '+13105550200', '+13125550300')
)
WHERE phone_numbers && ARRAY['+12125550100', '+13105550200', '+13125550300'];
