/**
 * Provision (or re-provision) a client's Retell agent from a template.
 *
 *   npm run provision -- <clientIdOrSlug> --template=med_spa
 *   npm run provision -- <clientIdOrSlug> --template=inbound_routing
 *
 * Updates the client's existing agent + LLM in place (same ids). Run with the
 * DEPLOYED base URL so tool/webhook URLs are public, e.g.:
 *   WEBHOOK_BASE_URL=https://inbound-va.onrender.com \
 *   API_BASE_URL=https://inbound-va.onrender.com \
 *   npm run provision -- bare-beauty-medspa --template=med_spa
 *
 * Does NOT touch client_settings.agent_config.workflow_routing — manage that
 * flag separately (routing must be OFF for legacy templates like med_spa).
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
  const template = arg('template');
  if (!target || !template) {
    console.error('Usage: npm run provision -- <clientIdOrSlug> --template=<med_spa|inbound_routing>');
    process.exit(1);
  }
  const clientId = await resolveClientId(target);
  if (!clientId) {
    console.error(`No client found for "${target}".`);
    process.exit(1);
  }
  console.log(`Provisioning client ${clientId} with template "${template}" (live Retell)…`);
  const result = await provisioningService.provisionClient(clientId, { template });
  console.log(`✓ agent ${result.agentId} (v${result.version}), vertical=${result.vertical}`);
  console.log(`  webhook: ${result.webhookUrl}`);
  console.log(`  numbers: ${result.mappedNumbers.join(', ') || '(none mapped)'}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nFailed:', err.message);
    process.exit(1);
  });
