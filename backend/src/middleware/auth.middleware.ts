import type { FastifyRequest, FastifyReply } from 'fastify';
import type { JwtPayload, Permission } from '../types/index.js';
import { ROLE_PERMISSIONS } from '../types/index.js';

declare module 'fastify' {
  interface FastifyRequest {
    jwtUser: JwtPayload;
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

export function requirePermission(permission: Permission) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      await request.jwtVerify();
      const user = request.user as JwtPayload;
      const permissions = ROLE_PERMISSIONS[user.role] ?? [];
      if (!permissions.includes(permission)) {
        reply.code(403).send({ error: 'Forbidden' });
        return;
      }
      request.jwtUser = user;
    } catch {
      reply.code(401).send({ error: 'Unauthorized' });
    }
  };
}

/**
 * Tenant isolation check. Platform users (clientId === null, e.g. super_admin /
 * admin) may act on any client. Client-scoped users may only act on their own
 * client_id. Returns true if access is allowed.
 */
export function assertClientAccess(user: JwtPayload, clientId: string | null | undefined): boolean {
  if (user.clientId === null || user.clientId === undefined) return true; // platform user
  return !!clientId && user.clientId === clientId;
}

/** True for platform-level users who may touch cross-tenant/global resources. */
export function isPlatformUser(user: JwtPayload): boolean {
  return user.clientId === null || user.clientId === undefined;
}
