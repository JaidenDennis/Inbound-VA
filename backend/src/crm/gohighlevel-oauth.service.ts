import axios from 'axios';
import crypto from 'node:crypto';
import { env } from '../config/index.js';
import { supabase } from '../db/index.js';
import { encrypt, decrypt, logger } from '../utils/index.js';
import type { CrmConnection } from '../types/index.js';

// GoHighLevel OAuth 2.0 (marketplace app, v2 API). The install flow sends the
// user to the "choose location" page; the sub-account they pick authorizes the
// app and GHL redirects back with an authorization code. Access tokens live
// ~24h; refresh tokens are SINGLE-USE and rotate on every refresh, so the
// rotated pair must be persisted immediately or the connection bricks.
const AUTHORIZE_URL = 'https://marketplace.gohighlevel.com/oauth/chooselocation';
const TOKEN_URL = 'https://services.leadconnectorhq.com/oauth/token';

// Everything the adapter and provisioning service touch: contacts (incl.
// notes/tasks), opportunities, calendars + events (appointments), locations
// (connection test), plus custom fields / tags / pipelines for blueprint
// provisioning. Must exactly match the scopes ticked on the marketplace app
// ("GI Integration 3"); pipelines.* are separate from opportunities.*.
export const GHL_SCOPES = [
  'contacts.readonly',
  'contacts.write',
  'opportunities.readonly',
  'opportunities.write',
  'calendars.readonly',
  'calendars/events.readonly',
  'calendars/events.write',
  'locations.readonly',
  'locations/customFields.readonly',
  'locations/customFields.write',
  'locations/tags.readonly',
  'locations/tags.write',
  'pipelines.readonly',
  'pipelines.write',
  'pipelines.create',
].join(' ');

export interface GhlOAuthCredentials {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms after which the access token is no longer valid. */
  expiresAt: number;
  locationId: string;
  /**
   * How the token was obtained. Absent/`'oauth'` → a marketplace OAuth token
   * that must be refreshed via the rotating refresh-token flow. When
   * `'private_integration'` the token is a sub-account Private Integration
   * Token (PIT): long-lived, no refresh token, used verbatim.
   */
  authMode?: 'oauth' | 'private_integration';
}

interface GhlTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  locationId?: string;
  userType?: string;
}

// NOTE: the GHL marketplace rejects redirect URLs containing brand references
// ("highlevel" and even "ghl"), so the callback path uses the neutral "level".
export function ghlRedirectUri(): string {
  return env.GHL_REDIRECT_URI ?? `${env.API_BASE_URL}/crm/level/oauth/callback`;
}

function requireOAuthEnv(): { clientId: string; clientSecret: string } {
  if (!env.GHL_CLIENT_ID || !env.GHL_CLIENT_SECRET) {
    throw new Error('GoHighLevel OAuth is not configured (GHL_CLIENT_ID / GHL_CLIENT_SECRET)');
  }
  return { clientId: env.GHL_CLIENT_ID, clientSecret: env.GHL_CLIENT_SECRET };
}

// ── OAuth state ──────────────────────────────────────────────────────────────
// The callback is unauthenticated (GHL redirects the user's browser to it), so
// the state parameter is the only thing binding the callback to a tenant. It
// carries the client id + an expiry, HMAC-signed with ENCRYPTION_KEY.

export function signOAuthState(clientId: string, ttlMs = 10 * 60 * 1000): string {
  const payload = `${clientId}|${Date.now() + ttlMs}`;
  const sig = crypto.createHmac('sha256', env.ENCRYPTION_KEY).update(payload).digest('base64url');
  return `${Buffer.from(payload).toString('base64url')}.${sig}`;
}

