import type { WorkflowDefinition } from '../../types/index.js';

// callback_request — support capability. Capture name, number, best time, and
// reason; schedule_callback persists a trackable callback_requests record and
// alerts staff.

export const callbackRequestWorkflow: WorkflowDefinition = {
  id: 'callback_request',
  capability: 'support',
  intents: ['callback_request', 'call_me_back', 'callback', 'request_callback'],
  scopes: ['support', 'crm'],
  slots: [
    { name: 'caller_name', description: "Caller's name (confirmed)", required: true },
    {
      name: 'phone',
      description: 'Callback number (read back digit by digit)',
      required: true,
      validate: (value) =>
        String(value ?? '').replace(/\D/g, '').length >= 7 ? null : 'That phone number looks incomplete — confirm it digit by digit.',
    },
    { name: 'preferred_time', description: 'Best time to call them back', required: false },
    { name: 'reason', description: 'What the callback is about', required: false },
  ],
  states: ['gather', 'execute', 'complete'],
  transitions: {
    gather: ['execute'],
    execute: ['complete'],
    complete: [],
  },
  outcomes: ['scheduled'],
  guidance: {
    gather:
      'Collect their name, callback number (readback rules), best time, and the topic. Report with ' +
      'update_workflow (slots), then transition_to "execute".',
    execute:
      'Call schedule_callback with the details, then transition_to "complete" with outcome "scheduled".',
    complete: 'Reassure them a team member will call back at their preferred time, and offer further help.',
  },
};
