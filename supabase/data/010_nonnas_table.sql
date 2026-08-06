-- ============================================================
-- DATA (not a schema migration) — Nonna's Table.
-- Creates the client (no restaurant client existed) and configures it to run
-- the restaurant_routing template under the workflow engine. Idempotent.
--
-- Note on the catalog: for a restaurant, `services` holds what can be BOOKED or
-- ORDERED (reservation types, takeout, events) — not the menu. Menu facts live
-- in `faqs` and `pricing`, which is what knowledge_search reads. The template
-- forbids describing any dish that is not in one of those sections.
--
-- After running, PROVISION the agent:
--    npm run provision -- nonnas-table --template=restaurant_routing
-- ============================================================

-- 1. Ensure the client exists (idempotent).
INSERT INTO clients (name, slug, industry, timezone, phone_numbers, status)
VALUES ('Nonna''s Table', 'nonnas-table', 'restaurant', 'America/New_York', '{}', 'active')
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, industry = EXCLUDED.industry;

-- 2. Ensure a settings row exists.
INSERT INTO client_settings (client_id)
SELECT id FROM clients WHERE slug = 'nonnas-table'
ON CONFLICT (client_id) DO NOTHING;

-- 2b. Voice: a warm, hospitable male voice to match "Marco". Only when unset,
-- so a voice chosen later in the dashboard is never stomped.
UPDATE clients SET retell_voice_id = '11labs-Nico'
WHERE slug = 'nonnas-table' AND retell_voice_id IS NULL;

