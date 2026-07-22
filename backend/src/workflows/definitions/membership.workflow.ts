import type { WorkflowDefinition } from '../../types/index.js';
import { requireVerifiedIdentity } from './_guards.js';

// membership — account capability. Balance, freeze, upgrade, cancel, benefits.
// Identity-gated. membership_lookup degrades gracefully (no dedicated backend):
// general info now, specifics routed to staff.

export const membershipWorkflow: WorkflowDefinition = {
  id: 'membership',
  capability: 'account',
  intents: ['membership', 'my_membership', 'loyalty', 'membership_benefits'],
  scopes: ['crm', 'payments', 'support'],
  slots: [
    {
      name: 'phone',
      description: "Caller's phone number (read back digit by digit)",
      required: true,
      validate: (value) =>
        String(value ?? '').replace(/\D/g, '').length >= 7 ? null : 'That phone number looks incomplete — confirm it digit by digit.',
    },
    { name: 'request', description: 'What they want (benefits, balance, freeze, upgrade, cancel)', required: false },
  ],
  states: ['verify_identity', 'lookup', 'complete'],
  transitions: {
    verify_identity: ['lookup'],
    lookup: ['complete'],
    complete: [],
  },
  guards: [requireVerifiedIdentity('lookup')],
  outcomes: ['answered', 'escalated', 'not_verified'],
  guidance: {
    verify_identity: 'Verify the caller (verify_identity) before discussing their membership. Then transition_to "lookup".',
    lookup:
      'Call membership_lookup. Share general program benefits from the result. For a specific balance, freeze, ' +
      'upgrade, or cancellation, take the request for the team — never quote an account figure you cannot ' +
      'verify. Then transition_to "complete" with outcome "answered" (or "escalated").',
    complete: 'Ask if there is anything else about their membership or account.',
  },
};
