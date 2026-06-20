-- ============================================================
-- DATA (not a schema migration) — THIS client's settings.
-- Sets Bare Beauty Medspa / Emily identity + offerings that drive the med-spa
-- template's upsell rules. Idempotent.
--
-- ⚠️ I do not know your live client_id, so this targets slug
--    'bare-beauty-medspa' and CREATES the client if missing (so it runs as-is).
--    If "this client" already exists under a different slug/id, change the slug
--    below (and the catalog/emails) to match your real record.
--
-- After running, RE-PROVISION the agent so the new prompt + function URLs apply:
--    POST /clients/:id/provision      (or call provisioningService.provisionClient)
-- ============================================================

-- 1. Ensure the client exists (idempotent).
INSERT INTO clients (name, slug, industry, timezone, phone_numbers, status)
VALUES ('Bare Beauty Medspa', 'bare-beauty-medspa', 'beauty', 'America/New_York', '{}', 'active')
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name;

-- 2. Ensure a settings row exists.
INSERT INTO client_settings (client_id)
SELECT id FROM clients WHERE slug = 'bare-beauty-medspa'
ON CONFLICT (client_id) DO NOTHING;

-- 3. Identity + offerings + example catalog (replace examples with real data).
UPDATE client_settings AS cs SET
  business_name       = 'Bare Beauty Medspa',
  agent_name          = 'Emily',
  agent_personality   = 'warm and caring',
  agent_tone          = 'friendly',
  booking_enabled     = true,
  notification_emails = ARRAY['front-desk@barebeauty.example'],
  -- Offerings here gate which upsells the agent may mention (reusable per client).
  agent_config = jsonb_build_object(
    'membership_program', jsonb_build_object('name', 'Bare Glow Membership', 'description', 'monthly facials + member pricing'),
    'offers_packages', true,
    'offers_prp', true,
    'free_consultation', true
  ),
  -- Example service catalog (prices are starting points; replace with real data).
  services = '[
    {"name":"Botox","description":"wrinkle-relaxing injectable","duration_minutes":30,"price":300},
    {"name":"Hydrafacial","description":"deep-cleansing facial treatment","duration_minutes":50,"price":200},
    {"name":"Microneedling","description":"collagen-induction therapy","duration_minutes":60,"price":350},
    {"name":"Laser Hair Removal","description":"laser hair reduction, per area","duration_minutes":30,"price":150},
    {"name":"Body Contouring","description":"non-invasive fat reduction","duration_minutes":60,"price":600},
    {"name":"Consultation","description":"personalized treatment planning","duration_minutes":30,"price":0}
  ]'::jsonb,
  pricing = '[
    {"name":"Botox","price":12,"unit":"unit","notes":"final amount confirmed at consultation"},
    {"name":"Hydrafacial","price":200,"notes":"per session; membership pricing available"},
    {"name":"Microneedling","price":350,"notes":"PRP enhancement optional"},
    {"name":"Laser Hair Removal","price":150,"unit":"area","notes":"packages available"},
    {"name":"Body Contouring","price":600,"notes":"varies by area; consultation required"}
  ]'::jsonb,
  booking_rules = cs.booking_rules || '{"lead_qualification_fields":["skin_concern"]}'::jsonb
WHERE cs.client_id = (SELECT id FROM clients WHERE slug = 'bare-beauty-medspa');
