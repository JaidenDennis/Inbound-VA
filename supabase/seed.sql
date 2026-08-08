-- ============================================================
-- GRAVVIA ENGAGE – Seed Data for DEVELOPMENT ONLY
-- ============================================================
--
--   >>> NEVER RUN THIS AGAINST A PRODUCTION DATABASE. <<<
--
-- This file creates an admin account whose password is published in this repo,
-- plus three fake clients. It exists so a local dev database is usable in one
-- command. For production, run supabase/setup.sql instead and create your admin
-- with the (commented) block at the end of that file.
--
-- The guard below aborts unless you explicitly opt in, because the previous
-- version of this file used ON CONFLICT DO UPDATE on the admin row — meaning
-- running it against production would have silently RESET a real admin's
-- password back to the public default. That footgun is now removed twice over:
-- the guard stops the whole script, and the insert is ON CONFLICT DO NOTHING.
--
-- To seed a development database, run this first in the same session:
--     SET LOCAL gravvia.allow_dev_seed = 'yes';
-- ============================================================

DO $$
BEGIN
  IF coalesce(current_setting('gravvia.allow_dev_seed', true), '') <> 'yes' THEN
    RAISE EXCEPTION
      'Refusing to run dev seed. This creates an admin with a PUBLIC password. If this is a development database, run: SET LOCAL gravvia.allow_dev_seed = ''yes''; first.';
  END IF;
END $$;

-- Development super admin — email: admin@gravvia.com  password: Admin1234!
-- Hash generated with bcryptjs rounds=10 and verified with bcrypt.compare.
-- DO NOTHING (never DO UPDATE) so this can never overwrite a real password.
INSERT INTO users (email, name, password_hash, role, is_active) VALUES
  ('admin@gravvia.com', 'Gravvia Admin', '$2a$10$mQBESsnBYVga4spwLLR2W.IJBqmBjxEo6L6L6awMGlXtl/JMgu/EG', 'super_admin', true)
ON CONFLICT (email) DO NOTHING;

-- Sample Clients
--
-- phone_numbers is deliberately EMPTY. These rows previously carried reserved
-- fiction numbers (+1212555xxxx). Two of these slugs are also used by the real
-- vertical demo seeds in supabase/data/, whose ON CONFLICT clause does not touch
-- phone_numbers — so the fake numbers survived onto live demo clients and the
-- dashboard displayed them as though a number were assigned. Nothing in Retell
-- ever mapped to them, which made the console disagree with the provider.
--
-- A number belongs here only once it exists in Retell. Migration 021 clears the
-- historical values from any database that already ran this file.
INSERT INTO clients (id, name, slug, industry, timezone, phone_numbers, status, retell_agent_id) VALUES
  ('a1b2c3d4-0000-0000-0000-000000000001', 'Bright Smile Dental', 'bright-smile-dental', 'dental', 'America/New_York', '{}', 'active', NULL),
  ('a1b2c3d4-0000-0000-0000-000000000002', 'Serenity Med Spa', 'serenity-med-spa', 'medical', 'America/Los_Angeles', '{}', 'active', NULL),
  ('a1b2c3d4-0000-0000-0000-000000000003', 'Parker & Associates Law', 'parker-law', 'legal', 'America/Chicago', '{}', 'active', NULL)
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
