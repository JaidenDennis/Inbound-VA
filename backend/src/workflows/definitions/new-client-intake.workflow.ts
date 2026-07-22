import type { WorkflowDefinition } from '../../types/index.js';

// new_client_intake — leads capability. Create the contact/CRM profile,
// capture consent + preferred channel, and send intake forms (email at launch;
// SMS plugs in later). Client-specific intake questions come from
// client_settings.agent_config.intake_questions — never hardcoded.

export const newClientIntakeWorkflow: WorkflowDefinition = {
  id: 'new_client_intake',
  capability: 'leads',
  intents: ['new_client_intake', 'new_patient', 'new_client', 'first_visit'],
  scopes: ['crm', 'knowledge', 'support'],
  slots: [
    { name: 'name', description: "Caller's full name (spelled back and confirmed)", required: true },
    {
      name: 'phone',
      description: "Caller's phone number (read back digit by digit)",
      required: true,
      validate: (value) =>
        String(value ?? '').replace(/\D/g, '').length >= 7 ? null : 'That phone number looks incomplete — confirm it digit by digit.',
    },
    { name: 'email', description: "Caller's email (needed to send forms)", required: false },
    {
      name: 'consent',
      description: 'Explicit yes that they agree to be contacted and receive forms',
      required: true,
      validate: (value) =>
        value === true || String(value ?? '').toLowerCase().startsWith('y')
          ? null
          : 'Consent must be an explicit yes before creating the profile.',
    },
    { name: 'preferred_channel', description: 'How they prefer to be contacted (email/phone)', required: false },
    { name: 'intake_answers', description: 'Answers to the client-configured intake questions, if any', required: false },
  ],
  states: ['gather', 'create_profile', 'send_forms', 'complete'],
  transitions: {
    gather: ['create_profile'],
    create_profile: ['send_forms', 'complete'],
    send_forms: ['complete'],
    complete: [],
  },
  outcomes: ['intake_complete', 'forms_pending', 'declined'],
  guidance: {
    gather:
      'Welcome them as a new client. Collect name, phone (readback rules), and email; ask any intake questions ' +
      'listed in your instructions; then ask for their consent to be contacted and sent forms. Report with ' +
      'update_workflow (slots), then transition_to "create_profile". If they decline consent, complete with ' +
      'outcome "declined" and offer to help another way.',
    create_profile:
      'Call qualify_lead with their details so the profile and CRM record exist. Then transition_to ' +
      '"send_forms" (or straight to "complete" if no forms are needed).',
    send_forms:
      'Call forms_send with their name, phone, and email. If it answers channel "staff", reassure them the ' +
      'team will get the forms to them. Then transition_to "complete" and complete with outcome ' +
      '"intake_complete" (or "forms_pending" when staff will send them).',
    complete: 'Offer to book their first visit (route_intent "book_appointment") and ask if there is anything else.',
  },
};
