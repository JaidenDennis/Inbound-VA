-- ============================================================
-- GRAVVIA ENGAGE – billing records
-- Run order: 036  (NEVER edit earlier migrations)
--
-- THERE IS NO PAYMENT PROVIDER IN THIS SYSTEM YET. No Stripe, no Paddle, no
-- dependency, no webhook, no adapter. That is a deliberate stage: the decision
-- taken on 2026-08-13 was to build the wiring now and connect Stripe later.
--
-- So these tables are the shape the product needs, populated by staff in the
-- meantime, and designed so a provider slots in BEHIND them rather than
-- replacing them:
--
--   `provider`     'manual' today, 'stripe' once connected. Every row says
--                  where it came from, so a reconciliation can tell an
--                  imported charge from a hand-entered one.
--   `provider_ref` the provider's own id, null while manual. Unique per
--                  provider so an idempotent webhook cannot double-insert.
--
-- The alternative — a Billing screen backed by figures computed in the UI —
-- was rejected. A customer believes what a billing page tells them, so a
-- fabricated next-payment date is worse than an empty tab. The UI reads these
-- tables and shows nothing when they are empty.
--
-- Money is stored in minor units as an INTEGER (cents), never a float. A
-- binary float cannot represent 0.10 exactly, and the error compounds across a
-- payment history until a total is visibly wrong.
--
-- Rollback: supabase/rollbacks/036_billing_rollback.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1. Subscriptions — one current arrangement per client
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_subscriptions (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- UNIQUE: a client has one current subscription. History lives in payments;
  -- modelling plan changes as multiple rows would make "what do they pay now?"
  -- a query with an ordering rule instead of a lookup.
  client_id             UUID NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE,

  plan_name             TEXT NOT NULL,
  amount_cents          INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency              TEXT NOT NULL DEFAULT 'USD' CHECK (char_length(currency) = 3),
  billing_interval      TEXT NOT NULL DEFAULT 'month'
                        CHECK (billing_interval IN ('month', 'year')),

  status                TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('trialing', 'active', 'past_due', 'cancelled')),

  -- The date the customer is actually asked about: "when is my next payment?"
  current_period_end    DATE,
  -- A cancellation that takes effect at the end of the paid period is not the
  -- same as one that already happened, and the customer needs to see which.
  cancel_at_period_end  BOOLEAN NOT NULL DEFAULT FALSE,

  provider              TEXT NOT NULL DEFAULT 'manual'
                        CHECK (provider IN ('manual', 'stripe')),
  provider_ref          TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial: many rows will share provider='manual' with a NULL ref, and NULLs
-- must not collide. Only a real provider id has to be unique.
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_provider_ref
  ON client_subscriptions(provider, provider_ref)
  WHERE provider_ref IS NOT NULL;

-- ------------------------------------------------------------
-- 2. Payments — what was actually charged
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_payments (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id      UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  paid_at        TIMESTAMPTZ NOT NULL,
  amount_cents   INTEGER NOT NULL,
  currency       TEXT NOT NULL DEFAULT 'USD' CHECK (char_length(currency) = 3),
  status         TEXT NOT NULL DEFAULT 'paid'
                 CHECK (status IN ('paid', 'refunded', 'failed')),
  description    TEXT,

  -- Card details as the customer recognises them. NEVER a full number: this
  -- system is not, and must not become, a place cardholder data is stored.
  -- Brand and last four are what a person needs to identify which card paid.
  method_brand   TEXT,
  method_last4   TEXT CHECK (method_last4 IS NULL OR char_length(method_last4) = 4),

  invoice_url    TEXT,

  provider       TEXT NOT NULL DEFAULT 'manual'
                 CHECK (provider IN ('manual', 'stripe')),
  provider_ref   TEXT,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_client_paid
  ON client_payments(client_id, paid_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_provider_ref
  ON client_payments(provider, provider_ref)
  WHERE provider_ref IS NOT NULL;

-- ------------------------------------------------------------
-- 3. Where billing notices go
-- ------------------------------------------------------------
-- On client_settings, which is this product's home for per-tenant settings
-- (see 032's note: business_policies lives there, not on `clients`).
--
-- Separate from `notification_emails`: the person who wants to know a booking
-- came in is rarely the person who wants to know a card was declined, and
-- sending both to one list means one of them stops reading.
ALTER TABLE client_settings
  ADD COLUMN IF NOT EXISTS billing_notification_email TEXT;

COMMENT ON COLUMN client_settings.billing_notification_email IS
  'Where payment and invoice notices go. Separate from notification_emails, which is operational alerting.';

-- ------------------------------------------------------------
-- 4. Verification — abort rather than half-migrate
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'client_subscriptions'
  ) THEN
    RAISE EXCEPTION 'Migration 036: client_subscriptions was not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'client_payments'
  ) THEN
    RAISE EXCEPTION 'Migration 036: client_payments was not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'client_settings'
      AND column_name = 'billing_notification_email'
  ) THEN
    RAISE EXCEPTION 'Migration 036: client_settings.billing_notification_email was not created';
  END IF;
END $$;
