-- ============================================================
-- DATA (not a schema migration) — Bright Smile Dental.
-- Configures the EXISTING seeded client (slug 'bright-smile-dental') to run the
-- dental_routing template under the workflow engine. Idempotent.
--
-- The client and its settings row already exist from supabase/seed.sql; this
-- fills in the agent identity, catalog, and offering flags the dental template
-- renders its prompt from. Nothing here is client-specific in code.
--
-- After running, RE-PROVISION the agent so the new prompt + function URLs apply:
--    npm run provision -- bright-smile-dental --template=dental_routing
-- ============================================================

-- 1. Ensure the client exists (idempotent; already present in seed.sql).
INSERT INTO clients (name, slug, industry, timezone, phone_numbers, status)
VALUES ('Bright Smile Dental', 'bright-smile-dental', 'dental', 'America/New_York', '{}', 'active')
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, industry = EXCLUDED.industry;

-- 2. Ensure a settings row exists.
INSERT INTO client_settings (client_id)
SELECT id FROM clients WHERE slug = 'bright-smile-dental'
ON CONFLICT (client_id) DO NOTHING;

-- 2b. Voice: a calm, experienced-sounding female voice to match "Sophie".
-- Only when unset, so a voice chosen later in the dashboard is never stomped.
UPDATE clients SET retell_voice_id = '11labs-Grace'
WHERE slug = 'bright-smile-dental' AND retell_voice_id IS NULL;

