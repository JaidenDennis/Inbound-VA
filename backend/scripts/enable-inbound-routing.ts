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

  // ORDER MATTERS. Provision the routing agent FIRST, then flip the flag.
  // Once workflow_routing is on, the backend's scope guard denies any tool that
  // isn't in the active workflow's grant — so if the flag were set while the
  // agent were still the legacy (non-routing) one, the legacy agent's own tools
  // would be denied and the line would break. Provisioning first (and only
  // flipping the flag on success) guarantees the agent already speaks route_intent.

  // 1. Deploy the routing agent (live Retell call). Throws on failure → the
  //    flag below is never reached, so a failed provision leaves routing OFF.
  if (doProvision) {
    console.log('Provisioning the inbound_routing agent (live Retell)…');
    const result = await provisioningService.provisionClient(clientId, { template: 'inbound_routing' });
    console.log(`✓ agent ${result.agentId} (v${result.version}) provisioned`);
    console.log(`  webhook: ${result.webhookUrl}`);
    console.log(`  numbers: ${result.mappedNumbers.join(', ') || '(none mapped)'}`);
  } else {
    console.log('⚠ --provision NOT set: only flipping the flag. Do this ONLY if the agent is');
    console.log('  already provisioned from the inbound_routing template, or the legacy agent will break.');
  }

  // 2. Flip the workflow_routing flag (merge into agent_config, never clobber it).
  const settings = await clientService.getSettings(clientId);
  const agentConfig = { ...(settings?.agent_config ?? {}), workflow_routing: true };
  const { error } = await supabase
    .from('client_settings')
    .update({ agent_config: agentConfig })
    .eq('client_id', clientId);
  if (error) throw new Error(`Failed to set workflow_routing: ${error.message}`);
  console.log(`✓ workflow_routing = true for client ${clientId}`);
  console.log('\nRouting is now ACTIVE for this client. Place a test call to verify.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nFailed:', err.message);
    process.exit(1);
  });
