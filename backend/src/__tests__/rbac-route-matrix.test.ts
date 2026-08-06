import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { env } from '../config/index.js';
import { ALL_ROLES, ALL_PERMISSIONS, type Permission, type UserRole } from '../types/index.js';
import { permissionsFor, permissionServiceMock } from './helpers/rbac.js';

vi.mock('../services/permission.service.js', () => permissionServiceMock());

const { requirePermission, requirePlatform } = await import('../middleware/auth.middleware.js');

const here = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_API_DIR = resolve(here, '../dashboard-api');

async function appGuardedBy(preHandler: ReturnType<typeof requirePermission>) {
  const app = Fastify();
  await app.register(jwt, { secret: env.JWT_SECRET });
  app.get('/guarded', { preHandler }, async () => ({ ok: true }));
  await app.ready();
  return app;
}

function tokenFor(app: Awaited<ReturnType<typeof appGuardedBy>>, role: UserRole, clientId: string | null) {
  return app.jwt.sign({ sub: `u-${role}`, email: `${role}@example.com`, role, clientId });
}

/** Platform roles carry no tenant; client roles always do. */
function tenantFor(role: UserRole): string | null {
  return role.startsWith('client_') ? '11111111-1111-1111-1111-111111111111' : null;
}

describe('requirePermission — role × permission matrix', () => {
  // Every role against every permission in the vocabulary: 6 × 24 = 144 checks.
  // Allow and deny are both asserted, so a grant added to the migration without
  // thought shows up as a failing deny rather than passing silently.
  for (const permission of ALL_PERMISSIONS) {
    for (const role of ALL_ROLES) {
      const shouldAllow = permissionsFor(role).has(permission as Permission);
      it(`${role} is ${shouldAllow ? 'allowed' : 'denied'} ${permission}`, async () => {
        const app = await appGuardedBy(requirePermission(permission as Permission));
        const res = await app.inject({
          method: 'GET',
          url: '/guarded',
          headers: { authorization: `Bearer ${tokenFor(app, role, tenantFor(role))}` },
        });
        expect(res.statusCode).toBe(shouldAllow ? 200 : 403);
        await app.close();
      });
    }
  }

  it('rejects a request with no token', async () => {
    const app = await appGuardedBy(requirePermission('calls:read'));
    const res = await app.inject({ method: 'GET', url: '/guarded' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('rejects a token signed with the wrong secret', async () => {
    const app = await appGuardedBy(requirePermission('calls:read'));
    const forged = Fastify();
    await forged.register(jwt, { secret: 'not-the-real-secret-not-even-close' });
    await forged.ready();
    const token = forged.jwt.sign({ sub: 'u', email: 'e@x.com', role: 'super_admin', clientId: null });
    const res = await app.inject({
      method: 'GET',
      url: '/guarded',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
    await forged.close();
  });
});

describe('requirePlatform', () => {
  it('allows a platform role holding the permission', async () => {
    const app = await appGuardedBy(requirePlatform('tickets:read'));
    const res = await app.inject({
      method: 'GET',
      url: '/guarded',
      headers: { authorization: `Bearer ${tokenFor(app, 'support_agent', null)}` },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('denies a client role even when its grants include the permission', async () => {
    // client_owner holds tickets:read, so this can only pass on the tenancy check.
    expect(permissionsFor('client_owner').has('tickets:read')).toBe(true);
    const app = await appGuardedBy(requirePlatform('tickets:read'));
    const res = await app.inject({
      method: 'GET',
      url: '/guarded',
      headers: { authorization: `Bearer ${tokenFor(app, 'client_owner', tenantFor('client_owner'))}` },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

describe('dashboard-api route inventory', () => {
  let sources: { file: string; text: string }[] = [];

  beforeAll(() => {
    sources = readdirSync(DASHBOARD_API_DIR)
      .filter((f) => f.endsWith('.route.ts'))
      .map((f) => ({ file: f, text: readFileSync(join(DASHBOARD_API_DIR, f), 'utf8') }));
  });

  it('finds route files to inspect', () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  // A route registered without a preHandler is reachable by anyone with any
  // valid token. This catches the omission at build time rather than in an audit.
  it('guards every route except the documented public ones', () => {
    const PUBLIC = ['/auth/login', '/auth/me'];
    const unguarded: string[] = [];

    for (const { file, text } of sources) {
      // Match `app.get('/path', {` … up to the closing of the options object at
      // the same nesting level is overkill here; routes in this codebase declare
      // preHandler within the first ~200 characters of the registration.
      const routeRe = /app\.(get|post|patch|put|delete)(?:<[^>]*>)?\(\s*'([^']+)'([\s\S]{0,400})/g;
      for (const m of text.matchAll(routeRe)) {
        const [, method, path, tail] = m;
        if (PUBLIC.includes(path)) continue;
        if (!/preHandler/.test(tail)) unguarded.push(`${file} ${method.toUpperCase()} ${path}`);
      }
    }

    expect(unguarded).toEqual([]);
  });

  it('only references permissions that exist in the vocabulary', () => {
    const known = new Set<string>(ALL_PERMISSIONS);
    const unknown: string[] = [];

    for (const { file, text } of sources) {
      for (const m of text.matchAll(/require(?:Permission|Platform)\(\s*'([^']+)'/g)) {
        if (!known.has(m[1])) unknown.push(`${file}: ${m[1]}`);
      }
    }

    expect(unknown).toEqual([]);
  });
});
