-- ============================================================
-- DATA (not a schema migration) — Harborview Apartments.
-- Creates the client (no apartment client existed) and configures it to run
-- the apartment_routing template under the workflow engine. Idempotent.
--
-- Note on the catalog: for an apartment community, `services` holds what can
-- be BOOKED (tour types) — not floor plans or fees. `pricing` holds FLOOR PLANS
-- AND RENT only, because every row is spoken as "starts around $X". Fixed fees
-- belong elsewhere: the application fee, administrative fee, and income
-- requirement come from `agent_config` (rendered under RENT AND FEES, stated
-- exactly), and every other fee lives in `business_policies` or `faqs`, which is
-- what knowledge_search reads. The template forbids describing a unit, a rent,
-- or a fee that is not in one of those sections.
--
-- All pricing is fictional demo data.
--
-- After running, PROVISION the agent:
--    npm run provision -- harborview-apartments --template=apartment_routing
-- ============================================================

-- 1. Ensure the client exists (idempotent).
INSERT INTO clients (name, slug, industry, timezone, phone_numbers, status)
VALUES ('Harborview Apartments', 'harborview-apartments', 'real_estate', 'America/New_York', '{}', 'active')
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, industry = EXCLUDED.industry;

-- 2. Ensure a settings row exists.
INSERT INTO client_settings (client_id)
SELECT id FROM clients WHERE slug = 'harborview-apartments'
ON CONFLICT (client_id) DO NOTHING;

-- 2b. Voice: a warm, clear voice to match "Avery". Only when unset, so a
-- voice chosen later in the dashboard is never stomped.
UPDATE clients SET retell_voice_id = '11labs-Adrian'
WHERE slug = 'harborview-apartments' AND retell_voice_id IS NULL;

