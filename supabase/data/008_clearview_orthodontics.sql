-- ============================================================
-- DATA (not a schema migration) — Clearview Orthodontics.
-- Creates the client (no orthodontic client existed) and configures it to run
-- the orthodontic_routing template under the workflow engine. Idempotent.
--
-- After running, PROVISION the agent:
--    npm run provision -- clearview-orthodontics --template=orthodontic_routing
-- ============================================================

-- 1. Ensure the client exists (idempotent).
INSERT INTO clients (name, slug, industry, timezone, phone_numbers, status)
VALUES ('Clearview Orthodontics', 'clearview-orthodontics', 'orthodontic', 'America/Denver', '{}', 'active')
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, industry = EXCLUDED.industry;

-- 2. Ensure a settings row exists.
INSERT INTO client_settings (client_id)
SELECT id FROM clients WHERE slug = 'clearview-orthodontics'
ON CONFLICT (client_id) DO NOTHING;

-- 2b. Voice: a bright, encouraging female voice to match "Maya" — this practice
-- talks to teens and their parents. Only when unset, so a voice chosen later in
-- the dashboard is never stomped.
UPDATE clients SET retell_voice_id = '11labs-Chloe'
WHERE slug = 'clearview-orthodontics' AND retell_voice_id IS NULL;