/** Returns the client id the state was issued for, or null if invalid/expired. */
export function verifyOAuthState(state: string): string | null {
  const [payloadB64, sig] = state.split('.');
  if (!payloadB64 || !sig) return null;
  const payload = Buffer.from(payloadB64, 'base64url').toString('utf8');
  const expected = crypto.createHmac('sha256', env.ENCRYPTION_KEY).update(payload).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  const [clientId, expiresStr] = payload.split('|');
  if (!clientId || !expiresStr || Number(expiresStr) < Date.now()) return null;
  return clientId;
}

// ── Token exchange / refresh ─────────────────────────────────────────────────

async function requestToken(params: Record<string, string>): Promise<GhlTokenResponse> {
  const { clientId, clientSecret } = requireOAuthEnv();
  const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params });
  const { data } = await axios.post<GhlTokenResponse>(TOKEN_URL, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15000,
  });
  return data;
}

function toCredentials(data: GhlTokenResponse, locationId: string): GhlOAuthCredentials {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    locationId,
  };
}

export function buildInstallUrl(state: string): string {
  const { clientId } = requireOAuthEnv();
  const params = new URLSearchParams({
    response_type: 'code',
    redirect_uri: ghlRedirectUri(),
    client_id: clientId,
    scope: GHL_SCOPES,
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeCode(code: string): Promise<GhlOAuthCredentials> {
  const data = await requestToken({
    grant_type: 'authorization_code',
    code,
    user_type: 'Location',
    redirect_uri: ghlRedirectUri(),
  });
  if (!data.locationId) {
    throw new Error(
      'GoHighLevel token response has no locationId — the app must be installed on a sub-account (Location), not at agency level'
    );
  }
  return toCredentials(data, data.locationId);
}

// Refresh slightly early so a token never expires mid-request.
const REFRESH_SKEW_MS = 5 * 60 * 1000;

// GHL refresh tokens are single-use: concurrent refreshes for the same
// connection would race and invalidate each other. Jobs in the same process
// share one in-flight refresh; cross-process races are absorbed by the skew
// window (both processes refresh well before expiry, last write wins and both
// tokens remain valid until the old access token expires).
const inflightRefresh = new Map<string, Promise<GhlOAuthCredentials>>();

/**
 * Decrypt a GoHighLevel connection's credentials, refreshing (and persisting
 * the rotated token pair) when the access token is at/near expiry.
 */
export async function ensureFreshGhlCredentials(
  conn: Pick<CrmConnection, 'id' | 'credentials_encrypted'>
): Promise<GhlOAuthCredentials> {
  const creds = JSON.parse(decrypt(conn.credentials_encrypted)) as GhlOAuthCredentials;
  // Private Integration Tokens are long-lived and have no refresh token; the
  // adapter uses them verbatim, so there is nothing to refresh.
  if (creds.authMode === 'private_integration') return creds;
  if (!creds.refreshToken) {
    throw new Error('GoHighLevel connection has no OAuth tokens — reconnect via the OAuth install flow');
  }
  if (creds.expiresAt - REFRESH_SKEW_MS > Date.now()) return creds;

  const existing = inflightRefresh.get(conn.id);
  if (existing) return existing;

  const refreshPromise = (async () => {
    const data = await requestToken({
      grant_type: 'refresh_token',
      refresh_token: creds.refreshToken,
      user_type: 'Location',
    });
    const next = toCredentials(data, data.locationId ?? creds.locationId);
    const { error } = await supabase
      .from('crm_connections')
      .update({
        credentials_encrypted: encrypt(JSON.stringify(next)),
        updated_at: new Date().toISOString(),
      })
      .eq('id', conn.id);
    if (error) {
      // The rotated refresh token exists only in memory now; if this persist
      // failed the stored (already-consumed) token is dead and the next refresh
      // will fail loudly → surfaces in crm_sync_logs / failed_jobs.
      logger.error({ connectionId: conn.id, error: error.message }, 'Failed to persist rotated GHL tokens');
    }
    return next;
  })();

  inflightRefresh.set(conn.id, refreshPromise);
  try {
    return await refreshPromise;
  } finally {
    inflightRefresh.delete(conn.id);
  }
}
