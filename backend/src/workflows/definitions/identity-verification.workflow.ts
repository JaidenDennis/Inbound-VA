import type { WorkflowDefinition } from '../../types/index.js';

// identity_verification — account capability. Verifies the caller before any
// account data is exposed. The verify_identity tool sets the session's
// verification status, which the scope guard then consumes for every account
// action. This standalone workflow is for explicit "verify me" requests; the
// account workflows also verify inline via their identity guards.

export const identityVerificationWorkflow: WorkflowDefinition = {
  id: 'identity_verification',
  capability: 'account',
  intents: ['identity_verification', 'verify_identity', 'authenticate'],
  scopes: ['crm', 'support'],
  slots: [
    {
      name: 'phone',
      description: "Caller's phone number (read back digit by digit)",
      required: true,
      validate: (value) =>
        String(value ?? '').replace(/\D/g, '').length >= 7 ? null : 'That phone number looks incomplete — confirm it digit by digit.',
    },
    { name: 'email', description: "Caller's email on file (a verification factor)", required: false },
    { name: 'dob', description: "Caller's date of birth (a verification factor)", required: false },
    { name: 'appointment_reference', description: 'An appointment reference (a verification factor)', required: false },
  ],
  states: ['verify', 'complete'],
  transitions: {
    verify: ['complete'],
    complete: [],
  },
  outcomes: ['verified', 'failed'],
  guidance: {
    verify:
      'Collect the caller\'s phone plus at least one corroborating factor (email, date of birth, or an ' +
      'appointment reference). Call verify_identity with them. If it returns verified, transition_to ' +
      '"complete" with outcome "verified". If not, do NOT share any account details — offer to take a message.',
    complete: 'Confirm they are verified and ask what account information they need.',
  },
};
