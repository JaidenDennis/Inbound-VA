import type { WorkflowDefinition } from '../../types/index.js';

// promotions — knowledge capability. Share currently-active offers (date
// windows enforced by the backend) and their eligibility rules.

export const promotionsWorkflow: WorkflowDefinition = {
  id: 'promotions',
  capability: 'knowledge',
  intents: ['promotions', 'specials', 'discounts', 'offers', 'deals'],
  scopes: ['knowledge', 'support'],
  slots: [],
  states: ['share', 'complete'],
  transitions: {
    share: ['complete'],
    complete: [],
  },
  outcomes: ['shared', 'none_active'],
  guidance: {
    share:
      'Call knowledge_search with "promotions" (or the caller\'s question). Share ONLY the active offers it ' +
      'returns, including any eligibility conditions word-for-word. The backend already filtered out expired ' +
      'offers — never resurrect one the caller remembers if it is not in the results. If there are none, say ' +
      'there are no current promotions and offer to help another way. Complete with outcome "shared" or ' +
      '"none_active".',
    complete: 'Offer to book or ask if there is anything else you can help with.',
  },
};
