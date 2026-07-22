import type { WorkflowDefinition } from '../../types/index.js';

// intake_forms — leads capability. Caller asks about forms for an upcoming
// service: determine if forms are needed and send them.

export const intakeFormsWorkflow: WorkflowDefinition = {
  id: 'intake_forms',
  capability: 'leads',
  intents: ['intake_forms', 'forms', 'paperwork', 'consent_forms'],
  scopes: ['crm', 'booking', 'support'],
  slots: [
    { name: 'name', description: "Caller's name (confirmed)", required: true },
    {
      name: 'phone',
      description: "Caller's phone number (read back digit by digit)",
      required: true,
      validate: (value) =>
        String(value ?? '').replace(/\D/g, '').length >= 7 ? null : 'That phone number looks incomplete — confirm it digit by digit.',
    },
    { name: 'email', description: "Caller's email to send the forms to", required: false },
  ],
  states: ['determine', 'send', 'complete'],
  transitions: {
    determine: ['send', 'complete'],
    send: ['complete'],
    complete: [],
  },
  outcomes: ['sent', 'not_needed', 'staff_will_send'],
  guidance: {
    determine:
      'Check whether they have an upcoming appointment (find_appointment with their confirmed phone) and ' +
      'whether forms apply to that service per your instructions. If no forms are needed, complete with ' +
      'outcome "not_needed". Otherwise collect their email and transition_to "send".',
    send:
      'Call forms_send with their details. Then transition_to "complete" and complete with outcome "sent" ' +
      '(or "staff_will_send" when the response says staff will handle it).',
    complete: 'Confirm the forms are on their way and ask if there is anything else.',
  },
};
