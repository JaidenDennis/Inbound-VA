-- ============================================================
-- GRAVVIA ENGAGE – Enterprise dashboard: owner analytics
-- Run order: 024  (NEVER edit earlier migrations)
--
-- The owner view, in the design's order: money, then candid failure data, then
-- insight. Surfacing failure voluntarily is what makes the money figures
-- credible.
--
-- ALL AGGREGATION IS IN SQL. Settled policy, not preference: migration 020's
-- header records that JavaScript aggregation silently under-counted every figure
-- past 1000 rows, because PostgREST caps responses there. Every function here
-- follows report_kpis — SECURITY INVOKER, (p_client_id, p_from, p_to).
--
-- NULL MEANS "NOT CONFIGURED" AND MUST SURVIVE TO THE UI.
-- A client with no hours has no after-hours figure; a client with no billing
-- baseline has no cost-per-appointment. Those cards must not render, rather than
-- render a zero or a number derived from an assumption. Returning 0 here would
-- turn "we don't know" into a claim, which is the one thing PRODUCT.md forbids.
--
-- THE HOURS SHAPE
-- booking_rules.working_hours is keyed by LOWERCASE WEEKDAY NAME, and a closed
-- day is ABSENT rather than flagged:
--     {"monday": {"open":"09:00","close":"17:00"}, ...}
-- This is what booking.service.ts:284 reads and what all seven agent templates
-- render, and 7 of 8 live tenants store. An earlier spec proposed a
-- {weekly:[{day:0-6}]} array; nothing in production uses it, and building
-- against it would have reported 100% of calls at every existing tenant as
-- after-hours.
--
-- Rollback: supabase/rollbacks/024_owner_analytics_rollback.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1. Additive columns
-- ------------------------------------------------------------

