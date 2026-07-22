import type { WorkflowDefinition } from '../../types/index.js';

// multi_location_routing — system capability. Determine the caller's
// nearest/preferred location and set it in the conversation context so later
// routing and booking use it.

export const multiLocationRoutingWorkflow: WorkflowDefinition = {
  id: 'multi_location_routing',
  capability: 'system',
  intents: ['multi_location_routing', 'location', 'which_location', 'nearest_location'],
  scopes: ['system', 'knowledge'],
  slots: [
    { name: 'location', description: 'The location they want (name or area)', required: true },
  ],
  states: ['determine', 'complete'],
  transitions: {
    determine: ['complete'],
    complete: [],
  },
  outcomes: ['selected'],
  guidance: {
    determine:
      'Help them pick the right location (use knowledge_search for addresses/areas if needed). Once chosen, ' +
      'report it with update_workflow (slots) and call set_location, then transition_to "complete" with ' +
      'outcome "selected".',
    complete: 'Confirm the location and continue helping with what they originally needed.',
  },
};
