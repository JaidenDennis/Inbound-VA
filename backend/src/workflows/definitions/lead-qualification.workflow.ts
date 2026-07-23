import type { WorkflowDefinition } from '../../types/index.js';

// lead_qualification — leads capability. Capture and qualify: the qualify_lead
// action persists the contact, pushes the lead into the CRM pipeline
// (opportunity in the configured stage), and alerts staff.

export const leadQualificationWorkflow: WorkflowDefinition = {
  id: 'lead_qualification',
  capability: 'leads',
  intents: ['lead_qualification', 'new_lead', 'interested_in_service', 'service_inquiry'],
  scopes: ['crm', 'knowledge', 'booking', 'support'],
  slots: [
    { name: 'name', description: "Caller's full name (spelled back and confirmed)", required: true },
    {
      name: 'phone',
      description: "Caller's phone number (read back digit by digit)",
      required: true,
      validate: (value) =>
        String(value ?? '').replace(/\D/g, '').length >= 7 ? null : 'That phone number looks incomplete — confirm it digit by digit.',
    },
    { name: 'service_interest', description: 'Which service they are interested in', required: true },
    { name: 'email', description: "Caller's email, if offered", required: false },
    { name: 'budget', description: 'Budget range, if they share one', required: false },
    { name: 'timeline', description: 'When they want to start ("this month", "just researching")', required: false },
    { name: 'referral_source', description: 'How they heard about the business', required: false },
  ],
  states: ['gather', 'capture', 'offer_next_step', 'complete'],
  transitions: {
    gather: ['capture'],
    capture: ['offer_next_step'],
    offer_next_step: ['complete'],
    complete: [],
  },
  action: { state: 'capture', name: 'crm.createLead', outcomeOnSuccess: 'qualified', outcomeOnFailure: 'qualified' },
  outcomes: ['qualified', 'qualified_and_booking', 'not_qualified'],
  guidance: {
    gather:
      'Conversationally collect their name, phone (readback rules), and the service they want; weave in any ' +
      'configured qualification questions (budget, timeline, referral source) naturally — never as an ' +
      'interrogation. Report with update_workflow (slots), then transition_to "capture" — the backend records ' +
      'the lead automatically.',
    capture:
      'The lead is being recorded by the backend (CRM pipeline + staff alert). Speak the confirmation it ' +
      'returns, then transition_to "offer_next_step".',
    offer_next_step:
      'Offer the natural next step ONCE — usually booking a consultation (route_intent "book_appointment" if ' +
      'they accept; complete this workflow with outcome "qualified_and_booking" first). If they decline, ' +
      'complete with outcome "qualified" and reassure them the team is available anytime.',
    complete: 'Thank them warmly and ask if there is anything else.',
  },
};
