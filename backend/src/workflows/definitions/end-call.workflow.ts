import type { WorkflowDefinition } from '../../types/index.js';

// end_call — system capability. Summarize outcomes, offer one last chance to
// help, then hang up cleanly via the built-in end_call tool. Declarative only:
// no engine or control-flow logic belongs in this file.

export const endCallWorkflow: WorkflowDefinition = {
  id: 'end_call',
  capability: 'system',
  intents: ['end_call', 'goodbye', 'hang_up'],
  scopes: ['system'],
  slots: [],
  states: ['summarize', 'complete'],
  transitions: {
    summarize: ['complete'],
    complete: [],
  },
  outcomes: ['ended', 'continued'],
  guidance: {
    summarize:
      'Briefly recap what was accomplished this call (anything booked, messages taken, callbacks scheduled), ' +
      'then ask "Is there anything else I can help you with today?" and WAIT for the answer. ' +
      'If they raise a new topic, call route_intent with that intent instead of ending. ' +
      'If they are all set, call update_workflow with transition_to "complete".',
    complete:
      'Give a warm, unhurried goodbye and let it finish completely, then use the end_call tool to hang up. ' +
      'Never hang up mid-sentence or while the caller is still talking.',
  },
};