-- 3. Identity + offerings + catalog.
UPDATE client_settings AS cs SET
  business_name        = 'Harborview Apartments',
  agent_name           = 'Avery',
  agent_personality    = 'warm, clear, and helpful',
  agent_tone           = 'friendly',
  agent_prompt         = '',
  booking_enabled      = true,
  notification_emails  = ARRAY['leasing@harborview.example'],
  agent_config = COALESCE(cs.agent_config, '{}'::jsonb) || jsonb_build_object(
    'workflow_routing', true,
    'tours_enabled', true,
    'self_guided_tours', true,
    'online_application_url', 'https://harborview.example/apply',
    'resident_portal_url', 'https://harborview.example/portal',
    'emergency_maintenance_line', '904-555-0142',
    'application_fee', 60,
    'admin_fee', 200,
    'income_requirement_multiple', 3,
    'pets_allowed', true
  ),
  services = '[
    {"name":"Guided Tour","description":"agent-led tour of available floor plans and amenities","duration_minutes":45,"price":0},
    {"name":"Self-Guided Tour","description":"tour the community on your own schedule using self-guided access","duration_minutes":45,"price":0},
    {"name":"Virtual Tour","description":"live video tour with a leasing agent","duration_minutes":30,"price":0},
    {"name":"Application Appointment","description":"meet with the leasing office to complete an application","duration_minutes":30,"price":0}
  ]'::jsonb,
  -- `pricing` renders under "FLOOR PLANS AND RENT" and every row is spoken as
  -- "starts around $X" — so it holds FLOOR PLANS ONLY. Fixed fees would both be
  -- misquoted as approximate and pollute the list the agent reads when a caller
  -- asks what is available. Fees live in agent_config (application, admin,
  -- income multiple → rendered under RENT AND FEES), business_policies, or faqs.
  pricing = '[
    {"name":"Studio — The Cove, 520 sq ft","price":1395,"unit":"month","notes":"as of today, subject to availability and change"},
    {"name":"1 Bedroom — The Marina, 715 sq ft","price":1595,"unit":"month","notes":"1 bedrooms range from about $1,595 to $1,750 depending on floor and view"},
    {"name":"2 Bedroom — The Harbor, 1,040 sq ft","price":2050,"unit":"month","notes":"2 bedrooms range from about $2,050 to $2,295"},
    {"name":"3 Bedroom — The Lighthouse, 1,310 sq ft","price":2650,"unit":"month","notes":"limited availability"}
  ]'::jsonb,
  business_policies = ARRAY[
    'The security deposit is $500 or one month''s rent, depending on the results of screening.',
    'The standard lease term is 12 months; 6, 9, and 18-month terms are also available at different rates.',
    'The published income requirement is gross monthly income of at least 3 times the monthly rent, verified during the application.',
    'The application fee is non-refundable and charged per adult applicant, 18 or older, and is paid with the online application.',
    'The administrative fee is a one-time charge collected at lease signing.',
    'Rent is due on the 1st of the month; a $75 late fee applies after the 5th.',
    'Residents must give 60 days'' written notice before vacating.',
    'Two pets are allowed per unit with a combined weight limit of 65 lbs; certain breeds are restricted as listed on the pet addendum. Service and assistance animals are not pets and are never subject to pet rent, pet fees, breed restrictions, or weight limits.',
    'One surface parking space is included per unit at no charge; an assigned garage space is $125 per month, subject to availability, and guest parking is clearly marked.',
    'Storage units are available for $45 per month, subject to availability.',
    'A month-to-month term after the initial lease adds a $300 per month premium to the rent.',
    'Packages are held in the parcel room and accessed with the resident app.',
    'Smoking is prohibited inside all units and within 25 feet of any building.',
    'The leasing office is open during posted office hours; a 24-hour emergency maintenance line is available after hours.',
    'Lease renewals are offered 90 days before the current lease ends.'
  ],
  faqs = '[
    {"question":"What do you have available?","answer":"Availability changes daily. As of today we have studios, 1, 2, and 3 bedroom floor plans — I can walk through pricing, or set up a tour so you can see what''s open.","category":"availability"},
    {"question":"How much is rent?","answer":"Studios start around $1,395, 1 bedrooms from about $1,595 to $1,750, 2 bedrooms from about $2,050 to $2,295, and 3 bedrooms start around $2,650. These are as of today and subject to availability and change.","category":"pricing"},
    {"question":"What''s included in rent?","answer":"Water, sewer, and trash are included as a flat $65 monthly utility fee. Electric is separate and billed directly to the resident.","category":"utilities"},
    {"question":"How do I apply?","answer":"You can apply online. Once submitted, applications are typically processed within 2 to 3 business days.","category":"application"},
    {"question":"What are the income and credit requirements?","answer":"Our published criteria require gross monthly income of at least 3 times the monthly rent, along with a credit and background check. I can''t say whether a specific applicant will be approved — the application will confirm.","category":"application"},
    {"question":"Do you allow pets?","answer":"Yes, up to two pets per unit with a 65 lb combined weight limit; some breeds are restricted. There is a $350 one-time pet fee plus $35 monthly pet rent. Service and assistance animals are not pets and are never charged a pet fee or held to a weight or breed limit.","category":"pets"},
    {"question":"Is there parking?","answer":"Yes, one surface parking space is included with every unit. Garage parking is available for an additional monthly fee, and guest parking is marked.","category":"parking"},
    {"question":"Can I tour in person?","answer":"Yes — I can book a guided tour with a leasing agent or a virtual tour by video.","category":"tours"},
    {"question":"Can I tour on my own?","answer":"Yes, self-guided tours are available so you can see the community on your own schedule.","category":"tours"},
    {"question":"What amenities are on site?","answer":"There is a pool, a fitness center, a dog park, and a business center.","category":"amenities"},
    {"question":"Is there a washer and dryer?","answer":"Yes, every unit has its own washer and dryer.","category":"amenities"},
    {"question":"What happens to packages?","answer":"Packages are held in the parcel room and residents access them with the resident app.","category":"amenities"},
    {"question":"What lease terms do you offer?","answer":"The standard term is 12 months. Shorter 6 and 9-month terms and an 18-month term are also available at different rates.","category":"lease"},
    {"question":"How do I submit a maintenance request?","answer":"Call in and I''ll collect your unit number and the issue, or submit it through the resident portal.","category":"maintenance"},
    {"question":"What counts as an emergency?","answer":"Things like active flooding, no heat or air in extreme weather, no power, or a door or lock that leaves your unit unsecured. For any of those, call the 24-hour emergency maintenance line right away.","category":"maintenance"},
    {"question":"How do I set up utilities?","answer":"Water, sewer, and trash are billed by us as a flat monthly fee. Electric is separate — you''ll set that up directly with the utility provider before move-in.","category":"utilities"}
  ]'::jsonb,
  booking_rules = COALESCE(cs.booking_rules, '{}'::jsonb) || jsonb_build_object(
    'advance_booking_hours', 2,
    'max_advance_booking_days', 30,
    'buffer_minutes', 15,
    'cancellation_notice_hours', 2,
    'cancellation_policy', 'Please give at least 2 hours'' notice to cancel or reschedule a tour.',
    'lead_qualification_fields', jsonb_build_array('move_in_date', 'bedrooms', 'budget'),
    'working_hours', jsonb_build_object(
      'monday',    jsonb_build_object('open', '09:00', 'close', '18:00'),
      'tuesday',   jsonb_build_object('open', '09:00', 'close', '18:00'),
      'wednesday', jsonb_build_object('open', '09:00', 'close', '18:00'),
      'thursday',  jsonb_build_object('open', '09:00', 'close', '18:00'),
      'friday',    jsonb_build_object('open', '09:00', 'close', '18:00'),
      'saturday',  jsonb_build_object('open', '10:00', 'close', '17:00'),
      'sunday',    jsonb_build_object('open', '12:00', 'close', '17:00')
    )
  )
WHERE cs.client_id = (SELECT id FROM clients WHERE slug = 'harborview-apartments');
