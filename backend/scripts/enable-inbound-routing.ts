/**
 * Turn the inbound WORKFLOW ENGINE on for a client.
 *
 *   npm run routing:enable -- <clientIdOrSlug>              # flip the flag only
 *   npm run routing:enable -- <clientIdOrSlug> --provision  # + deploy the routing agent
 *
 * The engine needs BOTH of these, which this script sets together:
 *   1. client_settings.agent_config.workflow_routing = true
 *      → call_started opens a routing session and the scope guard activates.
 *   2. the client's Retell agent provisioned from the `inbound_routing` template
 *      → the agent actually has the route_intent / update_workflow tools.
 *
 * Without --provision this only flips the flag (safe, no external calls). With
 * --provision it calls Retell to create/update the agent — a live, billable
 * operation — so it is opt-in.
 */
import 'dotenv/config';
import { supabase } from '../src/db/index.js';
import { clientService } from '../src/services/index.js';
import { provisioningService } from '../src/services/provisioning.service.js';

async function resolveClientId(idOrSlug: string): Promise<string | null> {
  // Try id first, then slug.
  const byId = await clientService.findById(idOrSlug).catch(() => null);
  if (byId) return byId.id;
  const { data } = await supabase.from('clients').select('id').eq('slug', idOrSlug).maybeSingle();
  return data?.id ?? null;
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  const doProvision = process.argv.includes('--provision');
  if (!arg) {
    console.error('Usage: npm run routing:enable -- <clientIdOrSlug> [--provision]');
    process.exit(1);
  }

  const clientId = await resolveClientId(arg);
  if (!clientId) {
    console.error(`No client found for "${arg}" (tried id and slug).`);
    process.exit(1);
  }

  // 1. Flip the workflow_routing flag (merge into agent_config, never clobber it).
  const settings = await clientService.getSettings(clientId);
  const agentConfig = { ...(settings?.agent_config ?? {}), workflow_routing: true };
  const { error } = await supabase
    .from('client_settings')
    .update({ agent_config: agentConfig })
    .eq('client_id', clientId);
  if (error) throw new Error(`Failed to set workflow_routing: ${error.message}`);
  console.log(`✓ workflow_routing = true for client ${clientId}`);

  // 2. Optionally deploy the routing agent (live Retell call).
  if (doProvision) {
    console.log('Provisioning the inbound_routing agent (live Retell)…');
    const result = await provisioningService.provisionClient(clientId, { template: 'inbound_routing' });
    console.log(`✓ agent ${result.agentId} (v${result.version}) provisioned`);
    console.log(`  webhook: ${result.webhookUrl}`);
    console.log(`  numbers: ${result.mappedNumbers.join(', ') || '(none mapped)'}`);
  } else {
    console.log('Flag set. Re-run with --provision to deploy the inbound_routing agent,');
    console.log('or provision via POST /clients/:id/provision { "template": "inbound_routing" }.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nFailed:', err.message);
    process.exit(1);
  });