-- 3. Identity + offerings + catalog.
UPDATE client_settings AS cs SET
  business_name       = 'Clearview Orthodontics',
  agent_name          = 'Maya',
  agent_personality   = 'warm and encouraging',
  agent_tone          = 'friendly',
  agent_prompt        = '',
  booking_enabled     = true,
  notification_emails = ARRAY['front-desk@clearviewortho.example'],
  agent_config = COALESCE(cs.agent_config, '{}'::jsonb) || jsonb_build_object(
    'workflow_routing', true,
    'free_consultation', true,
    'financing_available', true,
    'emergency_same_day', true,
    'treatment_types', jsonb_build_array(
      'metal braces', 'ceramic (clear) braces', 'clear aligners', 'retainers', 'early (Phase I) treatment'
    ),
    'insurance_accepted', jsonb_build_array(
      'Delta Dental', 'Cigna', 'Aetna', 'MetLife', 'Guardian'
    ),
    'new_patient_special', jsonb_build_object(
      'name', 'Complimentary Smile Consultation',
      'description', 'exam, digital scan, and a written treatment plan with exact costs — no obligation'
    ),
    'intake_questions', jsonb_build_array(
      'Is the appointment for you or for your child?',
      'What is the patient''s name and age?',
      'Has the patient had an orthodontic consultation before?',
      'Do you have orthodontic benefits we should verify?'
    )
  ),
  services = '[
    {"name":"Complimentary Smile Consultation","description":"exam, digital scan, and a written treatment plan with exact costs","duration_minutes":45,"price":0},
    {"name":"Metal Braces","description":"traditional braces, full treatment","duration_minutes":90,"price":4800},
    {"name":"Ceramic Braces","description":"tooth-colored braces, full treatment","duration_minutes":90,"price":5600},
    {"name":"Clear Aligners","description":"removable clear aligner treatment, full course","duration_minutes":60,"price":5400},
    {"name":"Early (Phase I) Treatment","description":"limited treatment for growing children, typically ages 7-10","duration_minutes":60,"price":2900},
    {"name":"Adjustment Visit","description":"routine wire change or aligner check during treatment","duration_minutes":30,"price":0},
    {"name":"Repair Visit","description":"same-day fix for a broken bracket, loose band, or poking wire","duration_minutes":30,"price":0},
    {"name":"Retainer Replacement","description":"replacement retainer, per arch","duration_minutes":30,"price":275},
    {"name":"Retainer Check","description":"post-treatment retention check","duration_minutes":20,"price":0}
  ]'::jsonb,
  pricing = '[
    {"name":"Metal Braces","price":4800,"notes":"full treatment; exact figure comes from the treatment plan at the consultation"},
    {"name":"Ceramic Braces","price":5600,"notes":"full treatment; exact figure confirmed at the consultation"},
    {"name":"Clear Aligners","price":5400,"notes":"full course; exact figure confirmed at the consultation"},
    {"name":"Early (Phase I) Treatment","price":2900,"notes":"limited treatment; credited toward full treatment if it is needed later"},
    {"name":"Retainer Replacement","price":275,"unit":"arch","notes":"no consultation needed"}
  ]'::jsonb,
  business_policies = ARRAY[
    'The initial consultation is complimentary and includes an exam, a digital scan, and a written treatment plan — there is no obligation.',
    'For a patient under 18, a parent or guardian must attend the consultation.',
    'Monthly payment plans are available with no interest, and a down payment is arranged at the start of treatment.',
    'Cancellations or changes need 24 hours'' notice.',
    'Broken brackets and poking wires are seen in same-day repair slots — call as soon as it happens.',
    'Please arrive 10 minutes early for a first visit to complete paperwork, and bring an insurance card and photo ID.'
  ],
  faqs = '[
    {"question":"How much does treatment cost?","answer":"Most treatment starts around $4,800, and clear aligners start around $5,400. You get an exact figure in writing at the consultation, along with the monthly payment options.","category":"pricing"},
    {"question":"Is the consultation really free?","answer":"Yes. The exam, the digital scan, and the written treatment plan are all complimentary, with no obligation.","category":"pricing"},
    {"question":"Do you offer payment plans?","answer":"Yes, we offer interest-free monthly payment plans. The treatment coordinator builds the plan with you at the consultation.","category":"pricing"},
    {"question":"At what age should my child be seen?","answer":"The American Association of Orthodontists suggests a first check around age seven. Often the advice at that visit is simply to check back in a year.","category":"general"},
    {"question":"Am I too old for braces?","answer":"Not at all. We treat adults regularly, and clear aligners and ceramic braces are popular options for adults.","category":"general"},
    {"question":"How long does treatment take?","answer":"It depends entirely on the individual bite. The orthodontist gives you a specific timeline at the consultation.","category":"general"},
    {"question":"A bracket broke. What do I do?","answer":"That happens more often than you would think, and it will not set treatment back. Call us and we will get you into a same-day repair slot.","category":"urgent"},
    {"question":"I lost my retainer.","answer":"Come in soon — teeth can shift quickly without a retainer. A replacement is $275 per arch and does not need a consultation.","category":"urgent"},
    {"question":"Do you take my insurance?","answer":"We accept orthodontic benefits from Delta Dental, Cigna, Aetna, MetLife, and Guardian. We verify your exact benefits before treatment starts.","category":"insurance"},
    {"question":"Do you offer clear aligners?","answer":"Yes. Whether aligners or braces fit best depends on the bite, and the orthodontist determines that at the consultation.","category":"general"}
  ]'::jsonb,
  booking_rules = COALESCE(cs.booking_rules, '{}'::jsonb) || jsonb_build_object(
    'advance_booking_hours', 12,
    'max_advance_booking_days', 120,
    'buffer_minutes', 10,
    'cancellation_notice_hours', 24,
    'cancellation_policy', 'Cancellations or changes need 24 hours'' notice.',
    'lead_qualification_fields', jsonb_build_array('patient_name', 'patient_age', 'treatment_interest'),
    'working_hours', jsonb_build_object(
      'monday',    jsonb_build_object('open', '08:00', 'close', '17:00'),
      'tuesday',   jsonb_build_object('open', '08:00', 'close', '17:00'),
      'wednesday', jsonb_build_object('open', '10:00', 'close', '19:00'),
      'thursday',  jsonb_build_object('open', '08:00', 'close', '17:00'),
      'friday',    jsonb_build_object('open', '08:00', 'close', '15:00')
    )
  )
WHERE cs.client_id = (SELECT id FROM clients WHERE slug = 'clearview-orthodontics');
