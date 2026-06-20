import CryptoJS from 'crypto-js';
import { env } from '../../config/index.js';

// Retell signs BOTH webhook events and custom-function calls with your API KEY
// (there is no separate webhook secret). The `X-Retell-Signature` header looks
// like:  v={unix_ms_timestamp},d={hex_hmac_sha256(rawBody + timestamp, apiKey)}
// and is valid for 5 minutes. The RAW request body must be used (not a
// re-serialized parse).  Docs: https://docs.retellai.com (Secure Webhook).
const FIVE_MINUTES_MS = 5 * 60 * 1000;

function parseSignatureHeader(header: string): { timestamp: string; digest: string } | null {
  let timestamp = '';
  let digest = '';
  for (const part of header.split(',')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key === 'v') timestamp = value;
    else if (key === 'd') digest = value;
  }
  if (!timestamp || !digest) return null;
  return { timestamp, digest };
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

/**
 * Validate a Retell `X-Retell-Signature` header against the raw request body.
 * `now` is injectable for tests.
 */
export function validateRetellSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  now: number = Date.now()
): boolean {
  if (!signatureHeader) return false;

  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) return false;

  // Replay protection: reject timestamps outside the 5-minute window.
  const ts = Number(parsed.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > FIVE_MINUTES_MS) return false;

  const expected = CryptoJS.HmacSHA256(rawBody + parsed.timestamp, env.RETELL_API_KEY).toString(
    CryptoJS.enc.Hex
  );
  return timingSafeEqualHex(expected, parsed.digest);
}
