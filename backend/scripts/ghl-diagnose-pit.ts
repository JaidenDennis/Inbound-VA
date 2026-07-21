/**
 * Diagnose a GoHighLevel Private Integration Token (PIT) by probing several
 * endpoints and printing the FULL status + response body for each, so we can
 * see exactly what the token can and cannot do.
 *
 *   GHL_PIT=pit-xxxxx npx tsx scripts/ghl-diagnose-pit.ts --location=<locationId>
 */
import axios from 'axios';

const GHL_API = 'https://services.leadconnectorhq.com';
const API_VERSION = '2021-07-28';

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
}

async function probe(label: string, url: string, token: string): Promise<void> {
  try {
    const { status, data } = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}`, Version: API_VERSION },
      timeout: 15000,
      validateStatus: () => true,
    });
    const body = typeof data === 'string' ? data : JSON.stringify(data);
    console.log(`\n[${label}] ${url}`);
    console.log(`  status: ${status}`);
    console.log(`  body:   ${body.slice(0, 600)}`);
  } catch (err) {
    console.log(`\n[${label}] ${url}`);
    console.log(`  network error: ${err instanceof Error ? err.message : err}`);
  }
}

async function main(): Promise<void> {
  const token = process.env.GHL_PIT?.trim();
  const loc = arg('location')?.trim();
  if (!token) throw new Error('Set GHL_PIT env var.');
  if (!loc) throw new Error('Pass --location=<locationId>.');

  console.log(`Token prefix: ${token.slice(0, 8)}...  length: ${token.length}`);
  console.log(`Location:     ${loc}`);

  // Agency-token endpoint — PITs frequently CANNOT read this even when valid.
  await probe('locations/:id', `${GHL_API}/locations/${loc}`, token);
  // Location-scoped endpoints a PIT with the right scopes SHOULD be able to read.
  await probe('customFields', `${GHL_API}/locations/${loc}/customFields`, token);
  await probe('tags', `${GHL_API}/locations/${loc}/tags`, token);
  await probe('contacts', `${GHL_API}/contacts/?locationId=${loc}&limit=1`, token);
}

main().catch((err) => {
  console.error('\nDiagnose failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
