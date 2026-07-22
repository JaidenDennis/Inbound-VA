import type { WorkflowDefinition } from '../../types/index.js';

// existing_appointment_inquiry — appointments capability. Light identity check
// (confirmed name + phone), look up, read back details. No account data beyond
// the caller's own appointments is exposed.

export const appointmentInquiryWorkflow: WorkflowDefinition = {
  id: 'existing_appointment_inquiry',
  capability: 'appointments',
  intents: ['existing_appointment_inquiry', 'appointment_inquiry', 'check_appointment', 'when_is_my_appointment'],
  scopes: ['booking', 'crm', 'support'],
  slots: [
    { name: 'name', description: "Caller's name (confirmed)", required: true },
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
  outcomes: ['provided', 'not_found'],
  guidance: {
    verify_identity:
      'Confirm the caller\'s name (spell back) and phone (digit by digit). Report them with update_workflow ' +
      '(slots), then transition_to "lookup".',
    lookup:
      'Call find_appointment with the confirmed phone and read back their upcoming appointment details ' +
      'naturally (date, time, service). If none, complete with outcome "not_found" and offer to book. ' +
      'Otherwise transition_to "complete" and complete with outcome "provided".',
    complete: 'Ask if they would like to change anything about the appointment, or help with anything else.',
  },
};
