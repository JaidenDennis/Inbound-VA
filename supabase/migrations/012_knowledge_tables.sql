-- ============================================================
-- GRAVVIA ENGAGE – Relational knowledge tables (inbound Phase 2)
-- Run order: 012  (NEVER edit earlier migrations)
--
-- services / pricing / faqs / promotions become first-class rows so
-- knowledge.search can query them and the dashboard can CRUD them per client.
--
-- ADDITIVE ONLY: the existing client_settings JSONB columns (services,
-- pricing, faqs) are locked and untouched. The backend reads RELATIONAL-FIRST
-- with JSONB FALLBACK, so existing clients keep working with no data
-- migration; rows here take precedence once created.
-- ============================================================

CREATE TABLE IF NOT EXISTS services (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id        UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  price            NUMERIC(10,2),
  category         TEXT,
  active           BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(client_id, name)
);

CREATE INDEX IF NOT EXISTS idx_services_client        ON services(client_id);
CREATE INDEX IF NOT EXISTS idx_services_client_active ON services(client_id, active);

CREATE TABLE IF NOT EXISTS pricing (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  service_id    UUID REFERENCES services(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  price         NUMERIC(10,2) NOT NULL,
  member_price  NUMERIC(10,2),
  unit          TEXT,
  notes         TEXT,
  upsell_note   TEXT,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pricing_client        ON pricing(client_id);
CREATE INDEX IF NOT EXISTS idx_pricing_client_active ON pricing(client_id, active);
CREATE INDEX IF NOT EXISTS idx_pricing_service       ON pricing(service_id);

CREATE TABLE IF NOT EXISTS faqs (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id  UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  question   TEXT NOT NULL,
  answer     TEXT NOT NULL,
  category   TEXT,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_faqs_client        ON faqs(client_id);
CREATE INDEX IF NOT EXISTS idx_faqs_client_active ON faqs(client_id, active);

CREATE TABLE IF NOT EXISTS promotions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  eligibility TEXT,
  starts_at   TIMESTAMPTZ,
  ends_at     TIMESTAMPTZ,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_promotions_client        ON promotions(client_id);
CREATE INDEX IF NOT EXISTS idx_promotions_client_active ON promotions(client_id, active);

-- updated_at triggers (reuse update_updated_at() from 001).
DROP TRIGGER IF EXISTS trg_services_updated_at ON services;
CREATE TRIGGER trg_services_updated_at
  BEFORE UPDATE ON services FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_pricing_updated_at ON pricing;
CREATE TRIGGER trg_pricing_updated_at
  BEFORE UPDATE ON pricing FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_faqs_updated_at ON faqs;
CREATE TRIGGER trg_faqs_updated_at
  BEFORE UPDATE ON faqs FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_promotions_updated_at ON promotions;
CREATE TRIGGER trg_promotions_updated_at
  BEFORE UPDATE ON promotions FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS: same defense-in-depth posture as other tables (see 008 header).
ALTER TABLE services   ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing    ENABLE ROW LEVEL SECURITY;
ALTER TABLE faqs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS services_tenant_select ON services;
CREATE POLICY services_tenant_select ON services
  FOR SELECT TO authenticated
  USING (client_id::text = COALESCE(auth.jwt() ->> 'client_id', ''));
DROP POLICY IF EXISTS pricing_tenant_select ON pricing;
CREATE POLICY pricing_tenant_select ON pricing
  FOR SELECT TO authenticated
  USING (client_id::text = COALESCE(auth.jwt() ->> 'client_id', ''));
DROP POLICY IF EXISTS faqs_tenant_select ON faqs;
CREATE POLICY faqs_tenant_select ON faqs
  FOR SELECT TO authenticated
  USING (client_id::text = COALESCE(auth.jwt() ->> 'client_id', ''));
DROP POLICY IF EXISTS promotions_tenant_select ON promotions;
CREATE POLICY promotions_tenant_select ON promotions
  FOR SELECT TO authenticated
  USING (client_id::text = COALESCE(auth.jwt() ->> 'client_id', ''));
