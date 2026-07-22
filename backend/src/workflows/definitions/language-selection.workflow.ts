import type { WorkflowDefinition } from '../../types/index.js';

// language_selection — system capability. Detect or ask the caller's preferred
// language and switch to it (set_language records the preference; voice/prompt
// switching via Retell dynamic variables plugs in here later).

export const languageSelectionWorkflow: WorkflowDefinition = {
  id: 'language_selection',
  capability: 'system',
  intents: ['language_selection', 'language', 'spanish', 'espanol', 'change_language'],
  scopes: ['system'],
  slots: [
    { name: 'language', description: 'The language they prefer (e.g. English, Spanish)', required: true },
  ],
  states: ['select', 'complete'],
  transitions: {
    select: ['complete'],
    complete: [],
  },
  outcomes: ['switched'],
  guidance: {
    select:
      'Confirm which language they prefer, report it with update_workflow (slots), and call set_language. ' +
      'Then transition_to "complete" with outcome "switched".',
    complete: 'Continue the conversation in their chosen language and ask how you can help.',
  },
};
