-- ============================================================
-- GRAVVIA ENGAGE – per-client FAQ category list
-- Run order: 031  (NEVER edit earlier migrations)
--
-- faqs.category is free text today, so every client invents their own spelling
-- and the console offers no guidance. The list becomes data, managed by staff
-- per client, and the client picks from it.
--
-- DELIBERATELY NOT a foreign key on faqs. knowledge.service.ts:133 reads
-- `r.category` straight into the agent prompt payload and is the only consumer;
-- keeping the denormalised NAME on faqs means no FK migration against live rows
-- and no change to prompt building. The cost is rename handling, which the
-- PATCH route pays explicitly by updating matching faqs rows in the same call.
--
-- Rollback: supabase/rollbacks/031_knowledge_categories_rollback.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS knowledge_categories (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id  UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_knowledge_categories_client_name
  ON knowledge_categories(client_id, name);

CREATE INDEX IF NOT EXISTS idx_knowledge_categories_client
  ON knowledge_categories(client_id);

DROP TRIGGER IF EXISTS trg_knowledge_categories_updated_at ON knowledge_categories;
CREATE TRIGGER trg_knowledge_categories_updated_at
  BEFORE UPDATE ON knowledge_categories FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE knowledge_categories ENABLE ROW LEVEL SECURITY;
