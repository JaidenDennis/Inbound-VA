import type { WorkflowDefinition } from '../../types/index.js';

// waitlist — appointments capability. Capture preferred days/times; automation
// notifies staff when an opening appears (waitlist.added event).

export const waitlistWorkflow: WorkflowDefinition = {
  id: 'waitlist',
  capability: 'appointments',
  intents: ['waitlist', 'join_waitlist', 'wait_list'],
  scopes: ['booking', 'crm', 'support'],
  slots: [
    { name: 'name', description: "Caller's full name (confirmed)", required: true },
    {
      name: 'phone',
      description: "Caller's phone number (read back digit by digit)",
      required: true,
      validate: (value) =>
        String(value ?? '').replace(/\D/g, '').length >= 7 ? null : 'That phone number looks incomplete — confirm it digit by digit.',
    },
    { name: 'service', description: 'Which service they are waiting for', required: false },
    { name: 'preferred_days', description: 'Days that work for them (e.g. ["monday","wednesday"])', required: false },
    { name: 'preferred_times', description: 'Times of day that work ("mornings", "after 5pm")', required: false },
  ],
  states: ['gather', 'execute', 'complete'],
  transitions: {
    gather: ['execute'],
    execute: ['complete'],
    complete: [],
  },
  action: { state: 'execute', name: 'waitlist.add', outcomeOnSuccess: 'added', outcomeOnFailure: 'added', completeOnSuccess: true },
  outcomes: ['added', 'declined'],
  guidance: {
    gather:
      'Collect their name, phone (readback rules), the service they want, and which days/times work. Report ' +
      'with update_workflow (slots), then transition_to "execute" — the backend adds them automatically.',
    execute: 'The waitlist entry is being saved by the backend. Speak the confirmation it returns.',
    complete: 'Reassure them the team will reach out the moment an opening appears, and offer further help.',
  },
};
