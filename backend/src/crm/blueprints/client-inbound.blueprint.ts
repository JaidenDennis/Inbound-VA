import type { GhlBlueprint } from '../../types/index.js';

/**
 * Default blueprint for client sub-accounts: the inbound AI call pipeline and
 * the fields/tags the voice agent writes to. No demo leads — clients opt in
 * per client via a custom blueprint in client_settings.ghl_blueprint.
 */
export const clientInboundBlueprint = {
  name: 'client-inbound',
  pipeline: {
    name: 'Inbound AI Calls',
    stages: [
      'New Inquiry',
      'AI Qualified',
      'Booking Requested',
      'Appointment Scheduled',
      'Completed',
      'Won',
      'Lost',
    ],
  },
  customFields: [
    { name: 'Service Interest', dataType: 'TEXT' },
    { name: 'Preferred Time', dataType: 'TEXT' },
    { name: 'AI Qualification Notes', dataType: 'LARGE_TEXT' },
    { name: 'Last Call Date', dataType: 'DATE' },
    { name: 'Retell Call ID', dataType: 'TEXT' },
  ],
  tags: ['ai-answered', 'booked', 'human-handoff', 'no-answer', 'follow-up'],
} satisfies GhlBlueprint;
