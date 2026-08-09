-- ============================================================
-- GRAVVIA ENGAGE – Enterprise dashboard: manager work queue
-- Run order: 025  (NEVER edit earlier migrations)
--
-- A work queue, not a report. The design's governing rule is the acceptance
-- criterion: EVERY ITEM ON THIS SCREEN MUST BE CLOSABLE. If a manager cannot act
-- on it, it belongs in the owner view. `manager-queue.test.ts` enforces that by
-- iterating the kind list and asserting each one has a close path.
--
-- FIVE SOURCES, UNIONED — the same shape migration 017 uses for system_activity.
-- None of the underlying tables gain new writes.
--
-- TWO CORRECTIONS TO THE DESIGN, both found by reading production:
--
--   1. There is no `booking.failed` event. The event vocabulary is
--      booking.requested/confirmed/cancelled/rescheduled (event.types.ts:7-10).
--      Booking failures land in `failed_jobs` via the BullMQ terminal-failure
--      path, so that is what this view reads.
--
--   2. `failed_jobs` HAS NO client_id. Tenant scope lives in
--      job_data->>'clientId'. A view that forgot this would show one tenant's
--      failed bookings to another, so the cast is done once here rather than at
--      each call site, and indexed.
--
-- Rollback: supabase/rollbacks/025_manager_queue_rollback.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1. Dismissals
--
-- Three of the five kinds have their own close state already:
--   flagged_call        -> call_records.reviewed_at   (023)
--   unreturned_callback -> callback_requests.status   (014)
--   failed_booking      -> failed_jobs.status         (001)
--
-- The other two are derived rather than stored — an escalation with no ticket,
-- and a pair of overlapping appointments — so there is nowhere to record "a
-- human looked at this and it is fine". Without that, a conflict a manager has
-- already resolved by phone reappears every morning and the queue trains people
-- to ignore it.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS queue_dismissals (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('untouched_escalation', 'calendar_conflict')),
  ref_id       TEXT NOT NULL,
  note         TEXT,
  dismissed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, kind, ref_id)
);

CREATE INDEX IF NOT EXISTS idx_queue_dismissals_lookup
  ON queue_dismissals(client_id, kind, ref_id);

ALTER TABLE queue_dismissals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS queue_dismissals_tenant_select ON queue_dismissals;
CREATE POLICY queue_dismissals_tenant_select ON queue_dismissals
  FOR SELECT TO authenticated
  USING (client_id::text = COALESCE(auth.jwt() ->> 'client_id', ''));

-- Tenant scope for failed_jobs is a JSONB expression; index it so the queue does
-- not table-scan every failed job in the platform per tenant.
CREATE INDEX IF NOT EXISTS idx_failed_jobs_client
  ON failed_jobs ((job_data ->> 'clientId'), status);

CREATE INDEX IF NOT EXISTS idx_calls_transferred
  ON calls (client_id, started_at DESC) WHERE status = 'transferred';

