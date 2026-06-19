import { describe, it, expect } from 'vitest';
import { assertClientAccess, isPlatformUser } from '../middleware/auth.middleware.js';
import type { JwtPayload } from '../types/index.js';

function jwt(clientId: string | null): JwtPayload {
  return { sub: 'u1', email: 'u@x.com', role: clientId ? 'admin' : 'super_admin', clientId, iat: 0, exp: 0 };
}

describe('tenant isolation guards', () => {
  it('platform user (clientId null) can access any client', () => {
    const platform = jwt(null);
    expect(isPlatformUser(platform)).toBe(true);
    expect(assertClientAccess(platform, 'client-a')).toBe(true);
    expect(assertClientAccess(platform, 'client-b')).toBe(true);
    expect(assertClientAccess(platform, null)).toBe(true);
  });

  it('client-scoped user can only access their own client', () => {
    const scoped = jwt('client-a');
    expect(isPlatformUser(scoped)).toBe(false);
    expect(assertClientAccess(scoped, 'client-a')).toBe(true);
    expect(assertClientAccess(scoped, 'client-b')).toBe(false);
  });

  it('client-scoped user is denied when target client is missing', () => {
    const scoped = jwt('client-a');
    expect(assertClientAccess(scoped, null)).toBe(false);
    expect(assertClientAccess(scoped, undefined)).toBe(false);
  });
});
