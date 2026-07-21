/**
 * Run the "booked appointment" CRM automation against a live GoHighLevel
 * sub-account, then read every change back to confirm it actually landed.
 *
 * This is the CRM-facing half of the booking flow (backend decides, CRM
 * displays): when an inbound call books an appointment, the opportunity is
 * advanced to a booked stage, the contact is tagged, and a staff follow-up
 * task is created. (The internal appointments row + calendar-event sync are
 * handled by booking.service; a GHL calendar event additionally needs a
 * calendar configured in the sub-account.)
 *
 *   npx tsx scripts/ghl-book-appointment.ts --contact=<id> --opportunity=<id>
 *   npx tsx scripts/ghl-book-appointment.ts --contact=<id> --opportunity=<id> --stage="Demo Booked"
 *
 * Targets the ghl-smoke-test client by default (--client-id / --slug to override).
 */
import { supabase } from '../src/db/index.js';
import { clientService } from '../src/services/index.js';
import { activeGhlConnection } from '../src/crm/ghl-connection.js';
import { ensureFreshGhlCredentials } from '../src/crm/gohighlevel-oauth.service.js';
import { GhlProvisioningClient } from '../src/crm/ghl-provisioning-client.js';

const SMOKE_SLUG = 'ghl-smoke-test';
const DEFAULT_STAGE = 'Demo Booked';
const BOOKED_TAGS = ['appointment-booked', 'demo-requested'];

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
  const opportunityId = arg('opportunity')?.trim();
  const stageName = arg('stage')?.trim() ?? DEFAULT_STAGE;
  if (!contactId || !opportunityId) {
    throw new Error('Pass --contact=<contactId> and --opportunity=<opportunityId>.');
  }

  const client = await resolveClient();
  const conn = await activeGhlConnection(client.id);
  if (!conn) throw new Error(`No active GHL connection for ${client.name}.`);
  const creds = await ensureFreshGhlCredentials(conn);
  const ghl = new GhlProvisioningClient({ accessToken: creds.accessToken, locationId: creds.locationId });
  console.log(`Client: ${client.name} — location ${creds.locationId}`);

  // Resolve the target stage id from the opportunity's own pipeline.
  const opp = await ghl.getOpportunity(opportunityId);
  const pipelines = await ghl.listPipelines();
  const pipeline = pipelines.find((p) => p.id === opp.pipelineId);
  if (!pipeline) throw new Error(`Pipeline ${opp.pipelineId} for opportunity not found.`);
  const stage = pipeline.stages.find((s) => s.name.toLowerCase() === stageName.toLowerCase());
  if (!stage) {
    throw new Error(
      `Stage "${stageName}" not in pipeline "${pipeline.name}". Stages: ${pipeline.stages.map((s) => s.name).join(', ')}`
    );
  }

  console.log(`\nBooking automation — opportunity "${opp.name}" → stage "${stage.name}"`);
  const taskTitle = `Confirm & prep booked appointment: ${opp.name}`;
  const dueDate = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await ghl.moveOpportunityStage(opportunityId, stage.id);
  console.log('  ✓ opportunity stage moved');
  await ghl.addContactTags(contactId, BOOKED_TAGS);
  console.log(`  ✓ tags added: ${BOOKED_TAGS.join(', ')}`);
  const task = await ghl.createContactTask(contactId, taskTitle, dueDate);
  console.log(`  ✓ staff task created (${task.id}, due ${dueDate.toISOString().slice(0, 10)})`);

  // ── Confirmation: read every change back from GHL ──────────────────────────
  console.log('\nConfirming against GoHighLevel...');
  const [confirmedOpp, tags, tasks] = await Promise.all([
    ghl.getOpportunity(opportunityId),
    ghl.getContactTags(contactId),
    ghl.listContactTasks(contactId),
  ]);

  const checks: Array<[string, boolean, string]> = [
    ['opportunity in booked stage', confirmedOpp.pipelineStageId === stage.id, `stageId=${confirmedOpp.pipelineStageId}`],
    ['contact has appointment-booked tag', tags.includes('appointment-booked'), tags.join(', ') || '(none)'],
    ['contact has demo-requested tag', tags.includes('demo-requested'), tags.join(', ') || '(none)'],
    ['staff follow-up task exists', tasks.some((t) => t.title === taskTitle), `${tasks.length} task(s)`],
  ];

  console.log('check                                    result  detail');
  let allPass = true;
  for (const [label, pass, detail] of checks) {
    if (!pass) allPass = false;
    console.log(`${label.padEnd(40)} ${(pass ? 'PASS' : 'FAIL').padEnd(7)} ${detail}`);
  }

  console.log(
    `\nView contact: https://app.gohighlevel.com/v2/location/${creds.locationId}/contacts/detail/${contactId}`
  );
  if (!allPass) {
    console.error('\nOne or more confirmations FAILED.');
    process.exit(1);
  }
  console.log('\nAll confirmations PASSED — booked-appointment automation verified live.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nBooking automation failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
