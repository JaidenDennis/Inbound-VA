/**
 * READ-ONLY diagnostic for the Bare Beauty / Emily agent + GHL wiring.
 * Makes NO changes. Run:
 *   DOTENV_CONFIG_PATH=../.env npx tsx scripts/diag-emily.ts bare-beauty-medspa
 */
import 'dotenv/config';
import { supabase } from '../src/db/index.js';
import { clientService } from '../src/services/index.js';

async function resolveClientId(idOrSlug: string): Promise<string | null> {
  const byId = await clientService.findById(idOrSlug).catch(() => null);
  if (byId) return byId.id;
  const { data } = await supabase.from('clients').select('id').eq('slug', idOrSlug).maybeSingle();
  return data?.id ?? null;
}

async function main(): Promise<void> {
  const arg = process.argv[2] ?? 'bare-beauty-medspa';
  const clientId = await resolveClientId(arg);
  if (!clientId) {
    console.error(`No client found for "${arg}".`);
    process.exit(1);
  }
  const { data: client } = await supabase
    .from('clients')
    .select('id, name, slug, industry, phone_numbers, retell_agent_id, retell_llm_id, retell_agent_version, retell_last_provisioned_at')
    .eq('id', clientId)
    .single();
  const settings = await clientService.getSettings(clientId);
  const wf = (settings?.agent_config as Record<string, unknown> | undefined)?.workflow_routing;

  const { data: conns } = await supabase
    .from('crm_connections')
    .select('id, provider, is_active, created_at')
    .eq('client_id', clientId);

  // Reconcile the user's "GHL already connected" claim: show ALL clients and
  // ALL crm_connections, plus recent appointments for THIS client (to tell an
  // internal-only booking apart from a GHL-synced one).
  const { data: allClients } = await supabase
    .from('clients')
    .select('id, slug, name, phone_numbers');
  const { data: allConns } = await supabase
    .from('crm_connections')
    .select('id, client_id, provider, is_active, created_at');
  const { data: appts } = await supabase
    .from('appointments')
    .select('id, title, start_time, status, external_id, created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(5);

  console.log('=== CLIENT (owner of the live number) ===');
  console.log(JSON.stringify(client, null, 2));
  console.log('workflow_routing flag:', wf);
  console.log('booking_enabled:', settings?.booking_enabled);
  console.log('notification_emails:', settings?.notification_emails);
  console.log('\n=== CRM CONNECTIONS for THIS client ===');
  console.log(JSON.stringify(conns, null, 2));
  console.log('\n=== ALL crm_connections (any client) ===');
  console.log(JSON.stringify(allConns, null, 2));
  console.log('\n=== ALL clients ===');
  console.log(JSON.stringify(allClients, null, 2));
  console.log('\n=== recent appointments for THIS client (external_id set => synced out) ===');
  console.log(JSON.stringify(appts, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nFailed:', err.message);
    process.exit(1);
  });
