/**
 * Live GHL provisioning smoke test. Run from backend/ with a complete .env
 * (Supabase, ENCRYPTION_KEY, GHL_CLIENT_ID/SECRET, API_BASE_URL):
 *
 *   npm run smoke:ghl                          # find-or-create the smoke-test client
 *   npm run smoke:ghl -- --client-id=<uuid>    # target an existing client (e.g. Gravvia)
 *   npm run smoke:ghl -- --cleanup             # remove the test contact + opportunity
 *
 * What it does:
 *   1. Find (or create) the target client row.
 *   2. No GHL connection yet → print the marketplace install URL and exit;
 *      the operator installs on the sub-account, then re-runs this script.
 *   3. Connection exists → refresh tokens (proves single-use rotation
 *      persistence), print the location.
 *   4. Apply the gravvia-sales blueprint in-process (no Redis needed; the run
 *      row lands in crm_sync_logs like a queued run). Re-running should
 *      report 0 creates — that is the idempotency proof.
 *   5. Create one timestamped smoke-test contact + opportunity and print GHL
 *      deep links for eyeball verification.
 */
import { randomUUID } from 'node:crypto';
import { supabase } from '../src/db/index.js';
import { clientService } from '../src/services/index.js';
import { activeGhlConnection } from '../src/crm/ghl-connection.js';
import { buildInstallUrl, signOAuthState, ensureFreshGhlCredentials } from '../src/crm/gohighlevel-oauth.service.js';
import { ghlProvisioningService } from '../src/crm/ghl-provisioning.service.js';
import { GhlProvisioningClient } from '../src/crm/ghl-provisioning-client.js';
import { gravviaSalesBlueprint } from '../src/crm/blueprints/index.js';
import type { CrmConnection } from '../src/types/index.js';

const SMOKE_SLUG = 'ghl-smoke-test';
const SMOKE_CONTACT_EMAIL_PREFIX = 'smoke-test';
const SMOKE_CONTACT_DOMAIN = 'gravvia-smoke.example.com';