-- Match quality for revenue attribution improves from here forward without a
-- data migration: appointments.service_type is free text, this is the FK the
-- booking service populates going forward.
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES services(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_appointments_service ON appointments(service_id);
CREATE INDEX IF NOT EXISTS idx_appointments_client_start ON appointments(client_id, start_time DESC);

-- What the agent costs, so cost-per-booked-appointment can be computed against
-- something real. Entered by staff during onboarding; ABSENT BY DEFAULT, and the
-- card does not render while it is absent.
--   { "monthly_cost": 800, "receptionist_hourly": 22, "hours_per_week": 40 }
ALTER TABLE client_settings
  ADD COLUMN IF NOT EXISTS billing_baseline JSONB NOT NULL DEFAULT '{}';

-- ------------------------------------------------------------
-- 2. After-hours
--
-- The primary persuasion metric: revenue that provably did not exist before.
-- Evaluated in the CLIENT's timezone — bucketing in UTC puts a 7pm Monday call
-- into Tuesday for a west-coast tenant (same reasoning as report_volume in 020).
--
-- Returns NULL, not false, when hours are not configured. "We don't know whether
-- this was after hours" is the truth for a tenant that never set them, and the
-- caller must be able to tell that apart from "this was during business hours".
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_after_hours(p_client_id UUID, p_at TIMESTAMPTZ)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE
  v_tz     TEXT;
  v_rules  JSONB;
  v_hours  JSONB;
  v_local  TIMESTAMP;
  v_day    TEXT;
  v_open   TEXT;
  v_close  TEXT;
  v_time   TIME;
BEGIN
  SELECT COALESCE(c.timezone, 'UTC'), COALESCE(cs.booking_rules, '{}'::jsonb)
    INTO v_tz, v_rules
  FROM clients c
  LEFT JOIN client_settings cs ON cs.client_id = c.id
  WHERE c.id = p_client_id;

  IF v_tz IS NULL THEN RETURN NULL; END IF;

  v_hours := v_rules -> 'working_hours';
  -- Not configured: no answer, rather than a wrong one.
  IF v_hours IS NULL OR jsonb_typeof(v_hours) <> 'object' OR v_hours = '{}'::jsonb THEN
    RETURN NULL;
  END IF;

  v_local := p_at AT TIME ZONE v_tz;
  v_time  := v_local::TIME;
  v_day   := lower(to_char(v_local, 'FMDay'));

  -- A blackout date is closed all day regardless of the weekly pattern.
  IF v_rules ? 'blackout_dates'
     AND (v_rules -> 'blackout_dates') @> to_jsonb(to_char(v_local, 'YYYY-MM-DD')) THEN
    RETURN TRUE;
  END IF;

  -- An absent weekday means closed. That is the storage convention: Nonna's
  -- Table has no "monday" key because it does not open on Mondays.
  IF NOT (v_hours ? v_day) THEN RETURN TRUE; END IF;

  v_open  := v_hours -> v_day ->> 'open';
  v_close := v_hours -> v_day ->> 'close';
  IF v_open IS NULL OR v_close IS NULL THEN RETURN TRUE; END IF;

  -- Closing past midnight (a restaurant open 17:00–01:00) would make a naive
  -- BETWEEN wrong for every evening call, so the overnight case is explicit.
  IF v_close::TIME < v_open::TIME THEN
    RETURN NOT (v_time >= v_open::TIME OR v_time <= v_close::TIME);
  END IF;

  RETURN NOT (v_time >= v_open::TIME AND v_time <= v_close::TIME);
END;
$$;

-- ------------------------------------------------------------
-- 3. Revenue attribution
--
-- There is no invoices table, so revenue is DERIVED and is labelled an estimate
-- everywhere it appears.
--
-- Resolution order: appointments.service_id (populated going forward) →
-- case-insensitive name match against services → pricing by service_id.
-- Anything unresolved is COUNTED SEPARATELY and returned as
-- `unmatched_appointments`. Dropping them under-reports; averaging them
-- over-reports; naming them is the only honest option, and it is also what
-- prompts the client to fix their service names.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION appointment_price(p_appointment_id UUID)
RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT COALESCE(
    (SELECT s.price FROM services s WHERE s.id = a.service_id AND s.price IS NOT NULL),
    (SELECT s.price FROM services s
      WHERE s.client_id = a.client_id
        AND lower(s.name) = lower(COALESCE(a.service_type, ''))
        AND s.price IS NOT NULL
      LIMIT 1),
    (SELECT p.price FROM pricing p
      WHERE p.client_id = a.client_id
        AND lower(p.name) = lower(COALESCE(a.service_type, ''))
      LIMIT 1)
  )
  FROM appointments a WHERE a.id = p_appointment_id;
$$;

CREATE OR REPLACE FUNCTION report_money(
  p_client_id UUID,
  p_from      TIMESTAMPTZ,
  p_to        TIMESTAMPTZ
) RETURNS TABLE (
  booked_appointments    BIGINT,
  attributed_revenue     NUMERIC,
  unmatched_appointments BIGINT,
  after_hours_calls      BIGINT,
  after_hours_bookings   BIGINT,
  after_hours_revenue    NUMERIC,
  hours_configured       BOOLEAN,
  recovered_calls        BIGINT,
  monthly_cost           NUMERIC,
  cost_per_appointment   NUMERIC
)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE
  v_baseline JSONB;
  v_cost     NUMERIC;
  v_hours_ok BOOLEAN;
BEGIN
  SELECT COALESCE(billing_baseline, '{}'::jsonb) INTO v_baseline
  FROM client_settings WHERE client_id = p_client_id;

  -- NULL, not 0. A missing baseline means the cost card does not render.
  v_cost := NULLIF(v_baseline ->> 'monthly_cost', '')::NUMERIC;

  SELECT (booking_rules -> 'working_hours') IS NOT NULL
     AND (booking_rules -> 'working_hours') <> '{}'::jsonb
    INTO v_hours_ok
  FROM client_settings WHERE client_id = p_client_id;
  v_hours_ok := COALESCE(v_hours_ok, FALSE);

  RETURN QUERY
  WITH appts AS (
    SELECT a.id, a.start_time, appointment_price(a.id) AS price,
           is_after_hours(p_client_id, a.created_at) AS booked_after_hours
    FROM appointments a
    WHERE a.client_id = p_client_id
      AND a.start_time >= p_from AND a.start_time <= p_to
      AND a.status IN ('confirmed', 'completed')
  ),
  calls AS (
    SELECT r.id, r.missed_call_recovered,
           is_after_hours(p_client_id, r.started_at) AS after_hours
    FROM call_records r
    WHERE r.client_id = p_client_id
      AND r.started_at >= p_from AND r.started_at <= p_to
  )
  SELECT
    (SELECT COUNT(*) FROM appts),
    (SELECT COALESCE(SUM(price), 0) FROM appts WHERE price IS NOT NULL),
    (SELECT COUNT(*) FROM appts WHERE price IS NULL),
    (SELECT COUNT(*) FROM calls WHERE after_hours),
    (SELECT COUNT(*) FROM appts WHERE booked_after_hours),
    (SELECT COALESCE(SUM(price), 0) FROM appts WHERE booked_after_hours AND price IS NOT NULL),
    v_hours_ok,
    (SELECT COUNT(*) FROM calls WHERE missed_call_recovered),
    v_cost,
    CASE
      WHEN v_cost IS NULL THEN NULL
      WHEN (SELECT COUNT(*) FROM appts) = 0 THEN NULL
      ELSE ROUND(v_cost / (SELECT COUNT(*) FROM appts), 2)
    END;
END;
$$;

-- ------------------------------------------------------------
-- 4. Trust — where the agent failed
--
-- Escalations grouped by REASON, not by count, per the design. Before signals
-- accumulate (migration 023) the reason is NULL, which the API surfaces as
-- "reason not captured" — a coverage statement, not a category.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION report_trust(
  p_client_id UUID,
  p_from      TIMESTAMPTZ,
  p_to        TIMESTAMPTZ
) RETURNS TABLE (
  total_calls       BIGINT,
  contained_calls   BIGINT,
  transferred_calls BIGINT,
  flagged_calls     BIGINT,
  analyzed_calls    BIGINT,
  avg_quality       NUMERIC
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE COALESCE(c.status, '') <> 'transferred'),
    COUNT(*) FILTER (WHERE c.status = 'transferred'),
    COUNT(*) FILTER (WHERE r.flagged),
    COUNT(*) FILTER (WHERE r.analyzed_at IS NOT NULL),
    -- NULL when nothing is scored. Never 0 — see the header.
    ROUND(AVG(r.quality_score), 1)
  FROM call_records r
  LEFT JOIN calls c ON c.retell_call_id = r.retell_call_id
  WHERE r.client_id = p_client_id
    AND r.started_at >= p_from AND r.started_at <= p_to;
$$;

CREATE OR REPLACE FUNCTION report_escalations(
  p_client_id UUID,
  p_from      TIMESTAMPTZ,
  p_to        TIMESTAMPTZ
) RETURNS TABLE (reason TEXT, count BIGINT)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT COALESCE(NULLIF(TRIM(r.escalation_reason), ''), '(not captured)'), COUNT(*)
  FROM call_records r
  LEFT JOIN calls c ON c.retell_call_id = r.retell_call_id
  WHERE r.client_id = p_client_id
    AND r.started_at >= p_from AND r.started_at <= p_to
    AND (c.status = 'transferred' OR r.escalation_reason IS NOT NULL)
  GROUP BY 1 ORDER BY 2 DESC;
$$;

-- ------------------------------------------------------------
-- 5. Demand intelligence
--
-- Not available from any CRM report; the primary differentiator on the
-- enterprise sale. Every one of these reads a migration-023 column, so all of
-- them return empty until agents are re-provisioned. That is coverage, not
-- failure, and the API reports the analysed-call count alongside.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION report_call_reasons(
  p_client_id UUID,
  p_from      TIMESTAMPTZ,
  p_to        TIMESTAMPTZ
) RETURNS TABLE (reason TEXT, count BIGINT)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT lower(TRIM(call_reason)), COUNT(*)
  FROM call_records
  WHERE client_id = p_client_id
    AND started_at >= p_from AND started_at <= p_to
    AND NULLIF(TRIM(call_reason), '') IS NOT NULL
  GROUP BY 1 ORDER BY 2 DESC;
$$;

CREATE OR REPLACE FUNCTION report_referrals(
  p_client_id UUID,
  p_from      TIMESTAMPTZ,
  p_to        TIMESTAMPTZ
) RETURNS TABLE (source TEXT, count BIGINT)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT lower(TRIM(referral_source)), COUNT(*)
  FROM call_records
  WHERE client_id = p_client_id
    AND started_at >= p_from AND started_at <= p_to
    AND NULLIF(TRIM(referral_source), '') IS NOT NULL
  GROUP BY 1 ORDER BY 2 DESC;
$$;

/**
 * Lost demand.
 *
 * `estimated_value` is populated ONLY where the requested service matches a
 * priced services row. A dollar figure on a service the business does not price
 * would be invented, so those rows return NULL value with a real count — the
 * count is still true and still actionable.
 */
CREATE OR REPLACE FUNCTION report_lost_demand(
  p_client_id UUID,
  p_from      TIMESTAMPTZ,
  p_to        TIMESTAMPTZ
) RETURNS TABLE (service TEXT, requests BIGINT, unit_price NUMERIC, estimated_value NUMERIC)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  WITH asked AS (
    SELECT lower(TRIM(requested_service)) AS service, COUNT(*) AS requests
    FROM call_records
    WHERE client_id = p_client_id
      AND started_at >= p_from AND started_at <= p_to
      AND service_available IS FALSE
      AND NULLIF(TRIM(requested_service), '') IS NOT NULL
    GROUP BY 1
  )
  SELECT a.service, a.requests, s.price,
         CASE WHEN s.price IS NULL THEN NULL ELSE ROUND(s.price * a.requests, 2) END
  FROM asked a
  LEFT JOIN LATERAL (
    SELECT price FROM services
    WHERE client_id = p_client_id AND lower(name) = a.service AND price IS NOT NULL
    LIMIT 1
  ) s ON TRUE
  ORDER BY a.requests DESC;
$$;

/** Hour-of-week call density, in the client's timezone. A staffing decision. */
CREATE OR REPLACE FUNCTION report_peak_times(
  p_client_id UUID,
  p_from      TIMESTAMPTZ,
  p_to        TIMESTAMPTZ
) RETURNS TABLE (dow INTEGER, hour INTEGER, count BIGINT)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE v_tz TEXT;
BEGIN
  SELECT COALESCE(timezone, 'UTC') INTO v_tz FROM clients WHERE id = p_client_id;
  RETURN QUERY
  SELECT EXTRACT(DOW  FROM started_at AT TIME ZONE v_tz)::INTEGER,
         EXTRACT(HOUR FROM started_at AT TIME ZONE v_tz)::INTEGER,
         COUNT(*)
  FROM call_records
  WHERE client_id = p_client_id AND started_at >= p_from AND started_at <= p_to
  GROUP BY 1, 2 ORDER BY 1, 2;
END;
$$;

-- ------------------------------------------------------------
-- 6. Funnel
--
-- captured → contacted → booked. "Contacted" is inferred from the contact having
-- more than one conversation; the schema carries no explicit contacted state, and
-- this records that inference rather than letting it be mistaken for a measurement.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION report_funnel(
  p_client_id UUID,
  p_from      TIMESTAMPTZ,
  p_to        TIMESTAMPTZ
) RETURNS TABLE (captured BIGINT, contacted BIGINT, booked BIGINT)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT
    (SELECT COUNT(*) FROM contacts
      WHERE client_id = p_client_id AND created_at >= p_from AND created_at <= p_to),
    -- COUNT over the grouped set, not a grouped COUNT: the latter returns one
    -- contact's conversation count and reads as a plausible funnel figure.
    (SELECT COUNT(*) FROM (
      SELECT ct.id FROM contacts ct
      JOIN conversations cv ON cv.contact_id = ct.id
      WHERE ct.client_id = p_client_id AND ct.created_at >= p_from AND ct.created_at <= p_to
      GROUP BY ct.id HAVING COUNT(cv.id) > 1
    ) multi_touch),
    (SELECT COUNT(DISTINCT a.contact_id) FROM appointments a
      WHERE a.client_id = p_client_id AND a.created_at >= p_from AND a.created_at <= p_to
        AND a.status IN ('confirmed', 'completed'));
$$;

-- ------------------------------------------------------------
-- 7. Cumulative ROI
--
-- Anchored on the go_live onboarding milestone, never windowed and never reset:
-- it is renewal insurance, and the number only goes up. Materialised nightly
-- rather than recomputed across all history on every page load.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_roi_snapshots (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  as_of               DATE NOT NULL,
  since               TIMESTAMPTZ NOT NULL,
  booked_appointments BIGINT NOT NULL DEFAULT 0,
  attributed_revenue  NUMERIC NOT NULL DEFAULT 0,
  after_hours_revenue NUMERIC NOT NULL DEFAULT 0,
  recovered_calls     BIGINT NOT NULL DEFAULT 0,
  total_cost          NUMERIC,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, as_of)
);

