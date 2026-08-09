import type { FastifyRequest, FastifyReply } from 'fastify';
import type { JwtPayload, Permission } from '../types/index.js';
import { getEffectivePermissions } from '../services/permission.service.js';

declare module 'fastify' {
  interface FastifyRequest {
    jwtUser: JwtPayload;
    /** Grants for the caller's role, resolved once per request. */
    jwtPermissions: Set<Permission>;
  }
}

export function requireAuth() {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ error: 'Unauthorized' });
    }
  };
}

/**
 * Verify the token, then check the caller carries `permission`.
 *
 * Grants are read from the database (via a cached lookup), not from the token
 * and not from a map in source. Before migration 016 this consulted a hardcoded
 * ROLE_PERMISSIONS table that had silently drifted from the `permissions` rows
 * it was meant to mirror.
 *
 * Since migration 022 the lookup is EFFECTIVE rather than base: a client user's
 * grants are their role's grants plus their tenant's overlay. Platform users
 * have no overlay and resolve to base grants unchanged.
 */
export function requirePermission(permission: Permission) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    let user: JwtPayload;
    try {
      await request.jwtVerify();
      user = request.user as JwtPayload;
    } catch {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const permissions = await getEffectivePermissions(user.role, user.clientId);
    if (!permissions.has(permission)) {
      reply.code(403).send({ error: 'Forbidden' });
      return;
    }
    request.jwtUser = user;
    request.jwtPermissions = permissions;
  };
}

/**
 * Platform-staff-only gate for cross-tenant surfaces that no client role should
 * reach regardless of grants (e.g. the system console listing every tenant).
 */
export function requirePlatform(permission: Permission) {
  const checkPermission = requirePermission(permission);
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await checkPermission(request, reply);
    if (reply.sent) return;
    if (!isPlatformUser(request.jwtUser)) {
      reply.code(403).send({ error: 'Forbidden' });
    }
  };
}

/**
 * Tenant isolation check. Platform users (clientId === null) may act on any
 * client. Client-scoped users may only act on their own client_id. Returns true
 * if access is allowed.
 */
export function assertClientAccess(user: JwtPayload, clientId: string | null | undefined): boolean {
  if (user.clientId === null || user.clientId === undefined) return true; // platform user
  return !!clientId && user.clientId === clientId;
}

/** True for platform-level users who may touch cross-tenant/global resources. */
export function isPlatformUser(user: JwtPayload): boolean {
  return user.clientId === null || user.clientId === undefined;
}

/**
 * The client a request is acting on: their own tenant for client users, or the
 * `?clientId` they asked for if they are staff. Returns null when a platform
 * user named no client (i.e. wants the cross-tenant view).
 */
export function resolveClientScope(
  user: JwtPayload,
  requestedClientId?: string | null
): string | null {
  return user.clientId ?? requestedClientId ?? null;
}
