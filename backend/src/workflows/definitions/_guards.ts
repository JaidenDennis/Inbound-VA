import type { WorkflowGuard } from '../../types/index.js';

// Shared guard builder for account workflows: the given states cannot be
// entered until the caller's identity is verified in the session. The scope
// guard independently enforces requiresVerifiedIdentity on the actions
// themselves — this guard makes the STATE machine refuse to advance too, so the
// agent gets clear "verify first" guidance instead of a bare action denial.
export function requireVerifiedIdentity(...states: string[]): WorkflowGuard {
  return {
    name: 'identity_verified',
    states,
    check: (session) => session.identityVerified,
    failureGuidance:
      "Before sharing any account information, verify the caller's identity: collect their phone plus one " +
      'corroborating factor (email, date of birth, or an appointment reference) and call verify_identity. ' +
      'Only continue once it confirms them.',
  };
}
