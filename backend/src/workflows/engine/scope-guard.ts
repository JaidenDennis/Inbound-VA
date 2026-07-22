import type { FastifyReply, FastifyRequest } from 'fastify';
import { logger } from '../../utils/index.js';
import { writeAuditLog } from '../../services/audit.service.js';
import { findSession } from './session-store.js';
import { getActionMetadata } from './action-metadata.js';

// Scope enforcement for Retell tool invocations. Runs AFTER signature
// validation. For routing-enabled calls (call_sessions.state.routingEnabled)
// every tool must be within the scopes granted by the active workflow — a
// drifting or hallucinating model cannot execute anything outside its grant.
// Legacy calls (no session / routing disabled) pass through untouched so
// already-provisioned agents keep working.

interface ToolBody {
  call?: { call_id?: string };
}

/**
 * Fastify preHandler factory: enforce the named tool's scope + identity
 * requirements against the caller's live session. Denials answer 200 with
 * `denied: true` and recovery guidance — the LLM reads the body, so a
 * conversational nudge back to route_intent beats an opaque 4xx.
 */
export function enforceScope(toolName: string) {
  const meta = getActionMetadata(toolName); // throws at boot if undeclared

  return async function scopeGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (meta.scope === 'system') return; // routing/safety tools are never gated

    const retellCallId = (request.body as ToolBody | undefined)?.call?.call_id;
    if (!retellCallId) return; // nothing to gate against (test/manual invocation)

    const session = await findSession(retellCallId);
    if (!session || !session.state?.routingEnabled) return; // legacy agent — pass through

    const granted = session.state.grantedScopes ?? [];
    const scopeOk = granted.includes(meta.scope);
    const identityOk = !meta.requiresVerifiedIdentity || session.state.identityVerified;

    if (scopeOk && identityOk) return;

    logger.warn(
      { toolName, action: meta.action, scope: meta.scope, granted, retellCallId },
      'Scope guard denied tool invocation'
    );
    await writeAuditLog({
      clientId: session.client_id,
      action: 'workflow.scope.denied',
      entityType: 'call_session',
      entityId: session.id,
      newValue: { tool: toolName, requiredScope: meta.scope, grantedScopes: granted, identityOk },
    });

    reply.send({
      denied: true,
      message: !scopeOk
        ? 'That action is not available for the current topic. Call route_intent with the caller\'s intent first, then follow its guidance.'
        : 'This requires the caller\'s identity to be verified first. Verify their identity before accessing this information.',
    });
  };
}
