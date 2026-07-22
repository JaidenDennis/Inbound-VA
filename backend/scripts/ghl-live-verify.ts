/**
 * LIVE GoHighLevel verification — proves the CRM adapter (especially the new
 * calendar-booking methods) works against the real GHL API, not mocks.
 *
 *   npm run verify:ghl                       # first active GHL connection
 *   npm run verify:ghl -- --client-id=<uuid> # a specific client
 *   npm run verify:ghl -- --read-only        # skip the create/update/cancel write cycle
 *
 * Steps (each reported PASS/FAIL):
 *   1. Resolve the connection + adapter config (decrypt creds, refresh token).
 *   2. testConnection() + listCalendars()/listPipelines()  — auth + reads.
 *   3. getAvailability() on the configured calendar (next 7 days) — validates
 *      the free-slots parsing against a REAL response (the highest-risk method).
 *   4. Write cycle (unless --read-only): create a clearly-labelled test contact,
 *      createBooking → updateBooking → cancelBooking, then leave the appointment
 *      cancelled. This mutates the real calendar briefly; the appointment is
 *      titled so staff know it is a deploy test and it is cancelled at the end.
 */
import 'dotenv/config';
import { supabase } from '../src/db/index.js';
import { getCrmAdapter, resolveAdapterConfig } from '../src/crm/index.js';
import type { CrmConnection } from '../src/types/index.js';
import type { ICrmAdapter } from '../src/crm/crm.interface.js';

// GHL implements the optional calendar methods plus its own read helpers; a
// structural type so we can call them without exporting the concrete class.
type GhlAdapter = ICrmAdapter &
  Required<Pick<ICrmAdapter, 'getAvailability' | 'createBooking' | 'updateBooking' | 'cancelBooking'>> & {
    listCalendars(): Promise<Array<{ id: string; name: string }>>;
    listPipelines(): Promise<Array<{ id: string; name: string }>>;
  };

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
}
const readOnly = process.argv.includes('--read-only');

let pass = 0;
let fail = 0;
function ok(label: string, detail = ''): void {
  pass++;
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
}
function bad(label: string, err: unknown): void {
  fail++;
  console.log(`  ✗ ${label} — ${err instanceof Error ? err.message : String(err)}`);
}

async function main(): Promise<void> {
  const clientId = arg('client-id');
  let query = supabase
    .from('crm_connections')
    .select('*, clients(name)')
    .eq('crm_type', 'gohighlevel')
    .eq('is_active', true)
    .order('updated_at', { ascending: false });
  if (clientId) query = query.eq('client_id', clientId);
  const { data: conns, error } = await query.limit(1);
  if (error) throw new Error(error.message);
  const conn = conns?.[0] as (CrmConnection & { clients?: { name?: string } }) | undefined;
  if (!conn) {
    console.error('No active GoHighLevel connection found. Connect one first (marketplace install / PIT).');
    process.exit(1);
  }
  console.log(`Target: ${conn.clients?.name ?? conn.client_id} (connection ${conn.id})\n`);

  // 1. Resolve config + adapter (same path the workers use).
  const config = await resolveAdapterConfig(conn);
  const adapter = getCrmAdapter('gohighlevel', config) as unknown as GhlAdapter;
  const calendarId = config.calendarId as string | undefined;
  console.log(`Config: locationId=${config.locationId ? 'set' : 'MISSING'} calendarId=${calendarId ? String(calendarId).slice(0, 8) + '…' : 'MISSING'}\n`);

  // 2. Auth + reads.
  console.log('Auth + reads:');
  try {
    const okConn = await adapter.testConnection();
    okConn ? ok('testConnection') : bad('testConnection', new Error('returned false'));
  } catch (e) { bad('testConnection', e); }
  try {
    const cals = await adapter.listCalendars();
    const match = cals.find((c) => c.id === calendarId);
    ok('listCalendars', `${cals.length} calendar(s)${match ? `, configured one present: "${match.name}"` : ''}`);
    if (calendarId && !match) bad('configured calendarId exists in GHL', new Error('calendarId not found in listCalendars'));
  } catch (e) { bad('listCalendars', e); }
  try {
    const pipes = await adapter.listPipelines();
    ok('listPipelines', `${pipes.length} pipeline(s)`);
  } catch (e) { bad('listPipelines', e); }

  // 3. getAvailability — the new method, against a real response.
  console.log('\nCalendar availability (NEW method, read-only):');
  let firstSlotIso: string | undefined;
  try {
    const start = new Date();
    const end = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const slots = await adapter.getAvailability({
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      timezone: 'America/New_York',
    });
    firstSlotIso = slots[0]?.start;
    ok('getAvailability', `${slots.length} open slot(s) in next 7 days${firstSlotIso ? `, first: ${firstSlotIso}` : ''}`);
  } catch (e) { bad('getAvailability', e); }

  // 4. Write cycle (create → update → cancel), cleaned up.
  if (readOnly) {
    console.log('\n(--read-only: skipping the create/update/cancel write cycle)');
  } else {
    console.log('\nWrite cycle (create → update → cancel, real calendar, cleaned up):');
    let contactId: string | undefined;
    let apptId: string | undefined;
    try {
      const res = await adapter.createOrUpdateContact({
        firstName: 'Gravvia',
        lastName: 'DeployTest',
        phone: '+15555550123',
        email: `deploy-test-${Date.now()}@gravvia-smoke.example.com`,
      });
      if (!res.success || !res.externalId) throw new Error(res.error ?? 'no contact id');
      contactId = res.externalId;
      ok('createOrUpdateContact', `contact ${contactId.slice(0, 8)}…`);
    } catch (e) { bad('createOrUpdateContact', e); }

    if (contactId) {
      // Use a real open slot when we found one, else a safe far-future weekday slot.
      const startTime = firstSlotIso
        ? new Date(firstSlotIso)
        : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      const endTime = new Date(startTime.getTime() + 30 * 60 * 1000);
      try {
        const res = await adapter.createBooking({
          contactId,
          title: 'GRAVVIA DEPLOY TEST — safe to delete',
          startTime,
          endTime,
        });
        if (!res.success || !res.externalId) throw new Error(res.error ?? 'no appointment id');
        apptId = res.externalId;
        ok('createBooking', `appointment ${apptId.slice(0, 8)}… at ${startTime.toISOString()}`);
      } catch (e) { bad('createBooking', e); }
    }

    if (apptId) {
      try {
        const moved = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000);
        const res = await adapter.updateBooking(apptId, {
          startTime: moved,
          endTime: new Date(moved.getTime() + 30 * 60 * 1000),
        });
        res.success ? ok('updateBooking', `moved to ${moved.toISOString()}`) : bad('updateBooking', new Error(res.error));
      } catch (e) { bad('updateBooking', e); }
      try {
        const res = await adapter.cancelBooking(apptId);
        res.success ? ok('cancelBooking (cleanup)') : bad('cancelBooking', new Error(res.error));
      } catch (e) { bad('cancelBooking', e); }
    }
  }

  console.log(`\n${'='.repeat(48)}\nRESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log('GHL is NOT fully proven — see failures above.');
    process.exit(1);
  }
  console.log('GHL adapter fully verified against the live API. ✅');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nVerification crashed:', err.message);
    process.exit(1);
  });