CREATE INDEX IF NOT EXISTS idx_roi_client_asof ON client_roi_snapshots(client_id, as_of DESC);

ALTER TABLE client_roi_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS roi_tenant_select ON client_roi_snapshots;
CREATE POLICY roi_tenant_select ON client_roi_snapshots
  FOR SELECT TO authenticated
  USING (client_id::text = COALESCE(auth.jwt() ->> 'client_id', ''));

/** The client's go-live moment, or NULL if they have not launched. */
CREATE OR REPLACE FUNCTION client_go_live_at(p_client_id UUID)
RETURNS TIMESTAMPTZ
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT completed_at FROM onboarding_milestones
  WHERE client_id = p_client_id AND stage_key = 'go_live' AND status = 'complete'
  LIMIT 1;
$$;

/**
 * Recompute today's snapshot for one client. Idempotent per (client, day).
 * Returns NULL for a pre-go-live client: there is no ROI before launch, and a
 * zero would read as "the agent earned nothing" rather than "it has not started".
 */
CREATE OR REPLACE FUNCTION snapshot_client_roi(p_client_id UUID)
RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
  v_since TIMESTAMPTZ;
  v_id    UUID;
  v_m     RECORD;
BEGIN
  v_since := client_go_live_at(p_client_id);
  IF v_since IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_m FROM report_money(p_client_id, v_since, NOW());

  INSERT INTO client_roi_snapshots (
    client_id, as_of, since, booked_appointments,
    attributed_revenue, after_hours_revenue, recovered_calls, total_cost
  ) VALUES (
    p_client_id, CURRENT_DATE, v_since, v_m.booked_appointments,
    v_m.attributed_revenue, v_m.after_hours_revenue, v_m.recovered_calls,
    -- Months since go-live × monthly cost. NULL when no baseline is configured.
    CASE WHEN v_m.monthly_cost IS NULL THEN NULL
         ELSE ROUND(v_m.monthly_cost * GREATEST(1, EXTRACT(EPOCH FROM (NOW() - v_since)) / 2592000), 2)
    END
  )
  ON CONFLICT (client_id, as_of) DO UPDATE SET
    booked_appointments = EXCLUDED.booked_appointments,
    attributed_revenue  = EXCLUDED.attributed_revenue,
    after_hours_revenue = EXCLUDED.after_hours_revenue,
    recovered_calls     = EXCLUDED.recovered_calls,
    total_cost          = EXCLUDED.total_cost
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ------------------------------------------------------------
-- 8. Onboarding readiness
--
-- Shown to the owner only while go_live is incomplete or recent. Early churn is
-- usually confusion rather than agent performance, so incomplete setup is made
-- visible to the client before it reads as a product failure.
--
-- Scored entirely from data already present. No new storage.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION report_readiness(p_client_id UUID)
RETURNS TABLE (item TEXT, done BOOLEAN, detail TEXT)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT 'Business hours',
         COALESCE((cs.booking_rules -> 'working_hours') <> '{}'::jsonb, FALSE),
         'Needed for after-hours reporting and booking'
  FROM client_settings cs WHERE cs.client_id = p_client_id
  UNION ALL
  SELECT 'Knowledge base',
         (SELECT COUNT(*) FROM faqs WHERE client_id = p_client_id AND active) >= 5,
         'At least five FAQs so the agent can answer common questions'
  UNION ALL
  SELECT 'Services and pricing',
         (SELECT COUNT(*) FROM services WHERE client_id = p_client_id AND active AND price IS NOT NULL) > 0,
         'Priced services let revenue be attributed to booked calls'
  UNION ALL
  SELECT 'Escalation contacts',
         COALESCE(array_length(cs.notification_emails, 1), 0) > 0,
         'Where handoffs and alerts are sent'
  FROM client_settings cs WHERE cs.client_id = p_client_id
  UNION ALL
  SELECT 'CRM connection',
         EXISTS (SELECT 1 FROM crm_connections WHERE client_id = p_client_id AND is_active),
         'Keeps contacts and bookings in sync'
  UNION ALL
  SELECT 'Billing baseline',
         COALESCE(cs.billing_baseline ->> 'monthly_cost', '') <> '',
         'Required before cost-per-appointment can be shown'
  FROM client_settings cs WHERE cs.client_id = p_client_id;
$$;
