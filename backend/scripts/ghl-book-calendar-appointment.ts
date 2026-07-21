/**
 * Book a REAL GoHighLevel calendar appointment through the production CRM
 * adapter (getCrmAdapter → GoHighLevelAdapter.createAppointment), then read it
 * back to confirm the calendar event exists.
 *
 * Resolves the calendar by its booking-widget slug and persists the chosen
 * calendarId into crm_connections.crm_config, so the normal booking flow
 * (booking.service → crm-sync worker → adapter) picks the same calendar.
 *
 *   npx tsx scripts/ghl-book-calendar-appointment.ts --contact=<id> --calendar-slug=marketing-call-5487
 *   ... --calendar-id=<id> --start=2026-07-21T15:00:00Z --duration=30
 *
 * Targets the ghl-smoke-test client by default (--client-id / --slug to override).
 */
import axios from 'axios';
import { supabase } from '../src/db/index.js';
import { clientService } from '../src/services/index.js';
import { activeGhlConnection } from '../src/crm/ghl-connection.js';
import { ensureFreshGhlCredentials } from '../src/crm/gohighlevel-oauth.service.js';
import { resolveAdapterConfig, getCrmAdapter } from '../src/crm/index.js';

const GHL_API = 'https://services.leadconnectorhq.com';
const CALENDARS_API_VERSION = '2021-04-15';
const SMOKE_SLUG = 'ghl-smoke-test';

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
}

async function resolveClient(): Promise<{ id: string; name: string }> {
  const clientId = arg('client-id');
  if (clientId) {
    const client = await clientService.findById(clientId);
    if (!client) throw new Error(`Client ${clientId} not found.`);
    return client;
  }
  const slug = arg('slug') ?? SMOKE_SLUG;
  const { data } = await supabase.from('clients').select('*').eq('slug', slug).maybeSingle();
  if (!data) throw new Error(`No client with slug "${slug}". Run npm run connect:ghl first.`);
  return data;
}

async function main(): Promise<void> {
  const contactId = arg('contact')?.trim();
  if (!contactId) throw new Error('Pass --contact=<contactId>.');
  const calendarSlug = arg('calendar-slug')?.trim();
  let calendarId = arg('calendar-id')?.trim();
  const durationMin = Number(arg('duration') ?? 30);
  const startTime = arg('start') ? new Date(arg('start')!) : new Date(Date.now() + 24 * 60 * 60 * 1000);
  const endTime = new Date(startTime.getTime() + durationMin * 60 * 1000);

  const client = await resolveClient();
  const conn = await activeGhlConnection(client.id);
  if (!conn) throw new Error(`No active GHL connection for ${client.name}.`);
  const creds = await ensureFreshGhlCredentials(conn);
  console.log(`Client: ${client.name} — location ${creds.locationId}`);

  const authHeaders = { Authorization: `Bearer ${creds.accessToken}`, Version: CALENDARS_API_VERSION };

  // Resolve calendarId from the widget slug if an id wasn't passed directly.
  if (!calendarId) {
    if (!calendarSlug) throw new Error('Pass --calendar-id=<id> or --calendar-slug=<widgetSlug>.');
    const { data } = await axios.get(`${GHL_API}/calendars/`, {
      headers: authHeaders,
      params: { locationId: creds.locationId },
    });
    const cal = (data.calendars ?? []).find(
      (c: { widgetSlug?: string; slug?: string }) => c.widgetSlug === calendarSlug || c.slug === calendarSlug
    );
    if (!cal) throw new Error(`No calendar with slug "${calendarSlug}" in this sub-account.`);
    calendarId = cal.id;
    console.log(`Resolved calendar "${cal.name}" (${calendarId}) from slug "${calendarSlug}"`);
  }

  // Round-robin calendars require an explicit assignee; resolve the calendar's
  // primary (or first selected) team member.
  let assignedUserId = arg('assigned-user')?.trim();
  if (!assignedUserId) {
    const { data } = await axios.get(`${GHL_API}/calendars/${calendarId}`, { headers: authHeaders });
    const members = (data.calendar?.teamMembers ?? []) as Array<{ userId: string; isPrimary?: boolean; selected?: boolean }>;
    const pick = members.find((m) => m.isPrimary) ?? members.find((m) => m.selected) ?? members[0];
    assignedUserId = pick?.userId;
    if (assignedUserId) console.log(`Resolved assigned team member: ${assignedUserId}`);
  }

  // Persist calendarId + assignedUserId into the connection config so the
  // production booking flow (booking.service → worker → adapter) reuses them.
  const mergedConfig = {
    ...((conn.crm_config as Record<string, unknown>) ?? {}),
    calendarId,
    ...(assignedUserId ? { assignedUserId } : {}),
  };
  const { error: cfgErr } = await supabase
    .from('crm_connections')
    .update({ crm_config: mergedConfig })
    .eq('id', conn.id);
  if (cfgErr) throw new Error(`Failed to persist calendarId: ${cfgErr.message}`);
  conn.crm_config = mergedConfig;
  console.log('Persisted calendarId into crm_connections.crm_config');

  // Book through the real production adapter path.
  const config = await resolveAdapterConfig(conn);
  const adapter = getCrmAdapter('gohighlevel', config);
  console.log(`\nBooking appointment ${startTime.toISOString()} → ${endTime.toISOString()} ...`);
  const res = await adapter.createAppointment({
    contactId,
    title: 'Marketing Call — booked by AI voice agent',
    startTime,
    endTime,
    notes: 'Automated booking smoke test.',
  });
  if (!res.success) throw new Error(`createAppointment failed: ${res.error}`);
  const appointmentId = res.externalId;
  console.log(`  ✓ appointment created: ${appointmentId}`);

  // ── Confirmation: read the appointment back from GHL ───────────────────────
  console.log('\nConfirming against GoHighLevel...');
  const { status, data } = await axios.get(`${GHL_API}/calendars/events/appointments/${appointmentId}`, {
    headers: authHeaders,
    validateStatus: () => true,
  });
  const appt = data?.appointment ?? data?.event ?? data;
  const ok =
    status === 200 &&
    (appt?.id === appointmentId) &&
    appt?.calendarId === calendarId &&
    appt?.contactId === contactId;
  console.log(`  read-back status: ${status}`);
  console.log(`  id:        ${appt?.id} ${appt?.id === appointmentId ? '✓' : '✗'}`);
  console.log(`  calendar:  ${appt?.calendarId} ${appt?.calendarId === calendarId ? '✓' : '✗'}`);
  console.log(`  contact:   ${appt?.contactId} ${appt?.contactId === contactId ? '✓' : '✗'}`);
  console.log(`  when:      ${appt?.startTime} → ${appt?.endTime}`);
  console.log(`  status:    ${appt?.appointmentStatus}`);

  console.log(
    `\nView contact: https://app.gohighlevel.com/v2/location/${creds.locationId}/contacts/detail/${contactId}`
  );
  if (!ok) {
    console.error('\nConfirmation FAILED — appointment did not read back as expected.');
    process.exit(1);
  }
  console.log('\nConfirmation PASSED — real GHL calendar appointment booked + verified live.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nCalendar booking failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
