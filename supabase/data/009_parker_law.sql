-- ============================================================
-- DATA (not a schema migration) — Parker & Associates Law.
-- Configures the EXISTING seeded client (slug 'parker-law') to run the
-- law_firm_routing template under the workflow engine. Idempotent.
--
-- Two deliberate changes to the seed.sql defaults:
--   * booking_enabled flipped to TRUE. The old note ("always require a human
--     attorney before booking") predates intake routing; the template already
--     forbids legal advice and escalates anything time-sensitive, so booking
--     the consultation is the right outcome.
--   * agent_prompt cleared — it would otherwise be appended verbatim as
--     ADDITIONAL CLIENT INSTRUCTIONS and contradict the template.
--
-- After running, RE-PROVISION the agent:
--    npm run provision -- parker-law --template=law_firm_routing
-- ============================================================

-- 1. Ensure the client exists (idempotent; already present in seed.sql).
INSERT INTO clients (name, slug, industry, timezone, phone_numbers, status)
VALUES ('Parker & Associates Law', 'parker-law', 'legal', 'America/Chicago', '{}', 'active')
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, industry = EXCLUDED.industry;

-- 2. Ensure a settings row exists.
INSERT INTO client_settings (client_id)
SELECT id FROM clients WHERE slug = 'parker-law'
ON CONFLICT (client_id) DO NOTHING;

-- 2b. Voice: a composed, measured female voice to match "Diane" — callers are
-- often in distress and need steadiness, not brightness. Only when unset, so a
-- voice chosen later in the dashboard is never stomped.
UPDATE clients SET retell_voice_id = '11labs-Kathrine'
WHERE slug = 'parker-law' AND retell_voice_id IS NULL;

-- 3. Identity + offerings + catalog.
UPDATE client_settings AS cs SET
  business_name       = 'Parker & Associates Law',
  agent_name          = 'Diane',
  agent_personality   = 'composed, discreet, and reassuring',
  agent_tone          = 'calm and professional',
  agent_prompt        = '',
  booking_enabled     = true,
  notification_emails = ARRAY['intake@parkerlaw.example', 'managing@parkerlaw.example'],
  agent_config = COALESCE(cs.agent_config, '{}'::jsonb) || jsonb_build_object(
    'workflow_routing', true,
    'free_case_evaluation', true,
    'contingency_fee', true,
    'financing_available', true,
    -- The closed set of matters. Anything outside this is declined with a bar
    -- referral, never stretched to fit.
    'practice_areas', jsonb_build_array(
      'personal injury', 'car and truck accidents', 'slip and fall',
      'workers compensation', 'wrongful death',
      'family law and divorce', 'child custody',
      'estate planning and probate', 'employment disputes'
    ),
    'intake_questions', jsonb_build_array(
      'What kind of matter is this?',
      'When did it happen, or when were you notified?',
      'Do you already have an attorney for this matter?',
      'Who is the other party involved?'
    )
  ),
  services = '[
    {"name":"Free Case Evaluation","description":"initial consultation with an attorney to review your situation and explain options","duration_minutes":45,"price":0},
    {"name":"Personal Injury Representation","description":"car and truck accidents, slip and fall, and wrongful death matters","duration_minutes":60,"price":0},
    {"name":"Workers Compensation Claim","description":"representation for a workplace injury claim","duration_minutes":60,"price":0},
    {"name":"Family Law Consultation","description":"divorce, custody, and support matters","duration_minutes":60,"price":300},
    {"name":"Estate Planning Package","description":"will, powers of attorney, and healthcare directive","duration_minutes":60,"price":1500},
    {"name":"Probate Administration","description":"administering an estate through probate","duration_minutes":60,"price":2500},
    {"name":"Employment Dispute Consultation","description":"wrongful termination, discrimination, and wage claims","duration_minutes":60,"price":250}
  ]'::jsonb,
  pricing = '[
    {"name":"Free Case Evaluation","price":0,"notes":"no cost and no obligation for any matter"},
    {"name":"Personal Injury Representation","price":0,"notes":"handled on contingency for qualifying matters; whether it applies to your case is confirmed by the attorney"},
    {"name":"Family Law Consultation","price":300,"notes":"published starting point; the arrangement is set by the attorney"},
    {"name":"Estate Planning Package","price":1500,"notes":"published starting point; varies with the estate"},
    {"name":"Probate Administration","price":2500,"notes":"published starting point; varies with the estate"},
    {"name":"Employment Dispute Consultation","price":250,"notes":"published starting point; credited toward representation if the firm takes the matter"}
  ]'::jsonb,
  business_policies = ARRAY[
    'The initial case evaluation is free and carries no obligation.',
    'Nothing said on an intake call creates an attorney-client relationship. The firm must complete a conflicts check before anyone can represent you.',
    'For a consultation, please bring any documents you have received — police reports, correspondence, court papers, or an insurance letter.',
    'If you have been served with papers or have a court date within the next few days, tell us immediately so we can route you to an attorney right away.',
    'Existing clients: questions about an active matter go directly to your attorney, not through intake.',
    'Consultations are available in person, by phone, or by video.'
  ],
  faqs = '[
    {"question":"How much does it cost to talk to an attorney?","answer":"The initial case evaluation is completely free, and there is no obligation.","category":"fees"},
    {"question":"Do I pay anything up front for an injury case?","answer":"For qualifying injury matters the firm works on contingency, which means no fee unless we recover for you. Whether that applies to your situation is confirmed by the attorney.","category":"fees"},
    {"question":"What should I bring to my consultation?","answer":"Anything you have received in writing — a police report, correspondence, court papers, or a letter from an insurance company.","category":"logistics"},
    {"question":"Can the consultation be over the phone?","answer":"Yes. Consultations are available in person, by phone, or by video.","category":"logistics"},
    {"question":"What kinds of cases do you handle?","answer":"Personal injury including car and truck accidents, slip and fall, and wrongful death; workers compensation; family law and custody; estate planning and probate; and employment disputes.","category":"general"},
    {"question":"How long will my case take?","answer":"That depends entirely on the matter, and it is one of the first things the attorney will walk you through at the consultation.","category":"general"},
    {"question":"I already have a lawyer. Can you take over?","answer":"Generally the firm cannot step in while another attorney represents you. Let me take your details and have a team member call you back to talk it through.","category":"general"},
    {"question":"Do you speak Spanish?","answer":"Yes, we have Spanish-speaking staff available.","category":"logistics"},
    {"question":"Where are you located?","answer":"Our office is downtown with validated garage parking, and it is fully wheelchair accessible.","category":"logistics"}
  ]'::jsonb,
  booking_rules = COALESCE(cs.booking_rules, '{}'::jsonb) || jsonb_build_object(
    'advance_booking_hours', 4,
    'max_advance_booking_days', 45,
    'buffer_minutes', 15,
    'cancellation_notice_hours', 24,
    'cancellation_policy', 'Please give 24 hours'' notice if you need to reschedule your consultation.',
    'lead_qualification_required', true,
    'lead_qualification_fields', jsonb_build_array('matter_type', 'date_of_incident', 'has_existing_counsel', 'opposing_party'),
    'working_hours', jsonb_build_object(
      'monday',    jsonb_build_object('open', '08:30', 'close', '17:30'),
      'tuesday',   jsonb_build_object('open', '08:30', 'close', '17:30'),
      'wednesday', jsonb_build_object('open', '08:30', 'close', '17:30'),
      'thursday',  jsonb_build_object('open', '08:30', 'close', '17:30'),
      'friday',    jsonb_build_object('open', '08:30', 'close', '16:00')
    )
  )
WHERE cs.client_id = (SELECT id FROM clients WHERE slug = 'parker-law');
