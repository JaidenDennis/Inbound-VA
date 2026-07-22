import type { WorkflowDefinition } from '../../types/index.js';

// complaint — support capability. Empathize, capture the issue and urgency,
// create a ticket (create_complaint), and escalate to a manager.

export const complaintWorkflow: WorkflowDefinition = {
  id: 'complaint',
  capability: 'support',
  intents: ['complaint', 'issue', 'unhappy', 'problem', 'bad_experience'],
  scopes: ['support', 'crm'],
  slots: [
    { name: 'caller_name', description: "Caller's name (confirmed)", required: true },
    {
      name: 'phone',
      description: "Caller's phone number (read back digit by digit)",
      required: true,
      validate: (value) =>
        String(value ?? '').replace(/\D/g, '').length >= 7 ? null : 'That phone number looks incomplete — confirm it digit by digit.',
    },
    { name: 'issue', description: 'What went wrong, in their words', required: true },
    { name: 'urgency', description: 'How urgent (low/normal/high/urgent)', required: false },
  ],
  states: ['listen', 'log', 'complete'],
  transitions: {
    listen: ['log'],
    log: ['complete'],
    complete: [],
  },
  outcomes: ['logged', 'escalated'],
  guidance: {
    listen:
      'Let them explain fully and empathize sincerely — never be defensive or argue. Capture their name, ' +
      'phone, the issue, and how urgent it is. Report with update_workflow (slots), then transition_to "log".',
    log:
      'Call create_complaint with the details. Then transition_to "complete" with outcome "logged".',
    complete:
      'Apologize again, confirm it has been escalated to a manager, and assure them someone will follow up.',
  },
};
