import type { WorkflowDefinition } from '../../types/index.js';
import { requireVerifiedIdentity } from './_guards.js';

// payment_questions — account capability. Financing, deposits, outstanding
// balances. Identity-gated. payment_lookup explains options from policy and
// routes account-specific balances to staff (no billing backend).

export const paymentQuestionsWorkflow: WorkflowDefinition = {
  id: 'payment_questions',
  capability: 'account',
  intents: ['payment_questions', 'billing', 'financing', 'deposit', 'balance'],
  scopes: ['payments', 'crm', 'support'],
  slots: [
    {
      name: 'phone',
      description: "Caller's phone number (read back digit by digit)",
      required: true,
      validate: (value) =>
        String(value ?? '').replace(/\D/g, '').length >= 7 ? null : 'That phone number looks incomplete — confirm it digit by digit.',
    },
    { name: 'topic', description: 'What they are asking about (financing, deposit, balance, refund)', required: false },
  ],
  states: ['verify_identity', 'answer', 'complete'],
  transitions: {
    verify_identity: ['answer'],
    answer: ['complete'],
    complete: [],
  },
  guards: [requireVerifiedIdentity('answer')],
  outcomes: ['answered', 'escalated', 'not_verified'],
  guidance: {
    verify_identity: 'Verify the caller (verify_identity) before any billing discussion. Then transition_to "answer".',
    answer:
      'Call payment_lookup. Explain financing/deposit options from the policy results. For a specific balance ' +
      'or refund, the tool logs it for the billing team — never state a balance figure. Then transition_to ' +
      '"complete" with outcome "answered" (or "escalated").',
    complete: 'Ask if there is anything else you can help with.',
  },
};
