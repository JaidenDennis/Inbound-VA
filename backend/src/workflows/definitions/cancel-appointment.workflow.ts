import type { WorkflowDefinition } from '../../types/index.js';

// cancel_appointment — appointments capability. Locate by confirmed phone,
// apply the client's cancellation policy (backend decides whether it applies;
// the agent reads it verbatim), execute via cancel_appointment.

export const cancelAppointmentWorkflow: WorkflowDefinition = {
  id: 'cancel_appointment',
  capability: 'appointments',
  intents: ['cancel_appointment', 'cancel_booking', 'cancellation'],
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
    { name: 'reason', description: 'Why they are cancelling, if they share it', required: false },
  ],
  states: ['locate', 'confirm', 'execute', 'complete'],
  transitions: {
    locate: ['confirm'],
    confirm: ['execute', 'complete'],
    execute: ['complete'],
    complete: [],
  },
  outcomes: ['cancelled', 'kept', 'not_found'],
  guidance: {
    locate:
      'Confirm the caller\'s name and phone, then call find_appointment with the phone and read back the ' +
      'appointment they mean. If none is found, complete with outcome "not_found". Then transition_to "confirm".',
    confirm:
      'Confirm they want to cancel (offer to reschedule instead — route_intent "reschedule_appointment" if ' +
      'they prefer). If they keep it, complete with outcome "kept". Otherwise transition_to "execute".',
    execute:
      'Call cancel_appointment. If the response says the cancellation policy applies, read the policy text to ' +
      'the caller EXACTLY as returned. Then transition_to "complete" and complete with outcome "cancelled".',
    complete: 'Confirm the cancellation warmly and offer to rebook whenever they are ready.',
  },
};
