/**
 * DEMO client seed: Mike's Plumbing. Upserts the client + settings so the agent
 * can be provisioned from the vertical-neutral `inbound_routing` template.
 *   DOTENV_CONFIG_PATH=../.env npx tsx scripts/seed-mikes-plumbing.ts
 * Then provision (routing) with:
 *   ... WEBHOOK_BASE_URL=https://inbound-va.onrender.com API_BASE_URL=... \
 *   npm run routing:enable -- mikes-plumbing --provision
 */
import 'dotenv/config';
import { supabase } from '../src/db/index.js';

const BUSINESS = "Mike's Plumbing";
const AGENT_NAME = 'Jamie'; // scheduling assistant / dispatcher (Mike is the owner)

async function main(): Promise<void> {
  const { data: client, error: cErr } = await supabase
    .from('clients')
    .upsert(
      {
        name: BUSINESS,
        slug: 'mikes-plumbing',
        industry: 'home_services',
        timezone: 'America/New_York',
        phone_numbers: [],
        status: 'active',
      },
      { onConflict: 'slug' }
    )
    .select()
    .single();
  if (cErr) throw new Error(`client upsert: ${cErr.message}`);

  const services = [
    { name: 'Drain Cleaning', description: 'clear clogged sinks, tubs, and main lines', duration_minutes: 60, price: 150 },
    { name: 'Water Heater Repair', description: 'diagnose and repair gas or electric water heaters', duration_minutes: 90, price: 250 },
    { name: 'Water Heater Installation', description: 'supply and install a new water heater', duration_minutes: 180, price: 1200 },
    { name: 'Leak Detection & Repair', description: 'locate and fix hidden or visible leaks', duration_minutes: 90, price: 200 },
    { name: 'Toilet Repair', description: 'fix running, clogged, or leaking toilets', duration_minutes: 45, price: 125 },
    { name: 'Faucet & Fixture Installation', description: 'install faucets, disposals, and fixtures', duration_minutes: 60, price: 175 },
    { name: 'Emergency Call-Out', description: 'urgent dispatch for burst pipes, major leaks, no hot water', duration_minutes: 60, price: 99 },
  ];
  const pricing = [
    { name: 'Drain Cleaning', price: 150, notes: 'starting; final quote after inspection' },
    { name: 'Water Heater Repair', price: 250, notes: 'diagnostic included' },
    { name: 'Water Heater Installation', price: 1200, notes: 'varies by unit and permits' },
    { name: 'Leak Detection & Repair', price: 200, notes: 'varies by access and severity' },
    { name: 'Toilet Repair', price: 125, notes: 'parts extra if needed' },
    { name: 'Emergency Call-Out', price: 99, unit: 'visit', notes: 'diagnostic fee, credited toward the repair' },
  ];
  const faqs = [
    { question: 'Do you offer emergency service?', answer: 'Yes — we have 24/7 emergency call-out for burst pipes, major leaks, and no-hot-water situations.' },
    { question: 'Are you licensed and insured?', answer: "Yes, we're fully licensed, bonded, and insured." },
    { question: 'Do you charge for estimates?', answer: 'Estimates on new installations are free. Repairs carry a $99 diagnostic fee that we credit toward the job if you approve the work.' },
    { question: 'How soon can you come out?', answer: 'We usually offer same-day or next-day appointments, and emergencies are prioritized.' },
    { question: 'What areas do you serve?', answer: 'We cover the greater metro area — I can confirm your address when we book.' },
  ];
  const business_policies = [
    'Free estimates on new installations.',
    '24/7 emergency service for burst pipes, major leaks, and no hot water.',
    'Licensed, bonded, and insured.',
    'A $99 diagnostic fee applies to repairs and is credited toward the work if you approve it.',
    'Upfront, flat-rate pricing confirmed before any work begins.',
  ];
  const workday = { open: '08:00', close: '18:00' };
  const booking_rules = {
    lead_qualification_fields: ['issue'],
    working_hours: {
      monday: workday,
      tuesday: workday,
      wednesday: workday,
      thursday: workday,
      friday: workday,
      saturday: { open: '08:00', close: '14:00' },
      // Sunday: emergency call-out only (no standard hours).
    },
  };

  const { error: sErr } = await supabase.from('client_settings').upsert(
    {
      client_id: client.id,
      business_name: BUSINESS,
      agent_name: AGENT_NAME,
      agent_personality: 'friendly, reassuring, and efficient',
      agent_tone: 'friendly',
      booking_enabled: true,
      notification_emails: ['dispatch@mikesplumbing.example'],
      agent_config: {},
      services,
      pricing,
      faqs,
      business_policies,
      booking_rules,
    },
    { onConflict: 'client_id' }
  );
  if (sErr) throw new Error(`settings upsert: ${sErr.message}`);

  console.log(`Seeded demo client: ${BUSINESS}`);
  console.log(`  client_id: ${client.id}`);
  console.log(`  slug: mikes-plumbing, agent persona: ${AGENT_NAME}`);
  console.log(`  services: ${services.length}, faqs: ${faqs.length}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('\nSeed failed:', e.message); process.exit(1); });
