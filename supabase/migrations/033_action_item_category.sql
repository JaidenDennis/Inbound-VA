-- 033: give action items a category, so Onboarding stops showing operational work.
--
-- `client_action_items` has carried every kind of task a person needs to do for
-- a tenant since 008 — onboarding steps, follow-ups from a call, one-off asks.
-- The Onboarding page lists the table unfiltered, so an operational item
-- created weeks after go-live appears as though the client were still being
-- onboarded, and the Work Queue never shows it at all.
--
-- 'operations' is the default deliberately. Onboarding is the narrow, bounded
-- case: a fixed set of steps that happen once, before go-live. Everything else
-- is ongoing work, so the default keeps existing rows out of Onboarding, which
-- is where they were wrongly appearing.

ALTER TABLE client_action_items
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'operations';

-- Named so a later migration can alter it; an anonymous CHECK is awkward to
-- change and this list will grow (a 'billing' category is already foreseeable).
ALTER TABLE client_action_items
  DROP CONSTRAINT IF EXISTS client_action_items_category_check;

ALTER TABLE client_action_items
  ADD CONSTRAINT client_action_items_category_check
  CHECK (category IN ('onboarding', 'operations'));

-- The two reads this column exists to serve are both "one client, one
-- category, pending first", so the index carries status too.
CREATE INDEX IF NOT EXISTS idx_action_items_client_category
  ON client_action_items(client_id, category, status);

COMMENT ON COLUMN client_action_items.category IS
  'onboarding = a pre-go-live step shown on the Onboarding page; operations = ongoing work shown in the Work Queue. Defaults to operations.';
