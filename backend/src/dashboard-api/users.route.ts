import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { userService, writeAuditLog } from '../services/index.js';
import { requirePermission, assertClientAccess, isPlatformUser } from '../middleware/index.js';
import { ALL_ROLES, CLIENT_ROLES, roleScope, type JwtPayload, type UserRole } from '../types/index.js';

const roleEnum = z.enum(ALL_ROLES as unknown as [UserRole, ...UserRole[]]);

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
  role: roleEnum,
  clientId: z.string().uuid().nullable().optional(),
});

const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  role: roleEnum.optional(),
  is_active: z.boolean().optional(),
  password: z.string().min(8).optional(),
});

// Roles a client-scoped owner may assign. Platform roles are absent by
// construction, so there is no path from a tenant account to staff access.
const TENANT_ASSIGNABLE_ROLES = new Set<UserRole>(CLIENT_ROLES);

/**
 * A platform role requires no tenant; a client role requires one. Returns an
 * error message when the pairing is invalid, or null when it is fine.
 */
function validateRoleScope(role: UserRole, clientId: string | null): string | null {
  const scope = roleScope(role);
  if (scope === 'platform' && clientId !== null) {
    return `Role ${role} is a platform role and cannot be scoped to a client`;
  }
  if (scope === 'client' && clientId === null) {
    return `Role ${role} is a client role and requires a client`;
  }
  return null;
}

export async function userRoutes(app: FastifyInstance): Promise<void> {
  // List users — scoped to tenant for client-scoped admins
  app.get<{ Querystring: { clientId?: string; page?: string } }>('/users', {
    preHandler: requirePermission('users:read'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const clientId = user.clientId ?? request.query.clientId ?? null;
      if (user.clientId && !assertClientAccess(user, clientId)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const result = await userService.list(clientId, Number(request.query.page ?? 1));
      reply.send(result);
    },
  });

  // Create user
  app.post('/users', {
    preHandler: requirePermission('users:write'),
    handler: async (request, reply) => {
      const actor = request.user as JwtPayload;
      const body = createUserSchema.parse(request.body);

      let targetClientId: string | null;
      const targetRole = body.role;

      if (isPlatformUser(actor)) {
        // Platform users may create any role for any tenant (or platform users).
        targetClientId = body.clientId ?? null;
      } else {
        // Client-scoped owners may only create users within their own tenant
        // and may not escalate to a platform role.
        targetClientId = actor.clientId;
        if (!TENANT_ASSIGNABLE_ROLES.has(targetRole)) {
          return reply.code(403).send({ error: 'Cannot assign that role' });
        }
        if (body.clientId && body.clientId !== actor.clientId) {
          return reply.code(403).send({ error: 'Cannot create users for another client' });
        }
      }

      // Role family must match tenancy. Migration 016 enforces this in the
      // database too; rejecting here gives a usable error instead of a 500 from
      // a constraint violation, and keeps the two rules stated in one place.
      const scopeError = validateRoleScope(targetRole, targetClientId);
      if (scopeError) return reply.code(400).send({ error: scopeError });

      try {
        const created = await userService.create({
          email: body.email,
          name: body.name,
          password: body.password,
          role: targetRole,
          client_id: targetClientId,
        });
        await writeAuditLog({
          userId: actor.sub,
          clientId: targetClientId ?? undefined,
          action: 'user.created',
          entityType: 'user',
          entityId: created.id,
          newValue: { email: created.email, role: created.role, client_id: created.client_id },
          ipAddress: request.ip,
        });
        reply.code(201).send(created);
      } catch (err) {
        reply.code(409).send({ error: (err as Error).message });
      }
    },
  });

  // Update user (rename, change role, activate/deactivate, reset password)
  app.patch<{ Params: { id: string } }>('/users/:id', {
    preHandler: requirePermission('users:write'),
    handler: async (request, reply) => {
      const actor = request.user as JwtPayload;
      const body = updateUserSchema.parse(request.body);

      const target = await userService.findById(request.params.id);
      if (!target) return reply.code(404).send({ error: 'Not found' });

      // Tenant isolation: client-scoped admins may only manage their own users.
      if (!assertClientAccess(actor, target.client_id)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      // No privilege escalation by client-scoped owners.
      if (!isPlatformUser(actor) && body.role && !TENANT_ASSIGNABLE_ROLES.has(body.role)) {
        return reply.code(403).send({ error: 'Cannot assign that role' });
      }
      // A role change must not move the user across role families — that would
      // either strand a staff account inside a tenant or hand a tenant user
      // cross-tenant reach.
      if (body.role) {
        const scopeError = validateRoleScope(body.role, target.client_id);
        if (scopeError) return reply.code(400).send({ error: scopeError });
      }
      // Prevent locking yourself out.
      if (body.is_active === false && target.id === actor.sub) {
        return reply.code(400).send({ error: 'You cannot deactivate your own account' });
      }

      const updated = await userService.update(request.params.id, body);
      await writeAuditLog({
        userId: actor.sub,
        clientId: target.client_id ?? undefined,
        action: 'user.updated',
        entityType: 'user',
        entityId: target.id,
        oldValue: { role: target.role, is_active: target.is_active },
        newValue: { role: updated.role, is_active: updated.is_active },
        ipAddress: request.ip,
      });
      reply.send(updated);
    },
  });
}
