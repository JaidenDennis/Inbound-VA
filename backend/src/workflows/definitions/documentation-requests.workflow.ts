import type { WorkflowDefinition } from '../../types/index.js';
import { requireVerifiedIdentity } from './_guards.js';

// documentation_requests — account capability. Receipts, invoices, medical
// records, consent forms. Identity-gated; request-only. Medical records are
// NEVER read over the phone — the tool creates a staff request instead.

export const documentationRequestsWorkflow: WorkflowDefinition = {
  id: 'documentation_requests',
  capability: 'account',
  intents: ['documentation_requests', 'records_request', 'receipt', 'invoice', 'medical_records'],
  scopes: ['crm', 'support'],
  slots: [
    {
      name: 'phone',
      description: "Caller's phone number (read back digit by digit)",
      required: true,
      validate: (value) =>
        String(value ?? '').replace(/\D/g, '').length >= 7 ? null : 'That phone number looks incomplete — confirm it digit by digit.',
    },
    { name: 'document_type', description: 'Which document (receipt, invoice, medical records, consent form)', required: true },
    { name: 'details', description: 'Any specifics (date, service)', required: false },
  ],
  states: ['verify_identity', 'submit', 'complete'],
  transitions: {
    verify_identity: ['submit'],
    submit: ['complete'],
    complete: [],
  },
  guards: [requireVerifiedIdentity('submit')],
  outcomes: ['submitted', 'not_verified'],
  guidance: {
    verify_identity: 'Verify the caller (verify_identity) before taking a document request. Then transition_to "submit".',
    submit:
      'Call documentation_request with the document type and any details. If it flags the request as medical, ' +
      'reassure them records are released securely by the team — NEVER read record content aloud. Then ' +
      'transition_to "complete" with outcome "submitted".',
    complete: 'Confirm the request is logged and ask if there is anything else.',
  },
};
