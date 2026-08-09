-- ============================================================
-- GRAVVIA ENGAGE – Phase F: threshold alerting and white-label branding
-- Run order: 027  (NEVER edit earlier migrations)
--
-- Two unrelated features share a migration because both are small, additive,
-- and land in the same phase. They are separated below and roll back
-- independently.
--
-- 1. client_alert_rules + client_alert_events
--
-- The dashboard answers "what happened" to whoever opens it. Most owners do not
-- open it — the design doc's own framing — so a containment collapse or a dead
-- CRM sync sits unnoticed until someone complains. Alerting is the half of the
-- product that works when nobody is looking.
--
-- Rules are per tenant and per metric. Firing is recorded in its own table
-- rather than in audit_logs: audit_logs answers "who did this", and nobody did
-- this. It also gives the console a history to render, which is what makes an
-- alert loop trustworthy — an alert you cannot confirm was sent is a rumour.
--
-- 2. clients.branding
--
-- Scoped deliberately narrowly. See the header on the branding section.
--
-- Rollback: supabase/rollbacks/027_alerting_and_branding_rollback.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1a. Alert rules
--
-- One row per (client, metric). A tenant does not need two containment rules;
-- they need one with the right threshold, and allowing two means two emails.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_alert_rules (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- The four the design asks for. Each has a fixed direction, encoded in the
  -- evaluator rather than stored: "containment above 90%" is not an alert
  -- anybody wants, and a comparator column invites configuring one.
  metric            TEXT NOT NULL,

  threshold         NUMERIC NOT NULL,

  -- How far back the evaluator looks. Short windows make a single bad call look
  -- like a collapse; long ones report yesterday's problem tomorrow.
  window_minutes    INTEGER NOT NULL DEFAULT 1440,

  -- The anti-nag control. Without it a persisting condition emails every time
  -- the sweep runs — every 5 minutes — and the recipient filters the sender.
  cooldown_minutes  INTEGER NOT NULL DEFAULT 1440,

  enabled           BOOLEAN NOT NULL DEFAULT true,

  -- Empty means "use the client's notification_emails". Stored rather than
  -- resolved so a tenant can route alerts somewhere other than booking notices.
  recipients        TEXT[] NOT NULL DEFAULT '{}',

  last_fired_at     TIMESTAMPTZ,
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (client_id, metric),

  CONSTRAINT alert_metric_known CHECK (
    metric IN ('containment_drop', 'integration_down', 'escalation_spike', 'missed_revenue')
  ),
  CONSTRAINT alert_window_sane   CHECK (window_minutes BETWEEN 5 AND 43200),
  CONSTRAINT alert_cooldown_sane CHECK (cooldown_minutes BETWEEN 5 AND 43200)
);

CREATE INDEX IF NOT EXISTS idx_alert_rules_client ON client_alert_rules(client_id);
-- The sweep's own query: enabled rules, cheapest possible scan.
CREATE INDEX IF NOT EXISTS idx_alert_rules_enabled ON client_alert_rules(enabled) WHERE enabled;

DROP TRIGGER IF EXISTS trg_alert_rules_updated_at ON client_alert_rules;
CREATE TRIGGER trg_alert_rules_updated_at
  BEFORE UPDATE ON client_alert_rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ------------------------------------------------------------
-- 1b. What actually fired
--
-- `observed` is stored beside `threshold` so a past alert can be read without
-- re-deriving the figure from data that has since moved on.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_alert_events (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rule_id       UUID REFERENCES client_alert_rules(id) ON DELETE SET NULL,
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  metric        TEXT NOT NULL,
  observed      NUMERIC,
  threshold     NUMERIC,
  message       TEXT NOT NULL,
  -- Whether the notification actually went out. `mailer.ts` degrades to a
  -- logged no-op without SMTP_PASS, so "we decided to alert" and "an email was
  -- sent" are genuinely different facts and both are worth keeping.
  notified      BOOLEAN NOT NULL DEFAULT false,
  recipients    TEXT[] NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_events_client ON client_alert_events(client_id, created_at DESC);

-- ------------------------------------------------------------
-- 2. Branding
--
-- WHY THIS IS NARROWER THAN IT SOUNDS
-- DESIGN.md reserves chroma for state: green, amber and red mean good, fair and
-- bad, and interactive affordance is achromatic precisely so a call-to-action
-- can never be misread as a healthy row. A client-supplied accent in the lamp
-- hue range destroys the one rule the whole palette derives from.
--
-- So branding covers what cannot collide with state:
--   logo_url       replaces the monogram tile in the rail
--   wordmark_text  replaces the product name in the header
--   primary_hex    the login panel and the digest email header, nowhere else
--
-- primary_hex is validated in the service (branding.service.ts), not here: the
-- rule is a hue-range test, and a CHECK constraint doing colour maths in SQL
-- would be both unreadable and unable to explain itself to the person it
-- rejects.
-- ------------------------------------------------------------
ALTER TABLE clients ADD COLUMN IF NOT EXISTS branding JSONB NOT NULL DEFAULT '{}';

-- ------------------------------------------------------------
-- 3. Verification — abort rather than half-migrate
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'client_alert_rules'
  ) THEN
    RAISE EXCEPTION 'Migration 027: client_alert_rules was not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'client_alert_events'
  ) THEN
    RAISE EXCEPTION 'Migration 027: client_alert_events was not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'clients' AND column_name = 'branding'
  ) THEN
    RAISE EXCEPTION 'Migration 027: clients.branding was not added';
  END IF;

  -- The uniqueness is the anti-duplicate-email rule, so it is asserted rather
  -- than trusted.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'client_alert_rules' AND c.contype = 'u'
  ) THEN
    RAISE EXCEPTION 'Migration 027: client_alert_rules is missing its per-metric unique constraint';
  END IF;

  -- A metric the evaluator does not know about would sit enabled and silent.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'alert_metric_known'
  ) THEN
    RAISE EXCEPTION 'Migration 027: metric allowlist constraint missing';
  END IF;
END $$;
