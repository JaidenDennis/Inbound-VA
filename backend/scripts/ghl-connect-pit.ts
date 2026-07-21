/**
 * Connect a client to GoHighLevel with a Private Integration Token (PIT),
 * bypassing the marketplace OAuth flow entirely.
 *
 * Generate the token in the sub-account: Settings → Private Integrations →
 * Create new integration, tick the scopes you need (contacts, opportunities,
 * calendars, locations, custom fields, tags, pipelines), and copy the
 * `pit-...` token. Grab the sub-account (Location) ID from Settings →
 * Business Profile, or the URL: app.gohighlevel.com/v2/location/<ID>/...
 *
 * Run from backend/ with a complete .env (Supabase, ENCRYPTION_KEY). Pass the
 * token via env var so it never lands in shell history:
 *
 *   GHL_PIT=pit-xxxxx npm run connect:ghl -- --location=<locationId>
 *   GHL_PIT=pit-xxxxx npm run connect:ghl -- --location=<id> --client-id=<uuid>
 *   GHL_PIT=pit-xxxxx npm run connect:ghl -- --location=<id> --slug=<clientSlug>
 *
 * With no --client-id/--slug it targets the "ghl-smoke-test" client (creating
 * it if needed), so you can immediately verify with `npm run smoke:ghl`.
 *
 * The token is validated against the GHL API (GET /locations/:id) before it is
 * stored, so a bad token or missing scope fails loudly here instead of later.
 */
import axios from 'axios';
import { supabase } from '../src/db/index.js';
import { clientService } from '../src/services/index.js';
import { encrypt } from '../src/utils/index.js';
import type { GhlOAuthCredentials } from '../src/crm/gohighlevel-oauth.service.js';

const GHL_API = 'https://services.leadconnectorhq.com';
const API_VERSION = '2021-07-28';
const SMOKE_SLUG = 'ghl-smoke-test';
// PITs are long-lived; set expiry far out so the resolver never tries to
// refresh (the authMode flag already short-circuits refresh, this is belt +
// suspenders and keeps any expiry-based UI sane).
const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1000;

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
  if (data) return data;
  if (arg('slug')) throw new Error(`No client with slug "${slug}". Create it first or pass --client-id.`);
  console.log(`No "${SMOKE_SLUG}" client yet — creating one.`);
  return clientService.create({
    name: 'GHL Smoke Test',
    slug: SMOKE_SLUG,
    industry: 'other',
    timezone: 'America/New_York',
    phone_numbers: [],
  });
}

async function main(): Promise<void> {
  const token = process.env.GHL_PIT?.trim();
  const locationId = arg('location')?.trim();
  if (!token) throw new Error('Set the token via GHL_PIT env var (e.g. GHL_PIT=pit-xxx npm run connect:ghl -- --location=...).');
  if (!locationId) throw new Error('Pass the sub-account id with --location=<locationId>.');

  console.log('Validating token against GoHighLevel...');
  try {
    const { data } = await axios.get(`${GHL_API}/locations/${locationId}`, {
      headers: { Authorization: `Bearer ${token}`, Version: API_VERSION },
      timeout: 15000,
    });
    const name = data?.location?.name ?? data?.name ?? '(unknown)';
    console.log(`  token OK — location "${name}" (${locationId})`);
  } catch (err) {
    const status = axios.isAxiosError(err) ? err.response?.status : undefined;
    if (status === 401 || status === 403) {
      throw new Error(
        `Token rejected (${status}). Check the token is correct and the Private Integration has at least the locations.readonly scope.`
      );
    }
    throw err;
  }

  const client = await resolveClient();
  console.log(`Client: ${client.name} (${client.id})`);

  const credentials: GhlOAuthCredentials = {
    accessToken: token,
    refreshToken: '',
    expiresAt: Date.now() + TEN_YEARS_MS,
    locationId,
    authMode: 'private_integration',
  };

  const { error } = await supabase.from('crm_connections').upsert(
    {
      client_id: client.id,
      crm_type: 'gohighlevel',
      credentials_encrypted: encrypt(JSON.stringify(credentials)),
      is_active: true,
      needs_reauth: false,
    },
    { onConflict: 'client_id,crm_type' }
  );
  if (error) throw new Error(`Failed to store connection: ${error.message}`);

  console.log('\nStored GoHighLevel connection (Private Integration Token).');
  console.log('Verify + provision with:');
  console.log(
    arg('client-id')
      ? `  npm run smoke:ghl -- --client-id=${client.id}`
      : arg('slug')
        ? `  npm run smoke:ghl -- --client-id=${client.id}`
        : '  npm run smoke:ghl'
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nConnect failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
