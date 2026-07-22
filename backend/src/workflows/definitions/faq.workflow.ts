import type { WorkflowDefinition } from '../../types/index.js';

// faq — knowledge capability. Hours, address, parking, insurance, payment
// methods, preparation, products, gift cards, policies. The answer comes from
// knowledge_search (faqs table + client_settings fallback), never invention.

export const faqWorkflow: WorkflowDefinition = {
  id: 'faq',
  capability: 'knowledge',
  intents: ['faq', 'hours', 'address', 'parking', 'insurance', 'payment_methods', 'gift_cards', 'policy_question'],
  scopes: ['knowledge', 'support'],
  slots: [
    {
      name: 'question',
      description: "The caller's question in their own words",
      required: false,
    },
  ],
  states: ['answer', 'complete'],
  transitions: {
    answer: ['complete'],
    complete: [],
  },
  outcomes: ['answered', 'unanswered'],
  guidance: {
    answer:
      "Call knowledge_search with the caller's question. Answer ONLY from what it returns — never invent " +
      'facts, hours, or policies. If nothing matches, offer a callback (schedule_callback) or take a message ' +
      '(leave_staff_message). When the caller is satisfied, call update_workflow with complete_outcome ' +
      '"answered" (or "unanswered" if you could not help).',
    complete: 'Ask if there is anything else you can help with.',
  },
};
