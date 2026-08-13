-- 035: the business profile a client fills in about themselves.
--
-- Who the account belongs to and where the business is. Needed for three
-- things already in the product or being built alongside this: the billing
-- address on an invoice, the postal address on a booking confirmation, and a
-- named human to address an escalation to rather than "the account".
--
-- One JSONB column rather than eight scalar ones, following the `branding`
-- precedent set in 027. The fields are a grouped blob that is written whole by
-- one form and read whole by whoever needs it; nothing joins or filters on a
-- postal code, so eight columns would buy nothing and cost a migration every
-- time the form gains a field.
--
-- Shape (all optional, all strings):
--   contact_first_name, contact_last_name
--   address_line1, address_line2, city, region, postal_code, country
--
-- `region` rather than `state`: most of the world does not have states, and a
-- column named for one country's subdivision invites forms that only work
-- there. `country` holds an ISO 3166-1 alpha-2 code.
--
-- Validated in the API (business-profile.route.ts), not here — the same
-- reasoning 027 gives for primary_hex: a CHECK constraint cannot explain
-- itself to the person it rejects.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS business_profile JSONB NOT NULL DEFAULT '{}';

COMMENT ON COLUMN clients.business_profile IS
  'Client-supplied contact name and postal address. Written whole by the Settings > Business Profile form. Keys: contact_first_name, contact_last_name, address_line1, address_line2, city, region, postal_code, country (ISO 3166-1 alpha-2).';

-- Verification — abort rather than half-migrate, matching the house style.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'clients'
      AND column_name = 'business_profile'
  ) THEN
    RAISE EXCEPTION 'Migration 035: clients.business_profile was not created';
  END IF;
END $$;
