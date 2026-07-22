import type { WorkflowDefinition } from '../../types/index.js';

// general_information — knowledge capability. Fallback informational intent
// when the caller's question doesn't fit a more specific workflow.

export const generalInformationWorkflow: WorkflowDefinition = {
  id: 'general_information',
  capability: 'knowledge',
  intents: ['general_information', 'general_question', 'information'],
  scopes: ['knowledge', 'support'],
  slots: [],
  states: ['answer', 'complete'],
  transitions: {
    answer: ['complete'],
    complete: [],
  },
  outcomes: ['answered', 'unanswered'],
  guidance: {
    answer:
      "Call knowledge_search with the caller's question and answer only from the results and the knowledge " +
      'in your instructions. If you cannot answer, offer a callback (schedule_callback) or a message for the ' +
      'team (leave_staff_message). Complete with outcome "answered" or "unanswered".',
    complete: 'Ask if there is anything else you can help with.',
  },
};