function arg(name: string): string | undefined {
  const match = process.argv.find((a) => a.startsWith(`--${name}=`));
  return match?.split('=')[1];
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function findOrCreateSmokeClient(): Promise<{ id: string; name: string }> {
  const { data } = await supabase.from('clients').select('*').eq('slug', SMOKE_SLUG).maybeSingle();
  if (data) return data;
  console.log(`No "${SMOKE_SLUG}" client yet — creating one.`);
  return clientService.create({
    name: 'GHL Smoke Test',
    slug: SMOKE_SLUG,
    industry: 'other',
    timezone: 'America/New_York',
    phone_numbers: [],
  });
}

async function connectionFor(clientId: string): Promise<CrmConnection | null> {
  return activeGhlConnection(clientId);
}

function ghlContactUrl(locationId: string, contactId: string): string {
  return `https://app.gohighlevel.com/v2/location/${locationId}/contacts/detail/${contactId}`;
}

function ghlOpportunitiesUrl(locationId: string): string {
  return `https://app.gohighlevel.com/v2/location/${locationId}/opportunities/list`;
}

async function cleanup(client: GhlProvisioningClient, locationId: string): Promise<void> {
  // The smoke contact is findable by its opportunity-free unique email domain;
  // we search via opportunities on the stored ids instead — simplest reliable
  // approach: look up the ids we recorded on the smoke client's settings row.
  const { data } = await supabase
    .from('clients')
    .select('id')
    .eq('slug', SMOKE_SLUG)
    .maybeSingle();
  const clientId = arg('client-id') ?? data?.id;
  if (!clientId) {
    console.log('Nothing to clean up (no smoke-test client found).');
    return;
  }
  const { data: settings } = await supabase
    .from('client_settings')
    .select('crm_config')
    .eq('client_id', clientId)
    .maybeSingle();
  const marker = (settings?.crm_config ?? {}) as { smokeContactId?: string; smokeOpportunityId?: string };
  if (marker.smokeOpportunityId) {
    await client.deleteOpportunity(marker.smokeOpportunityId);
    console.log(`Deleted smoke opportunity ${marker.smokeOpportunityId}`);
  }
  if (marker.smokeContactId) {
    await client.deleteContact(marker.smokeContactId);
    console.log(`Deleted smoke contact ${marker.smokeContactId} (${ghlContactUrl(locationId, marker.smokeContactId)})`);
  }
  if (!marker.smokeContactId && !marker.smokeOpportunityId) {
    console.log('No recorded smoke contact/opportunity ids — nothing to delete.');
  } else {
    const cleared = { ...(settings?.crm_config as Record<string, unknown>), smokeContactId: undefined, smokeOpportunityId: undefined };
    await supabase.from('client_settings').update({ crm_config: cleared }).eq('client_id', clientId);
  }
}

async function main(): Promise<void> {
  const explicitClientId = arg('client-id');
  const client = explicitClientId
    ? await clientService.findById(explicitClientId)
    : await findOrCreateSmokeClient();
  if (!client) {
    console.error(`Client ${explicitClientId} not found.`);
    process.exit(1);
  }
  console.log(`Client: ${client.name} (${client.id})`);

  const conn = await connectionFor(client.id);
  if (!conn) {
    console.log('\nNo GoHighLevel connection for this client yet.');
    console.log('Open this URL in a browser and install on the target sub-account:\n');
    console.log(`  ${buildInstallUrl(signOAuthState(client.id))}\n`);
    console.log('Then re-run this script.');
    return;
  }

  console.log('Connection found — refreshing credentials (validates rotation persistence)...');
  const creds = await ensureFreshGhlCredentials(conn);
  console.log(`  locationId: ${creds.locationId}`);
  console.log(`  token expires: ${new Date(creds.expiresAt).toISOString()}`);

  const provisioningClient = new GhlProvisioningClient({
    accessToken: creds.accessToken,
    locationId: creds.locationId,
  });

  if (flag('cleanup')) {
    await cleanup(provisioningClient, creds.locationId);
    return;
  }

  console.log(`\nApplying blueprint "${gravviaSalesBlueprint.name}" (in-process, no queue)...`);
  const runId = randomUUID();
  const run = await ghlProvisioningService.applyBlueprint({
    clientId: client.id,
    runId,
    blueprint: gravviaSalesBlueprint,
    conn,
    attempt: 1,
  });

  console.log(`\nRun ${runId}: ${run.status}`);
  console.log('step           status    created  updated  skipped');
  for (const step of run.steps) {
    console.log(
      `${step.step.padEnd(14)} ${step.status.padEnd(9)} ${String(step.created).padEnd(8)} ${String(step.updated).padEnd(8)} ${step.skipped}`
    );
    const warnings = (step.detail as { warnings?: string[] } | undefined)?.warnings;
    for (const warning of warnings ?? []) console.log(`  ⚠ ${warning}`);
  }
  const totalCreated = run.steps.reduce((sum, s) => sum + s.created, 0);
  if (totalCreated === 0) {
    console.log('\n0 creates — location already provisioned (idempotency verified).');
  }

  console.log('\nCreating one smoke-test contact + opportunity...');
  const stamp = Date.now();
  const { id: contactId } = await provisioningClient.upsertContact(
    {
      firstName: 'Smoke',
      lastName: `Test ${stamp}`,
      email: `${SMOKE_CONTACT_EMAIL_PREFIX}-${stamp}@${SMOKE_CONTACT_DOMAIN}`,
      phone: `+1555020${String(stamp).slice(-4)}`,
      tags: ['inbound-lead'],
    },
    []
  );
  const pipelines = await provisioningClient.listPipelines();
  const pipeline = pipelines.find(
    (p) => p.name.toLowerCase() === gravviaSalesBlueprint.pipeline.name.toLowerCase()
  );
  if (!pipeline) throw new Error('Provisioned pipeline not found — check the run output above');
  const opportunity = await provisioningClient.createOpportunity({
    pipelineId: pipeline.id,
    pipelineStageId: pipeline.stages[0].id,
    contactId,
    name: `Smoke Test ${stamp}`,
    monetaryValue: 1,
  });

  // Remember the ids so --cleanup can remove exactly these records later.
  const { data: settings } = await supabase
    .from('client_settings')
    .select('crm_config')
    .eq('client_id', client.id)
    .maybeSingle();
  await supabase
    .from('client_settings')
    .update({
      crm_config: {
        ...((settings?.crm_config as Record<string, unknown>) ?? {}),
        smokeContactId: contactId,
        smokeOpportunityId: opportunity.id,
      },
    })
    .eq('client_id', client.id);

  console.log('\nVerify in GHL:');
  console.log(`  contact:       ${ghlContactUrl(creds.locationId, contactId)}`);
  console.log(`  opportunities: ${ghlOpportunitiesUrl(creds.locationId)}`);
  console.log('\nRe-run this script to verify idempotency (expect 0 creates), or');
  console.log('run with --cleanup to remove the smoke contact + opportunity.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nSmoke test failed:', err instanceof Error ? err.message : err);
    if (err && typeof err === 'object' && 'body' in err) {
      console.error('API response:', JSON.stringify((err as { body: unknown }).body, null, 2));
    }
    process.exit(1);
  });
