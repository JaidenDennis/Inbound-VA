/**
 * Turn the inbound workflow engine OFF for a client and restore its legacy
 * single-prompt agent — the safe REVERT for a routing test that went wrong.
 *
 *   WEBHOOK_BASE_URL=https://inbound-va.onrender.com \
 *   API_BASE_URL=https://inbound-va.onrender.com \
 *   npm run routing:disable -- <clientIdOrSlug> [--template=med_spa]
 *
 * ORDER MATTERS (mirror of routing:enable):
 *   1. Remove workflow_routing FIRST so the engine stops opening sessions and
 *      the scope guard passes the legacy agent's tools through immediately.
 *   2. Re-provision the legacy template (default med_spa) so the agent's prompt
 *      + tools are the pre-routing ones again.
 *
 * Run with the DEPLOYED base URL so the re-provisioned agent's webhook/tool URLs
 * are public (a local API_BASE_URL bakes localhost → Retell "Invalid hostname").
 */
import 'dotenv/config';
import { supabase } from '../src/db/index.js';
import { clientService } from '../src/services/index.js';
import { provisioningService } from '../src/services/provisioning.service.js';

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
}

async function resolveClientId(idOrSlug: string): Promise<string | null> {
  const byId = await clientService.findById(idOrSlug).catch(() => null);
  if (byId) return byId.id;
  const { data } = await supabase.from('clients').select('id').eq('slug', idOrSlug).maybeSingle();
  return data?.id ?? null;
}

async function main(): Promise<void> {
  const target = process.argv[2];
  const template = arg('template') ?? 'med_spa';
  if (!target) {
    console.error('Usage: npm run routing:disable -- <clientIdOrSlug> [--template=med_spa]');
    process.exit(1);
  }
  const clientId = await resolveClientId(target);
  if (!clientId) {
    console.error(`No client found for "${target}".`);
    process.exit(1);
  }

  // 1. Routing OFF (remove the flag key entirely → exact pre-routing state).
  const { error } = await supabase
    .from('client_settings')
    .update({ agent_config: (await currentAgentConfigWithout(clientId)) })
    .eq('client_id', clientId);
  if (error) throw new Error(`Failed to clear workflow_routing: ${error.message}`);
  console.log(`✓ workflow_routing removed for client ${clientId} (routing OFF)`);

  // 2. Re-provision the legacy template.
  console.log(`Restoring the "${template}" agent (live Retell)…`);
  const result = await provisioningService.provisionClient(clientId, { template });
  console.log(`✓ agent ${result.agentId} (v${result.version}), vertical=${result.vertical}`);
  console.log(`  webhook: ${result.webhookUrl}`);
  console.log('\nLegacy agent restored, routing OFF.');
}

async function currentAgentConfigWithout(clientId: string): Promise<Record<string, unknown>> {
  const settings = await clientService.getSettings(clientId);
  const cfg = { ...(settings?.agent_config ?? {}) } as Record<string, unknown>;
  delete cfg.workflow_routing;
  return cfg;
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nFailed:', err.message);
    process.exit(1);
  });
