import type { WorkflowDefinition } from '../../types/index.js';

// staff_transfer — support capability. Alert/transfer to a human; if no one is
// available, fall back to a callback or a message so the caller is never
// dropped. (Live SIP transfer is a Retell built-in enabled per client when a
// transfer number is configured; request_human_handoff is the deterministic
// notify-and-follow-up path.)

export const staffTransferWorkflow: WorkflowDefinition = {
  id: 'staff_transfer',
  capability: 'support',
  intents: ['staff_transfer', 'speak_to_human', 'talk_to_someone', 'transfer', 'representative'],
  scopes: ['support', 'crm'],
  slots: [
    { name: 'reason', description: 'What they need help with', required: true },
    { name: 'department', description: 'Which team/person, if they specify', required: false },
    { name: 'phone', description: 'Callback number (read back digit by digit)', required: false },
  ],
  states: ['determine', 'transfer', 'fallback', 'complete'],
  transitions: {
    determine: ['transfer', 'fallback'],
    transfer: ['complete', 'fallback'],
    fallback: ['complete'],
    complete: [],
  },
  outcomes: ['transferred', 'callback_scheduled', 'message_taken'],
  guidance: {
    determine:
      'Find out who they need (department/person) and why. If a live transfer is available, transition_to ' +
      '"transfer"; otherwise transition_to "fallback".',
    transfer:
      'Call request_human_handoff with the reason so the team is alerted. If a live transfer connects, great; ' +
      'if not, transition_to "fallback".',
    fallback:
      'Offer a callback (route_intent "callback_request") or to take a message (leave_staff_message). ' +
      'Then transition_to "complete" with the matching outcome.',
    complete: 'Reassure them someone will follow up and ask if there is anything else in the meantime.',
  },
};
