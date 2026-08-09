import { supabase } from '../db/index.js';
import { invalidatePermissionCache } from './permission.service.js';
import { writeAuditLog } from './audit.service.js';
import {
  CLIENT_ROLES,
  isClientSafePermission,
  type ClientRole,
  type Permission,
} from '../types/index.js';

/**
 * Per-tenant permission overlay.
 *
 * This module is the write path for `client_permission_overrides`, and it is a
 * privilege boundary: the rows it writes are what a tenant's users are allowed
 * to do. Everything here exists to stop a tenant granting itself something
 * outside its own account.
 *
 * Defence in depth, deliberately duplicated:
 *   1. CHECK constraints in migration 022 (role is client-scope, permission is
 *      on the allowlist).
 *   2. The assertions below.
 *   3. A third re-check on READ, in permission.service.getEffectivePermissions.
 *
 * The duplication is the point. A single guard on a privilege boundary is one
 * careless edit away from being no guard.
 */

export class PermissionOverlayError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'unknown-role'
      | 'platform-role'
      | 'unknown-permission'
      | 'not-client-safe'
      | 'owner-lockout'
  ) {
    super(message);
    this.name = 'PermissionOverlayError';
  }
}

export interface OverrideRow {
  role: ClientRole;
  permission: Permission;
  granted: boolean;
  created_by: string | null;
  updated_at: string;
}

function assertClientRole(role: string): asserts role is ClientRole {
  if (!(CLIENT_ROLES as readonly string[]).includes(role)) {
    // Distinguish the two failures: a typo and an escalation attempt deserve
    // different messages, and the second is worth being explicit about.
    const platform = ['super_admin', 'support_agent', 'analyst'].includes(role);
    throw new PermissionOverlayError(
      platform
        ? `${role} is a platform role and cannot be overridden by a tenant`
        : `Unknown role: ${role}`,
      platform ? 'platform-role' : 'unknown-role'
    );
  }
}

function assertClientSafe(permission: string): asserts permission is Permission {
  if (!isClientSafePermission(permission)) {
    throw new PermissionOverlayError(
      `${permission} cannot be granted to a tenant role`,
      'not-client-safe'
    );
  }
}

/**
 * Refuse the one edit that cannot be undone from inside the dashboard.
 *
 * configure:roles is what lets a tenant edit its own overlay. Revoking it from
 * client_owner removes the ability to grant it back, so the tenant is locked out
 * of its own permission management until Gravvia intervenes with SQL. Every
 * other revoke is recoverable by an owner; this one is not.
 */
function assertNoOwnerLockout(role: ClientRole, permission: string, granted: boolean): void {
  if (!granted && role === 'client_owner' && permission === 'configure:roles') {
    throw new PermissionOverlayError(
      'configure:roles cannot be revoked from client_owner — it is the grant that ' +
        'allows permissions to be edited at all, and revoking it locks the tenant ' +
        'out of its own role management.',
      'owner-lockout'
    );
  }
}

/** Every override row for a tenant, newest first. */
export async function listOverrides(clientId: string): Promise<OverrideRow[]> {
  const { data, error } = await supabase
    .from('client_permission_overrides')
    .select('role, permission, granted, created_by, updated_at')
    .eq('client_id', clientId)
    .order('role')
    .order('permission');

  if (error) throw new Error(`Failed to list permission overrides: ${error.message}`);
  return (data ?? []) as OverrideRow[];
}

interface SetOverrideInput {
  clientId: string;
  role: string;
  permission: string;
  granted: boolean;
  actorId: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Add or revoke a grant for one role within one tenant.
 *
 * Upserts on (client_id, role, permission) so flipping a decision replaces the
 * row rather than accumulating history in a table that is read on every request.
 * The history lives in `audit_logs`, which is where it belongs.
 */
export async function setOverride(input: SetOverrideInput): Promise<OverrideRow> {
  const { clientId, role, permission, granted, actorId } = input;

  assertClientRole(role);
  assertClientSafe(permission);
  assertNoOwnerLockout(role, permission, granted);

  const before = await supabase
    .from('client_permission_overrides')
    .select('role, permission, granted')
    .eq('client_id', clientId)
    .eq('role', role)
    .eq('permission', permission)
    .maybeSingle();

  const { data, error } = await supabase
    .from('client_permission_overrides')
    .upsert(
      {
        client_id: clientId,
        role,
        permission,
        granted,
        created_by: actorId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'client_id,role,permission' }
    )
    .select('role, permission, granted, created_by, updated_at')
    .single();

  if (error) throw new Error(`Failed to set permission override: ${error.message}`);

  await writeAuditLog({
    userId: actorId,
    clientId,
    action: granted ? 'permission.grant' : 'permission.revoke',
    entityType: 'client_permission_overrides',
    entityId: undefined,
    oldValue: before.data ?? null,
    newValue: { role, permission, granted },
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  invalidatePermissionCache(role, clientId);
  return data as OverrideRow;
}

interface ClearOverrideInput {
  clientId: string;
  role: string;
  permission: string;
  actorId: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Remove an override, returning the role to its base grants for this tenant.
 *
 * Distinct from `setOverride(granted: false)`: that pins a revoke in place even
 * if the base role later gains the grant. This one steps out of the way.
 */
export async function clearOverride(input: ClearOverrideInput): Promise<void> {
  const { clientId, role, permission, actorId } = input;

  assertClientRole(role);

  const before = await supabase
    .from('client_permission_overrides')
    .select('role, permission, granted')
    .eq('client_id', clientId)
    .eq('role', role)
    .eq('permission', permission)
    .maybeSingle();

  const { error } = await supabase
    .from('client_permission_overrides')
    .delete()
    .eq('client_id', clientId)
    .eq('role', role)
    .eq('permission', permission);

  if (error) throw new Error(`Failed to clear permission override: ${error.message}`);

  await writeAuditLog({
    userId: actorId,
    clientId,
    action: 'permission.reset',
    entityType: 'client_permission_overrides',
    oldValue: before.data ?? null,
    newValue: null,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  invalidatePermissionCache(role, clientId);
}
