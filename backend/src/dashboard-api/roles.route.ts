import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  listOverrides,
  setOverride,
  clearOverride,
  PermissionOverlayError,
  getEffectivePermissions,
  getRolePermissions,
} from '../services/index.js';
import { requirePermission, assertClientAccess } from '../middleware/index.js';
import {
  CLIENT_ROLES,
  CLIENT_SAFE_PERMISSIONS,
  type ClientRole,
  type JwtPayload,
} from '../types/index.js';

/**
 * Tenant role management.
 *
 * Every route here is gated on `configure:roles`, which only `client_owner` and
 * platform staff hold. It is the single grant separating Owner from Admin, and
 * this file is the whole reason it exists.
 *
 * Tenancy: a client user is pinned to their own tenant regardless of what they
 * pass; platform staff name a tenant in the path. `assertClientAccess` is the
 * boundary, as everywhere else.
 */

const roleParam = z.enum(CLIENT_ROLES as unknown as [ClientRole, ...ClientRole[]]);
const permissionBody = z.object({
  permission: z.enum(CLIENT_SAFE_PERMISSIONS as unknown as [string, ...string[]]),
  granted: z.boolean(),
});

/** Map an overlay rejection onto a status code and a message worth reading. */
function overlayFailure(err: unknown): { status: number; body: { error: string } } | null {
  if (!(err instanceof PermissionOverlayError)) return null;
  const status = err.code === 'platform-role' || err.code === 'not-client-safe' ? 403 : 400;
  return { status, body: { error: err.message } };
}

export async function roleRoutes(app: FastifyInstance): Promise<void> {
  /**
   * The tenant's effective grants, per role.
   *
   * Returns base and effective side by side rather than effective alone — the UI
   * has to show which grants are inherited and which were changed here, and
   * recomputing that in the browser would put the escalation rules in two places.
   */
  app.get<{ Params: { id: string } }>('/clients/:id/roles', {
    preHandler: requirePermission('users:read'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const clientId = user.clientId ?? request.params.id;
      if (!assertClientAccess(user, clientId)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      const overrides = await listOverrides(clientId);
      const roles = await Promise.all(
        CLIENT_ROLES.map(async (role) => ({
          role,
          base: [...(await getRolePermissions(role))].sort(),
          effective: [...(await getEffectivePermissions(role, clientId))].sort(),
          overrides: overrides
            .filter((o) => o.role === role)
            .map(({ permission, granted, updated_at }) => ({ permission, granted, updated_at })),
        }))
      );

      reply.send({ clientId, assignable: CLIENT_SAFE_PERMISSIONS, roles });
    },
  });

  /** Grant or revoke one permission for one role within this tenant. */
  app.patch<{ Params: { id: string; role: string }; Body: unknown }>('/clients/:id/roles/:role', {
    preHandler: requirePermission('configure:roles'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const clientId = user.clientId ?? request.params.id;
      if (!assertClientAccess(user, clientId)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      const role = roleParam.safeParse(request.params.role);
      if (!role.success) return reply.code(400).send({ error: 'Unknown client role' });

      const body = permissionBody.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: 'permission must be a tenant-assignable grant' });
      }

      try {
        const row = await setOverride({
          clientId,
          role: role.data,
          permission: body.data.permission,
          granted: body.data.granted,
          actorId: user.sub,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        });
        reply.send(row);
      } catch (err) {
        const mapped = overlayFailure(err);
        if (mapped) return reply.code(mapped.status).send(mapped.body);
        throw err;
      }
    },
  });

  /** Drop an override, returning the role to its base grants for this tenant. */
  app.delete<{ Params: { id: string; role: string; permission: string } }>(
    '/clients/:id/roles/:role/:permission',
    {
      preHandler: requirePermission('configure:roles'),
      handler: async (request, reply) => {
        const user = request.user as JwtPayload;
        const clientId = user.clientId ?? request.params.id;
        if (!assertClientAccess(user, clientId)) {
          return reply.code(403).send({ error: 'Forbidden' });
        }

        const role = roleParam.safeParse(request.params.role);
        if (!role.success) return reply.code(400).send({ error: 'Unknown client role' });

        try {
          await clearOverride({
            clientId,
            role: role.data,
            permission: request.params.permission,
            actorId: user.sub,
            ipAddress: request.ip,
            userAgent: request.headers['user-agent'],
          });
          reply.code(204).send();
        } catch (err) {
          const mapped = overlayFailure(err);
          if (mapped) return reply.code(mapped.status).send(mapped.body);
          throw err;
        }
      },
    }
  );
}
