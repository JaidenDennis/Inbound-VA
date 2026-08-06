-- Company name on contacts. Inbound voice callers are individuals, but
-- outbound/enriched leads (Clay) are B2B prospects whose company is the
-- primary thing a rep sorts and searches on — and it is the one field the CRM
-- contact record has that we had nowhere to store.
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS company TEXT;

CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company);
