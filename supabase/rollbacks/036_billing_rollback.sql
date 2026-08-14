-- Rollback for 036_billing.sql
--
-- DESTRUCTIVE. These tables hold the only record of what a client was charged
-- while billing is staff-entered — there is no payment provider behind them to
-- re-import from. Export client_payments before running this if any row has
-- provider = 'manual', because those rows exist nowhere else.
--
-- Once Stripe is connected, provider='stripe' rows can be re-imported from the
-- provider and this becomes safe for them; the manual ones never will be.

DROP TABLE IF EXISTS client_payments;
DROP TABLE IF EXISTS client_subscriptions;

ALTER TABLE client_settings
  DROP COLUMN IF EXISTS billing_notification_email;

-- client_action_items keeps its RLS: it predates this migration, was missing it
-- by oversight, and disabling it here would open a table 036 never created.
