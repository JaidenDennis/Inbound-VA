import type { WorkflowDefinition } from '../../types/index.js';

// pricing — knowledge capability. Return pricing from the pricing/services
// knowledge; surface member pricing and package upsells where defined. Never
// invent a number — that rule is enforced by answering only from
// knowledge_search results.

export const pricingWorkflow: WorkflowDefinition = {
  id: 'pricing',
  capability: 'knowledge',
  intents: ['pricing', 'price_inquiry', 'cost', 'how_much'],
  scopes: ['knowledge', 'support'],
  slots: [
    {
      name: 'service',
      description: 'Which service or treatment they are asking about',
      required: true,
      // Validate against the client's configured menu when one exists;
      // clients without configured services accept any label (search decides).
      validate: (value, ctx) => {
        const services = ctx.settings?.services ?? [];
        if (!services.length) return null;
        const name = String(value ?? '').toLowerCase();
        return services.some(
          (s) => s.name.toLowerCase().includes(name) || name.includes(s.name.toLowerCase())
        )
          ? null
          : 'That service is not on this client\'s menu — ask which listed service they mean.';
      },
    },
    {
      name: 'existing_customer',
      description: 'Whether they are an existing customer/member (affects member pricing)',
      required: false,
    },
  ],
  states: ['gather', 'answer', 'complete'],
  transitions: {
    gather: ['answer'],
    answer: ['complete', 'gather'],
    complete: [],
  },
  outcomes: ['answered', 'unanswered'],
  guidance: {
    gather:
      'Ask which service they want pricing for (and, if relevant, whether they are an existing customer or ' +
      'member). Report it with update_workflow (slots), then transition_to "answer".',
    answer:
      'Call knowledge_search with the service name. Quote ONLY prices it returns, as starting points ' +
      '("it typically starts around $___"). Mention member pricing or package deals ONLY when the results ' +
      'include them. If no price is configured, say exact pricing is confirmed by the team and offer a ' +
      'callback. Then complete with outcome "answered" or "unanswered".',
    complete: 'Offer to book or ask if there is anything else you can help with.',
  },
};
