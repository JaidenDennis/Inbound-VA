-- ============================================================
-- GRAVVIA ENGAGE – Support operations: internal notes, SLA, auto-tickets
-- Run order: 019  (NEVER edit earlier migrations)
--
-- tickets/ticket_messages/ticket_status_history already exist (008), and 014
-- added contact_id/call_id/source. This migration adds what turns them from a
-- record into a queue: staff-only notes, response clocks, and the columns the
-- auto-ticket bridge in 017 needs.
-- ============================================================

-- ------------------------------------------------------------
-- Internal notes
--
-- Default 'client' is deliberate. Every message written before this migration
-- was visible to the client, so defaulting to 'internal' would retroactively
-- hide history that clients have already read. New writes always pass
-- visibility explicitly — see TicketService.addMessage.
-- ------------------------------------------------------------
ALTER TABLE ticket_messages ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'client';

ALTER TABLE ticket_messages DROP CONSTRAINT IF EXISTS ticket_messages_visibility_check;
ALTER TABLE ticket_messages ADD CONSTRAINT ticket_messages_visibility_check
  CHECK (visibility IN ('client', 'internal'));

-- The client thread query filters on this; a partial index keeps it cheap.
CREATE INDEX IF NOT EXISTS idx_ticket_messages_client_visible
  ON ticket_messages(ticket_id, created_at)
  WHERE visibility = 'client';

-- ------------------------------------------------------------
-- SLA clocks
--
-- Stored rather than computed on read so a priority change re-baselines the
-- deadline once, and the breach sweep is a plain indexed query instead of a
-- full scan with per-row arithmetic.
-- ------------------------------------------------------------
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS first_response_at       TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS resolved_at             TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sla_response_due_at     TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sla_resolution_due_at   TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sla_breached_at         TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS auto_closed_at          TIMESTAMPTZ;

-- Open tickets sorted by how close they are to breaching: the queue's default
-- ordering, so it prioritises itself.
CREATE INDEX IF NOT EXISTS idx_tickets_open_by_due
  ON tickets(sla_response_due_at)
  WHERE status IN ('investigating', 'waiting_on_client', 'waiting_on_third_party');

CREATE INDEX IF NOT EXISTS idx_tickets_assigned ON tickets(assigned_to)
  WHERE assigned_to IS NOT NULL;

-- ------------------------------------------------------------
-- Backfill deadlines for tickets that predate the SLA
--
-- Calendar hours, matching SLA_TARGETS in ticket.service.ts. Existing tickets
-- get a deadline measured from when they were created, so the queue is not
-- split between rows that have a clock and rows that never will.
-- ------------------------------------------------------------
UPDATE tickets SET
  sla_response_due_at = created_at + (CASE priority
    WHEN 'urgent' THEN INTERVAL '1 hour'
    WHEN 'high'   THEN INTERVAL '4 hours'
    WHEN 'normal' THEN INTERVAL '24 hours'
    ELSE               INTERVAL '3 days'
  END),
  sla_resolution_due_at = created_at + (CASE priority
    WHEN 'urgent' THEN INTERVAL '8 hours'
    WHEN 'high'   THEN INTERVAL '24 hours'
    WHEN 'normal' THEN INTERVAL '5 days'
    ELSE               INTERVAL '14 days'
  END)
WHERE sla_response_due_at IS NULL;

-- Tickets already closed should not sit in the queue looking overdue.
UPDATE tickets SET resolved_at = updated_at
WHERE status IN ('resolved', 'closed') AND resolved_at IS NULL;
