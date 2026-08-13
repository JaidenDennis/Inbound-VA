-- 034: operational action items become a work-queue kind.
--
-- Migration 033 split `client_action_items` into 'onboarding' and 'operations'
-- so the Onboarding page could stop listing ongoing work. That left the
-- operational half with nowhere to appear: the Onboarding page filters it out,
-- and nothing else read the table.
--
-- The Work Queue is where a person goes to find what needs doing, so the items
-- join it as a kind rather than getting a page of their own. That inherits the
-- queue's filtering, per-kind counts, and close path for free.
--
-- The queue's governing rule is that EVERY KIND MUST BE CLOSABLE. An action
-- item closes by moving to status 'done', a column it already has — so unlike
-- the derived kinds it needs no queue_dismissals row.
--
-- The five existing branches below are reproduced VERBATIM from 025, generated
-- from that file rather than retyped. The calendar_conflict branch in
-- particular carries a hard-won ordering rule (start time decides, id only
-- breaks exact ties) that replaced a version silently missing about half of all
-- double-bookings; paraphrasing it would reintroduce that.
--
-- Depends on: 025 (manager_queue), 033 (category column).

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
    )

  UNION ALL

  -- Ongoing work someone raised against the account. Onboarding steps are
  -- excluded by category: those belong to the bounded pre-go-live sequence on
  -- the Onboarding page, not to the queue a manager works every day.
  SELECT
    'action_item',
    ai.id::TEXT,
    ai.client_id,
    ai.created_at,
    ai.title,
    COALESCE(ai.description, ''),
    EXTRACT(EPOCH FROM (NOW() - ai.created_at))::BIGINT,
    NULL::UUID,
    -- Nothing on an action item records urgency, so age stands in for it: a
    -- task sitting a week is the one worth surfacing. Inventing a severity
    -- column would claim more than the data supports.
    CASE WHEN NOW() - ai.created_at > INTERVAL '7 days' THEN 'fair' ELSE 'good' END,
    ai.id::TEXT
  FROM client_action_items ai
  WHERE ai.status = 'pending'
    AND ai.category = 'operations';