-- ------------------------------------------------------------
-- 2. The queue
--
-- `age_seconds` is computed here rather than in the API so ordering, filtering
-- and the breach styling all agree on one clock.
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW manager_queue AS
  -- Flagged calls: the agent struggled and a human should hear it.
  SELECT
    'flagged_call'::TEXT                                  AS kind,
    r.id::TEXT                                            AS id,
    r.client_id,
    r.started_at                                          AS occurred_at,
    'Flagged call'::TEXT                                  AS title,
    COALESCE(array_to_string(r.flag_reasons, ', '), '')   AS detail,
    EXTRACT(EPOCH FROM (NOW() - r.started_at))::BIGINT    AS age_seconds,
    NULL::UUID                                            AS assignee_id,
    CASE WHEN 'wrong_information' = ANY(r.flag_reasons) THEN 'bad' ELSE 'fair' END AS severity,
    r.retell_call_id                                      AS ref
  FROM call_records r
  WHERE r.flagged AND r.reviewed_at IS NULL

  UNION ALL

  -- The design's stated worst failure mode: a promise the agent made and a human
  -- did not keep. Invisible everywhere else in the product.
  SELECT
    'unreturned_callback',
    cb.id::TEXT,
    cb.client_id,
    cb.created_at,
    'Callback promised to ' || cb.caller_name,
    COALESCE(cb.reason, '') || CASE WHEN cb.preferred_time IS NOT NULL
      THEN ' (wants: ' || cb.preferred_time || ')' ELSE '' END,
    EXTRACT(EPOCH FROM (NOW() - cb.created_at))::BIGINT,
    NULL::UUID,
    -- A promise older than a day is the thing most likely to lose a customer.
    CASE WHEN NOW() - cb.created_at > INTERVAL '24 hours' THEN 'bad' ELSE 'fair' END,
    cb.phone
  FROM callback_requests cb
  WHERE cb.status = 'pending'

  UNION ALL

  -- Booking jobs that exhausted their retries. Read from failed_jobs, not from
  -- an event: no booking.failed event exists.
  SELECT
    'failed_booking',
    fj.id::TEXT,
    (fj.job_data ->> 'clientId')::UUID,
    fj.created_at,
    'Booking failed',
    fj.error_message,
    EXTRACT(EPOCH FROM (NOW() - fj.created_at))::BIGINT,
    NULL::UUID,
    CASE WHEN fj.status = 'manual_review' THEN 'bad' ELSE 'fair' END,
    fj.job_id
  FROM failed_jobs fj
  WHERE fj.queue_name = 'booking'
    AND fj.status IN ('failed', 'manual_review')
    AND fj.job_data ->> 'clientId' IS NOT NULL

  UNION ALL

  -- A caller was handed to a human and nothing was opened to track it.
  SELECT
    'untouched_escalation',
    c.id::TEXT,
    c.client_id,
    c.started_at,
    'Transferred call with no ticket',
    COALESCE(c.from_number, 'unknown caller'),
    EXTRACT(EPOCH FROM (NOW() - c.started_at))::BIGINT,
    NULL::UUID,
    'fair',
    c.from_number
  FROM calls c
  WHERE c.status = 'transferred'
    AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.call_id = c.id)
    AND NOT EXISTS (
      SELECT 1 FROM queue_dismissals d
      WHERE d.client_id = c.client_id AND d.kind = 'untouched_escalation' AND d.ref_id = c.id::TEXT
    )

  UNION ALL

  -- Double-booked staff. Self-join on the same staff member, so a client with no
  -- staff_member_id set never produces a conflict rather than producing one for
  -- every overlapping pair.
  SELECT
    'calendar_conflict',
    a.id::TEXT,
    a.client_id,
    a.start_time,
    'Double-booked: ' || a.title,
    'Overlaps ' || b.title || ' at ' || to_char(b.start_time, 'YYYY-MM-DD HH24:MI'),
    EXTRACT(EPOCH FROM (NOW() - a.start_time))::BIGINT,
    a.staff_member_id,
    'bad',
    b.id::TEXT
  FROM appointments a
  JOIN appointments b
    ON b.client_id = a.client_id
   AND b.staff_member_id = a.staff_member_id
   AND b.id <> a.id
   -- Half-open comparison: an appointment ending exactly when the next begins is
   -- back-to-back, not a conflict.
   AND b.start_time < a.end_time
   AND b.end_time   > a.start_time
   -- Emit each pair exactly once, from the earlier appointment.
   --
   -- ONE ordering rule, not two. An earlier version combined
   -- `a.start_time <= b.start_time` with `a.id < b.id`; because UUIDs are
   -- random, any pair whose earlier appointment held the higher id satisfied
   -- neither direction and vanished — silently missing about half of all
   -- double-bookings. Start time decides, with the id only breaking exact ties.
   AND (a.start_time < b.start_time OR (a.start_time = b.start_time AND a.id < b.id))
  WHERE a.staff_member_id IS NOT NULL
    AND a.status IN ('pending', 'confirmed')
    AND b.status IN ('pending', 'confirmed')
    AND NOT EXISTS (
      SELECT 1 FROM queue_dismissals d
      WHERE d.client_id = a.client_id AND d.kind = 'calendar_conflict' AND d.ref_id = a.id::TEXT
    );

-- ------------------------------------------------------------
-- 3. Pulse — today against the same weekday last week
--
-- Enough context to notice a break, not a second analytics surface. Same
-- weekday, not yesterday: Monday against Sunday is noise for most of these
-- businesses.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION report_pulse(p_client_id UUID)
RETURNS TABLE (
  metric        TEXT,
  today         BIGINT,
  same_day_last_week BIGINT
)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE
  v_tz    TEXT;
  v_today DATE;
BEGIN
  SELECT COALESCE(timezone, 'UTC') INTO v_tz FROM clients WHERE id = p_client_id;
  v_today := (NOW() AT TIME ZONE v_tz)::DATE;

  RETURN QUERY
  SELECT 'calls'::TEXT,
    COUNT(*) FILTER (WHERE (started_at AT TIME ZONE v_tz)::DATE = v_today),
    COUNT(*) FILTER (WHERE (started_at AT TIME ZONE v_tz)::DATE = v_today - 7)
  FROM call_records WHERE client_id = p_client_id
  UNION ALL
  SELECT 'appointments',
    COUNT(*) FILTER (WHERE (created_at AT TIME ZONE v_tz)::DATE = v_today),
    COUNT(*) FILTER (WHERE (created_at AT TIME ZONE v_tz)::DATE = v_today - 7)
  FROM appointments
  WHERE client_id = p_client_id AND status IN ('confirmed', 'completed');
END;
$$;
