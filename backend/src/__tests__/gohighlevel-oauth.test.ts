import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  process.env.GHL_CLIENT_ID = 'test-ghl-client-id';
  process.env.GHL_CLIENT_SECRET = 'test-ghl-client-secret';
});

vi.mock('axios', () => ({
  default: { post: vi.fn(), create: vi.fn() },
}));

const updateEq = vi.fn(async (_field: string, _value: string) => ({ error: null }));
const update = vi.fn((_payload: Record<string, unknown>) => ({ eq: updateEq }));
vi.mock('../db/index.js', () => ({
  supabase: { from: vi.fn(() => ({ update })) },
}));

import axios from 'axios';
import {
  signOAuthState,
  verifyOAuthState,
  buildInstallUrl,
  exchangeCode,
  ensureFreshGhlCredentials,
  GHL_SCOPES,
} from '../crm/gohighlevel-oauth.service.js';
import { encrypt, decrypt } from '../utils/index.js';

const axiosPost = vi.mocked(axios.post);

beforeEach(() => {
  axiosPost.mockReset();
  update.mockClear();
  updateEq.mockClear();
});

describe('OAuth state signing', () => {
  it('round-trips the client id', () => {
    const state = signOAuthState('11111111-2222-3333-4444-555555555555');
    expect(verifyOAuthState(state)).toBe('11111111-2222-3333-4444-555555555555');
  });

  it('rejects tampered state', () => {
    const state = signOAuthState('11111111-2222-3333-4444-555555555555');
    const [payload, sig] = state.split('.');
    const forged = Buffer.from('99999999-2222-3333-4444-555555555555|9999999999999').toString('base64url');
    expect(verifyOAuthState(`${forged}.${sig}`)).toBeNull();
    expect(verifyOAuthState(`${payload}.AAAA${sig.slice(4)}`)).toBeNull();
    expect(verifyOAuthState('garbage')).toBeNull();
  });

  it('rejects expired state', () => {
    const state = signOAuthState('11111111-2222-3333-4444-555555555555', -1000);
    expect(verifyOAuthState(state)).toBeNull();
  });
});

describe('install URL', () => {
  it('points at the marketplace choose-location page with scopes and state', () => {
    const url = new URL(buildInstallUrl('the-state'));
    expect(url.origin + url.pathname).toBe('https://marketplace.gohighlevel.com/oauth/chooselocation');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('test-ghl-client-id');
    expect(url.searchParams.get('scope')).toBe(GHL_SCOPES);
    // Provisioning needs custom-field/tag/pipeline scopes on top of the
    // adapter's CRUD scopes; all must stay ticked on the marketplace app.
    for (const scope of [
      'locations/customFields.write',
      'locations/tags.write',
      'pipelines.readonly',
      'pipelines.write',
      'pipelines.create',
    ]) {
      expect(GHL_SCOPES.split(' ')).toContain(scope);
    }
    expect(url.searchParams.get('state')).toBe('the-state');
    // Marketplace rejects redirect URLs containing "highlevel" or "ghl" —
    // the callback path must stay brand-free.
    expect(url.searchParams.get('redirect_uri')).toContain('/crm/level/oauth/callback');
    expect(url.searchParams.get('redirect_uri')).not.toMatch(/highlevel|ghl/i);
  });
});

describe('code exchange', () => {
  it('exchanges the code for location-scoped tokens', async () => {
    axiosPost.mockResolvedValue({
      data: { access_token: 'at', refresh_token: 'rt', expires_in: 86399, locationId: 'loc_1' },
    });
    const creds = await exchangeCode('auth-code');
    expect(creds).toMatchObject({ accessToken: 'at', refreshToken: 'rt', locationId: 'loc_1' });
    expect(creds.expiresAt).toBeGreaterThan(Date.now() + 86000 * 1000);
    const [url, body] = axiosPost.mock.calls[0];
    expect(url).toBe('https://services.leadconnectorhq.com/oauth/token');
    const params = new URLSearchParams(body as string);
    expect(params.get('grant_type')).toBe('authorization_code');
    expect(params.get('code')).toBe('auth-code');
    expect(params.get('user_type')).toBe('Location');
  });

  it('rejects agency-level installs (no locationId in the response)', async () => {
    axiosPost.mockResolvedValue({
      data: { access_token: 'at', refresh_token: 'rt', expires_in: 86399 },
    });
    await expect(exchangeCode('auth-code')).rejects.toThrow(/locationId/);
  });
});

describe('ensureFreshGhlCredentials', () => {
  const freshCreds = {
    accessToken: 'at-current',
    refreshToken: 'rt-current',
    expiresAt: Date.now() + 12 * 3600 * 1000,
    locationId: 'loc_1',
  };

  it('returns stored credentials untouched while the access token is fresh', async () => {
    const conn = { id: 'conn_1', credentials_encrypted: encrypt(JSON.stringify(freshCreds)) };
    const creds = await ensureFreshGhlCredentials(conn);
    expect(creds).toEqual(freshCreds);
    expect(axiosPost).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('refreshes near expiry and persists the rotated token pair', async () => {
    const expiring = { ...freshCreds, expiresAt: Date.now() + 60 * 1000 };
    const conn = { id: 'conn_1', credentials_encrypted: encrypt(JSON.stringify(expiring)) };
    axiosPost.mockResolvedValue({
      data: { access_token: 'at-new', refresh_token: 'rt-new', expires_in: 86399, locationId: 'loc_1' },
    });

    const creds = await ensureFreshGhlCredentials(conn);
    expect(creds.accessToken).toBe('at-new');
    expect(creds.refreshToken).toBe('rt-new');

    const params = new URLSearchParams(axiosPost.mock.calls[0][1] as string);
    expect(params.get('grant_type')).toBe('refresh_token');
    expect(params.get('refresh_token')).toBe('rt-current');

    // GHL refresh tokens are single-use: the rotated pair MUST be persisted.
    expect(update).toHaveBeenCalledTimes(1);
    const persisted = JSON.parse(decrypt(update.mock.calls[0][0].credentials_encrypted as string));
    expect(persisted.refreshToken).toBe('rt-new');
    expect(updateEq).toHaveBeenCalledWith('id', 'conn_1');
  });

  it('rejects connections without OAuth tokens (legacy v1 rows)', async () => {
    const conn = { id: 'conn_1', credentials_encrypted: encrypt(JSON.stringify({ apiKey: 'v1-key' })) };
    await expect(ensureFreshGhlCredentials(conn)).rejects.toThrow(/reconnect/i);
  });
});
