import type { WorkflowDefinition } from '../../types/index.js';

// reschedule_appointment — appointments capability. Locate by confirmed phone,
// offer new times from availability, execute via reschedule_appointment (which
// also pushes the change to the CRM calendar).

export const rescheduleAppointmentWorkflow: WorkflowDefinition = {
  id: 'reschedule_appointment',
  capability: 'appointments',
  intents: ['reschedule_appointment', 'reschedule', 'change_appointment', 'move_appointment'],
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
    { name: 'new_time', description: 'The new date/time they want (ISO 8601 once confirmed)', required: false },
  ],
  states: ['locate', 'offer_times', 'execute', 'complete'],
  transitions: {
    locate: ['offer_times'],
    offer_times: ['execute', 'offer_times'],
    execute: ['complete', 'offer_times'],
    complete: [],
  },
  outcomes: ['rescheduled', 'unchanged', 'not_found'],
  guidance: {
    locate:
      'Confirm the caller\'s name and phone, then call find_appointment with the phone. Read back the ' +
      'appointment they mean (date, time, service — never the internal id). If none is found, offer to book ' +
      'instead. Then transition_to "offer_times".',
    offer_times:
      'Call check_availability for the day they prefer and offer open times. When they pick one, update the ' +
      'new_time slot and transition_to "execute".',
    execute:
      'Call reschedule_appointment with the appointment and the confirmed new time. On success transition_to ' +
      '"complete" and complete with outcome "rescheduled". If the slot is taken, return to offer_times.',
    complete: 'Read back the new date and time, confirm they are all set, and offer further help.',
  },
};