-- 3. Identity + offerings + catalog.
UPDATE client_settings AS cs SET
  business_name       = 'Bright Smile Dental',
  agent_name          = 'Sophie',
  agent_personality   = 'warm and reassuring',
  agent_tone          = 'friendly',
  -- Legacy single-prompt instruction from seed.sql would be appended verbatim as
  -- ADDITIONAL CLIENT INSTRUCTIONS and contradict the template. Clear it.
  agent_prompt        = '',
  booking_enabled     = true,
  notification_emails = ARRAY['front-desk@brightsmiledental.example'],
  -- Offering flags gate what the dental template's prompt may offer.
  agent_config = COALESCE(cs.agent_config, '{}'::jsonb) || jsonb_build_object(
    'workflow_routing', true,
    'emergency_same_day', true,
    'financing_available', true,
    'insurance_accepted', jsonb_build_array(
      'Delta Dental', 'Cigna', 'Aetna', 'MetLife', 'Guardian', 'United Concordia'
    ),
    'new_patient_special', jsonb_build_object(
      'name', 'New Patient Exam & X-Rays',
      'description', 'comprehensive exam, full X-ray series, and a cleaning',
      'price', 99
    ),
    'intake_questions', jsonb_build_array(
      'What brings you in?',
      'Are you currently in any pain?',
      'When was your last dental visit?',
      'Do you have dental insurance we should verify ahead of your visit?'
    )
  ),
  services = '[
    {"name":"New Patient Exam & X-Rays","description":"comprehensive exam, full X-ray series, and a cleaning for new patients","duration_minutes":60,"price":99},
    {"name":"Routine Cleaning","description":"hygiene cleaning and exam for returning patients","duration_minutes":45,"price":140},
    {"name":"Deep Cleaning","description":"scaling and root planing for gum disease, per quadrant","duration_minutes":60,"price":320},
    {"name":"Emergency Exam","description":"same-day visit for dental pain, swelling, or a broken tooth","duration_minutes":30,"price":95},
    {"name":"Tooth-Colored Filling","description":"composite filling to repair a cavity","duration_minutes":45,"price":230},
    {"name":"Crown","description":"full-coverage crown to restore a damaged tooth","duration_minutes":90,"price":1250},
    {"name":"Root Canal","description":"endodontic treatment to save an infected tooth","duration_minutes":90,"price":1100},
    {"name":"Extraction","description":"routine tooth removal","duration_minutes":45,"price":275},
    {"name":"Teeth Whitening","description":"in-office professional whitening","duration_minutes":60,"price":450},
    {"name":"Veneers","description":"porcelain veneers, per tooth","duration_minutes":90,"price":1400},
    {"name":"Dental Implant Consultation","description":"evaluation and planning for a single-tooth implant","duration_minutes":45,"price":0}
  ]'::jsonb,
  pricing = '[
    {"name":"New Patient Exam & X-Rays","price":99,"notes":"new patients only; includes a cleaning when no gum treatment is needed"},
    {"name":"Routine Cleaning","price":140,"notes":"most insurance plans cover this at or near 100%"},
    {"name":"Deep Cleaning","price":320,"unit":"quadrant","notes":"final plan confirmed after the exam"},
    {"name":"Emergency Exam","price":95,"notes":"applied toward treatment done the same day"},
    {"name":"Tooth-Colored Filling","price":230,"notes":"varies by tooth and surface count"},
    {"name":"Crown","price":1250,"notes":"payment plans available"},
    {"name":"Root Canal","price":1100,"notes":"front teeth cost less than molars; confirmed at the exam"},
    {"name":"Teeth Whitening","price":450,"notes":"take-home trays available for less"},
    {"name":"Veneers","price":1400,"unit":"tooth","notes":"consultation required"}
  ]'::jsonb,
  business_policies = ARRAY[
    'New patients: please arrive 15 minutes early to complete paperwork, and bring a photo ID and your insurance card.',
    'Cancellations or changes need 24 hours'' notice; a $50 fee applies to missed appointments.',
    'We are in-network with most major PPO plans and file claims for you; exact coverage is verified before your visit.',
    'Payment is due at the time of service. CareCredit and in-house payment plans are available for treatment over $500.',
    'Same-day emergency slots are held each morning for patients in pain.'
  ],
  faqs = '[
    {"question":"Are you accepting new patients?","answer":"Yes, we are always accepting new patients, and we usually have openings within the week.","category":"general"},
    {"question":"Do you take my insurance?","answer":"We are in-network with most major PPO plans including Delta Dental, Cigna, Aetna, MetLife, Guardian, and United Concordia. We verify your exact benefits before your visit.","category":"insurance"},
    {"question":"What if I do not have insurance?","answer":"No problem at all. Our new patient exam with X-rays and a cleaning is $99, and we offer payment plans for larger treatment.","category":"insurance"},
    {"question":"How often should I come in?","answer":"Most patients come in twice a year for a cleaning and exam, though the dentist may suggest a different schedule after your visit.","category":"general"},
    {"question":"Do you see children?","answer":"Yes, we see patients of all ages, starting from about age three.","category":"general"},
    {"question":"I have not been to a dentist in years. Is that a problem?","answer":"Not at all, and you are in very good company. No one here will make you feel bad about it. We will start with an exam and go at your pace.","category":"general"},
    {"question":"Do you offer sedation?","answer":"We offer nitrous oxide for patients who feel anxious. The dentist will talk through what is right for you at your visit.","category":"general"},
    {"question":"Where are you located and is there parking?","answer":"We have a free parking lot on site, and the office is fully wheelchair accessible.","category":"logistics"}
  ]'::jsonb,
  booking_rules = COALESCE(cs.booking_rules, '{}'::jsonb) || jsonb_build_object(
    'advance_booking_hours', 12,
    'max_advance_booking_days', 90,
    'buffer_minutes', 15,
    'cancellation_notice_hours', 24,
    'cancellation_policy', 'Cancellations or changes need 24 hours'' notice; a $50 fee applies to missed appointments.',
    'lead_qualification_fields', jsonb_build_array('reason_for_visit', 'insurance_provider'),
    -- 24h storage ("HH:mm"); the prompt renders these as friendly 12-hour times.
    'working_hours', jsonb_build_object(
      'monday',    jsonb_build_object('open', '08:00', 'close', '17:00'),
      'tuesday',   jsonb_build_object('open', '08:00', 'close', '17:00'),
      'wednesday', jsonb_build_object('open', '08:00', 'close', '17:00'),
      'thursday',  jsonb_build_object('open', '08:00', 'close', '17:00'),
      'friday',    jsonb_build_object('open', '08:00', 'close', '14:00')
    )
  )
WHERE cs.client_id = (SELECT id FROM clients WHERE slug = 'bright-smile-dental');
