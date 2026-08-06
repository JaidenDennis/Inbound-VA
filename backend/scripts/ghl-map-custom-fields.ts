/**
 * Backfill crm_connections.custom_field_mapping from a location's live GHL
 * custom fields. Run from backend/ with a complete .env:
 *
 *   npm run map:ghl-fields                          # every active GHL connection
 *   npm run map:ghl-fields -- --client-id=<uuid>    # one client
 *   npm run map:ghl-fields -- --dry-run             # show the mapping, write nothing
 *
 * WHY THIS EXISTS
 * ---------------
 * The CRM adapter sends custom fields under whatever internal names the caller
 * used ("Interest Level"). GHL only resolves a field by its id or its dotted
 * field key, and *silently ignores* an entry it cannot resolve — so without a
 * mapping every custom field is dropped on every sync, with no error anywhere.
 *
 * Provisioning now writes this mapping as part of the customFields step, so new
 * connections are correct by construction. This script is for connections
 * provisioned before that, and for locations whose fields were created by hand
 * in the GHL UI rather than by a blueprint.
 */
import { supabase } from '../src/db/index.js';
import { resolveAdapterConfig } from '../src/crm/credentials.js';
import { GhlProvisioningClient } from '../src/crm/ghl-provisioning-client.js';
import type { CrmConnection } from '../src/types/index.js';

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
}

const dryRun = process.argv.includes('--dry-run');
const clientId = arg('client-id');

async function connections(): Promise<CrmConnection[]> {
  let query = supabase
    .from('crm_connections')
    .select('*')
    .eq('crm_type', 'gohighlevel')
    .eq('is_active', true);
  if (clientId) query = query.eq('client_id', clientId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as CrmConnection[];
}

async function mapOne(conn: CrmConnection): Promise<void> {
  console.log(`\n── client ${conn.client_id} (connection ${conn.id})`);
  if (conn.needs_reauth) {
    console.log('   SKIPPED — connection needs re-authorization; re-run the GHL install first.');
    return;
  }

  const config = await resolveAdapterConfig(conn);
  const accessToken = config.accessToken as string | undefined;
  const locationId = config.locationId as string | undefined;
  if (!accessToken || !locationId) {
    console.log('   SKIPPED — no usable GHL credentials on this connection.');
    return;
  }

  const client = new GhlProvisioningClient({ accessToken, locationId });
  const fields = await client.listCustomFields();
  if (fields.length === 0) {
    console.log('   No custom fields on this location — nothing to map.');
    return;
  }

  // Live ids win; mappings for names GHL no longer reports are left alone.
  const mapping: Record<string, string> = {
    ...(conn.custom_field_mapping ?? {}),
    ...Object.fromEntries(fields.map((f) => [f.name, f.id])),
  };

  for (const field of fields) {
    const previous = conn.custom_field_mapping?.[field.name];
    const marker = previous === field.id ? ' ' : previous ? '~' : '+';
    console.log(`   ${marker} ${field.name} → ${field.id} (${field.dataType})`);
  }

  if (dryRun) {
    console.log('   dry run — not written.');
    return;
  }

  const { error } = await supabase
    .from('crm_connections')
    .update({ custom_field_mapping: mapping })
    .eq('id', conn.id);
  if (error) throw new Error(`Failed to update connection ${conn.id}: ${error.message}`);
  console.log(`   Wrote ${Object.keys(mapping).length} mappings.`);
}

async function main(): Promise<void> {
  const conns = await connections();
  if (conns.length === 0) {
    console.log(
      clientId
        ? `No active GoHighLevel connection for client ${clientId}.`
        : 'No active GoHighLevel connections.'
    );
    return;
  }
  console.log(`${conns.length} connection(s) to map${dryRun ? ' (dry run)' : ''}.`);
  console.log('Legend: + new mapping, ~ id changed, blank = unchanged');
  for (const conn of conns) await mapOne(conn);
  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
