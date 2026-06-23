-- ============================================================
-- GRAVVIA ENGAGE – Seed Data for Development
-- ============================================================

-- Default super admin user — email: admin@gravvia.com  password: Admin1234!
-- Hash generated with bcryptjs rounds=10 and verified with bcrypt.compare.
-- >>> CHANGE THIS PASSWORD before production use. <<<
INSERT INTO users (email, name, password_hash, role, is_active) VALUES
  ('admin@gravvia.com', 'Gravvia Admin', '$2a$10$mQBESsnBYVga4spwLLR2W.IJBqmBjxEo6L6L6awMGlXtl/JMgu/EG', 'super_admin', true)
ON CONFLICT (email) DO UPDATE
  SET password_hash = EXCLUDED.password_hash, is_active = true;

-- Sample Clients
INSERT INTO clients (id, name, slug, industry, timezone, phone_numbers, status, retell_agent_id) VALUES
  ('a1b2c3d4-0000-0000-0000-000000000001', 'Bright Smile Dental', 'bright-smile-dental', 'dental', 'America/New_York', ARRAY['+12125550100'], 'active', NULL),
  ('a1b2c3d4-0000-0000-0000-000000000002', 'Serenity Med Spa', 'serenity-med-spa', 'medical', 'America/Los_Angeles', ARRAY['+13105550200'], 'active', NULL),
  ('a1b2c3d4-0000-0000-0000-000000000003', 'Parker & Associates Law', 'parker-law', 'legal', 'America/Chicago', ARRAY['+13125550300'], 'active', NULL)
ON CONFLICT DO NOTHING;

-- Sample Client Settings
INSERT INTO client_settings (
  client_id, agent_prompt, agent_personality, agent_tone,
  booking_enabled, booking_rules, notification_emails, crm_type
) VALUES
  (
    'a1b2c3d4-0000-0000-0000-000000000001',
    'You are a friendly receptionist for Bright Smile Dental. Help patients book appointments, answer FAQs about our services, and transfer to a live person when needed.',
    'warm',
    'friendly',
    true,
    '{"advance_booking_hours":24,"max_advance_booking_days":60,"buffer_minutes":15,"working_hours":{"monday":{"open":"09:00","close":"17:00"},"tuesday":{"open":"09:00","close":"17:00"},"wednesday":{"open":"09:00","close":"17:00"},"thursday":{"open":"09:00","close":"17:00"},"friday":{"open":"09:00","close":"15:00"}},"blackout_dates":[],"lead_qualification_required":false,"lead_qualification_fields":[]}',
    ARRAY['team@brightsmiledental.com'],
    'gohighlevel'
  ),
  (
    'a1b2c3d4-0000-0000-0000-000000000002',
    'You are a professional assistant for Serenity Med Spa. Help clients learn about our treatments and book consultations.',
    'professional',
    'calm',
    true,
    '{"advance_booking_hours":48,"max_advance_booking_days":90,"buffer_minutes":30,"working_hours":{"tuesday":{"open":"10:00","close":"19:00"},"wednesday":{"open":"10:00","close":"19:00"},"thursday":{"open":"10:00","close":"19:00"},"friday":{"open":"10:00","close":"19:00"},"saturday":{"open":"10:00","close":"16:00"}},"blackout_dates":[],"lead_qualification_required":true,"lead_qualification_fields":["first_name","email"]}',
    ARRAY['info@serenityspa.com'],
    'hubspot'
  ),
  (
    'a1b2c3d4-0000-0000-0000-000000000003',
    'You are a professional intake specialist for Parker & Associates. Always require a human attorney to speak with prospective clients before booking.',
    'formal',
    'authoritative',
    false,
    '{"advance_booking_hours":0,"max_advance_booking_days":0,"buffer_minutes":0,"working_hours":{},"blackout_dates":[],"lead_qualification_required":true,"lead_qualification_fields":["case_type","urgency"]}',
    ARRAY['intake@parkerlaw.com', 'managing@parkerlaw.com'],
    'salesforce'
  )
ON CONFLICT DO NOTHING;

-- Sample Contact
INSERT INTO contacts (client_id, first_name, last_name, phone, email, tags) VALUES
  ('a1b2c3d4-0000-0000-0000-000000000001', 'John', 'Smith', '+19175550101', 'john.smith@example.com', ARRAY['new-patient']),
  ('a1b2c3d4-0000-0000-0000-000000000002', 'Maria', 'Garcia', '+13235550202', 'maria@example.com', ARRAY['vip'])
ON CONFLICT DO NOTHING;
