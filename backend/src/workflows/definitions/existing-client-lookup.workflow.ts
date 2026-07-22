import type { WorkflowDefinition } from '../../types/index.js';
import { requireVerifiedIdentity } from './_guards.js';

// existing_client_lookup — account capability. Authenticated profile retrieval:
// identity must be verified before the profile is read back.

export const existingClientLookupWorkflow: WorkflowDefinition = {
  id: 'existing_client_lookup',
  capability: 'account',
  intents: ['existing_client_lookup', 'my_account', 'account_lookup', 'my_profile'],
  scopes: ['crm', 'support'],
  slots: [
    {
      name: 'phone',
      description: "Caller's phone number (read back digit by digit)",
      required: true,
      validate: (value) =>
        String(value ?? '').replace(/\D/g, '').length >= 7 ? null : 'That phone number looks incomplete — confirm it digit by digit.',
    },
  ],
  states: ['verify_identity', 'lookup', 'complete'],
  transitions: {
    verify_identity: ['lookup'],
    lookup: ['complete'],
    complete: [],
  },
  guards: [requireVerifiedIdentity('lookup')],
  outcomes: ['retrieved', 'not_verified', 'not_found'],
  guidance: {
    verify_identity:
      'Verify the caller (verify_identity with phone + one corroborating factor). Once confirmed, ' +
      'transition_to "lookup".',
    lookup:
      'Call lookup_existing_client with the confirmed phone and read back their profile naturally. Then ' +
      'transition_to "complete" with outcome "retrieved".',
    complete: 'Ask what they would like to do with their account.',
  },
};