-- 3. Identity + offerings + catalog.
UPDATE client_settings AS cs SET
  business_name       = 'Nonna''s Table',
  agent_name          = 'Marco',
  agent_personality   = 'warm, upbeat, and hospitable',
  agent_tone          = 'friendly',
  agent_prompt        = '',
  booking_enabled     = true,
  notification_emails = ARRAY['host@nonnastable.example'],
  agent_config = COALESCE(cs.agent_config, '{}'::jsonb) || jsonb_build_object(
    'workflow_routing', true,
    'reservations_enabled', true,
    'takeout_enabled', true,
    'delivery_enabled', false,
    'private_events', true,
    -- Hard stop: parties larger than this are handed to the events team.
    'max_party_size', 8,
    'pronunciation_dictionary', jsonb_build_array(
      jsonb_build_object('word', 'Nonna''s', 'alphabet', 'ipa', 'phoneme', 'ˈnoʊnəz')
    )
  ),
  services = '[
    {"name":"Dinner Reservation","description":"table reservation for dinner service, parties of 1 to 8","duration_minutes":90,"price":0},
    {"name":"Weekend Brunch Reservation","description":"table reservation for Saturday and Sunday brunch","duration_minutes":75,"price":0},
    {"name":"Bar Seating","description":"first-come counter seating at the bar, no reservation needed","duration_minutes":90,"price":0},
    {"name":"Takeout Order","description":"phone order for pickup from the host stand","duration_minutes":30,"price":0},
    {"name":"Private Event Inquiry","description":"semi-private room or full buyout, handled by the events team","duration_minutes":60,"price":0}
  ]'::jsonb,
  pricing = '[
    {"name":"Antipasti","price":14,"notes":"starters range from about $14 to $19"},
    {"name":"Handmade Pasta","price":24,"notes":"pasta dishes range from about $24 to $32"},
    {"name":"Secondi (mains)","price":34,"notes":"mains range from about $34 to $48"},
    {"name":"Dolci (desserts)","price":12,"notes":"desserts are about $12"},
    {"name":"Chef''s Tasting Menu","price":85,"unit":"person","notes":"available Tuesday through Thursday; the whole table must participate"},
    {"name":"Weekend Brunch","price":22,"notes":"brunch plates range from about $18 to $28"}
  ]'::jsonb,
  business_policies = ARRAY[
    'Reservations are held for 15 minutes past the booked time, after which the table may be released.',
    'Parties of 9 or more are booked by our events team, not over the phone.',
    'Please give at least 4 hours'' notice to cancel or change a reservation. Parties of 6 or more that no-show are charged $25 per guest.',
    'Dress code is smart casual. Jackets are not required.',
    'We welcome children and have a kids menu; high chairs and booster seats are available.',
    'Well-behaved dogs are welcome on the patio only, weather permitting.',
    'We have a free parking lot behind the building, plus metered street parking on Elm.',
    'The dining room and restrooms are fully wheelchair accessible.',
    'Corkage is $30 per bottle, limit two bottles per table.',
    'Takeout orders are placed by phone and picked up at the host stand. We do not deliver and we do not partner with any delivery service.',
    'Gift cards are sold in person and on our website in any amount.',
    'We do not split checks more than four ways.'
  ],
  faqs = '[
    {"question":"What kind of food do you serve?","answer":"Northern Italian — handmade pasta, wood-fired mains, and a short seasonal menu that changes every few weeks.","category":"menu"},
    {"question":"How much is dinner?","answer":"Starters run about $14 to $19, pasta about $24 to $32, and mains about $34 to $48. There is also a chef''s tasting menu at $85 per person, Tuesday through Thursday.","category":"pricing"},
    {"question":"Do you have vegetarian options?","answer":"Yes, there are vegetarian dishes in every section of the menu. If you have an allergy or a strict dietary restriction, let us know when you book and mention it again to your server so the chef can speak with you directly.","category":"menu"},
    {"question":"Do you have gluten-free pasta?","answer":"Please tell us when you book and mention it again to your server. Only the chef can confirm what is possible for a specific restriction, and they will come speak with you at the table.","category":"menu"},
    {"question":"Do you take reservations?","answer":"Yes, for parties of 1 to 8. Parties of 9 or more are booked through our events team.","category":"reservations"},
    {"question":"Can we just walk in?","answer":"The bar seats about a dozen on a first-come basis, and we usually have room on weeknights. Weekends fill up, so a reservation is safer.","category":"reservations"},
    {"question":"Do you deliver?","answer":"We do not deliver, and we are not on any delivery app. Takeout is available for pickup at the host stand.","category":"takeout"},
    {"question":"Do you do private events?","answer":"Yes. We have a semi-private room that seats 22, and full buyouts are possible. Our events team handles all the details — I can take your information and have them reach out.","category":"events"},
    {"question":"Is there parking?","answer":"Yes, there is a free lot behind the building plus metered street parking on Elm.","category":"logistics"},
    {"question":"Are you open on Mondays?","answer":"We are closed Mondays. We serve dinner Tuesday through Sunday, and brunch on Saturday and Sunday.","category":"hours"},
    {"question":"Do you have a dress code?","answer":"Smart casual — no jacket required.","category":"logistics"},
    {"question":"Can we bring our own wine?","answer":"Yes, corkage is $30 a bottle with a two-bottle limit per table.","category":"logistics"},
    {"question":"Are you kid friendly?","answer":"Very. We have a kids menu, high chairs, and boosters.","category":"logistics"}
  ]'::jsonb,
  booking_rules = COALESCE(cs.booking_rules, '{}'::jsonb) || jsonb_build_object(
    'advance_booking_hours', 1,
    'max_advance_booking_days', 60,
    'buffer_minutes', 0,
    'cancellation_notice_hours', 4,
    'cancellation_policy', 'Please give at least 4 hours'' notice to cancel or change a reservation. Parties of 6 or more that no-show are charged $25 per guest.',
    'lead_qualification_fields', jsonb_build_array('party_size', 'occasion', 'dietary_notes'),
    -- Closed Mondays. Brunch and dinner run as one open window on weekends.
    'working_hours', jsonb_build_object(
      'tuesday',   jsonb_build_object('open', '17:00', 'close', '22:00'),
      'wednesday', jsonb_build_object('open', '17:00', 'close', '22:00'),
      'thursday',  jsonb_build_object('open', '17:00', 'close', '22:00'),
      'friday',    jsonb_build_object('open', '17:00', 'close', '23:00'),
      'saturday',  jsonb_build_object('open', '10:00', 'close', '23:00'),
      'sunday',    jsonb_build_object('open', '10:00', 'close', '21:00')
    )
  )
WHERE cs.client_id = (SELECT id FROM clients WHERE slug = 'nonnas-table');
