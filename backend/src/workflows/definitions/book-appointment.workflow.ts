import type { WorkflowDefinition } from '../../types/index.js';

// book_appointment — appointments capability. Availability comes from
// check_availability (CRM-calendar truth when configured); the booking is
// executed by book_appointment / book_consultation, which persist, sync the
// CRM, and fire confirmations via the existing automation chain.

export const bookAppointmentWorkflow: WorkflowDefinition = {
  id: 'book_appointment',
  capability: 'appointments',
  intents: ['book_appointment', 'booking', 'schedule_appointment', 'book_consultation', 'consultation'],
  scopes: ['booking', 'crm', 'support'],
  slots: [
    {
      name: 'service',
      description: 'Which service or treatment to book (or "consultation")',
      required: true,
      validate: (value, ctx) => {
        const services = ctx.settings?.services ?? [];
        if (!services.length) return null;
        const name = String(value ?? '').toLowerCase();
        if (name.includes('consult')) return null;
        return services.some(
          (s) => s.name.toLowerCase().includes(name) || name.includes(s.name.toLowerCase())
        )
          ? null
          : 'That service is not offered — steer to a listed service or a consultation.';
      },
    },
    {
      name: 'preferred_time',
      description: 'Their preferred date/time (ISO 8601 once confirmed)',
      required: true,
      validate: (value, ctx) => {
        const t = new Date(String(value ?? ''));
        if (Number.isNaN(t.getTime())) return 'Provide the preferred time as an ISO 8601 date-time.';
        return t > ctx.now ? null : 'The requested time is in the past — ask for a future date.';
      },
    },
    { name: 'name', description: "Caller's full name (spelled back and confirmed)", required: true },
    {
      name: 'phone',
      description: "Caller's phone number (read back digit by digit and confirmed)",
      required: true,
      validate: (value) =>
        String(value ?? '').replace(/\D/g, '').length >= 7 ? null : 'That phone number looks incomplete — confirm it digit by digit.',
    },
    { name: 'email', description: "Caller's email, if they offer one", required: false },
    { name: 'preferred_provider', description: 'Preferred staff member, if any', required: false },
    { name: 'existing_client', description: 'Whether they have visited before', required: false },
  ],
  states: ['gather', 'check_availability', 'offer_alternatives', 'confirm', 'execute', 'complete'],
  transitions: {
    gather: ['check_availability'],
    check_availability: ['confirm', 'offer_alternatives'],
    offer_alternatives: ['check_availability', 'confirm', 'complete'],
    confirm: ['execute', 'gather'],
    execute: ['complete'],
    complete: [],
  },
  // Entering "execute" makes the BACKEND book the appointment from the collected
  // slots — the agent never calls a separate booking tool.
  action: { state: 'execute', name: 'booking.create', outcomeOnSuccess: 'booked', outcomeOnFailure: 'no_availability', completeOnSuccess: true },
  outcomes: ['booked', 'no_availability', 'abandoned'],
  guidance: {
    gather:
      'Collect the service, preferred date/time, and the caller\'s confirmed name and phone (readback rules ' +
      'apply). Report them with update_workflow (slots), then transition_to "check_availability".',
    check_availability:
      'Call check_availability for the requested date. If their time is open, transition_to "confirm". ' +
      'If not, transition_to "offer_alternatives".',
    offer_alternatives:
      'Offer the nearest open times from check_availability. If they pick one, update the preferred_time slot ' +
      'and transition_to "confirm". If nothing works, offer the waitlist (route_intent "waitlist") or ' +
      'complete with outcome "no_availability".',
    confirm:
      'Read back the service, date, time, name, and phone and get an explicit yes. Then call update_workflow ' +
      'with transition_to "execute" — the backend books it automatically and tells you the result. Do NOT ' +
      'call a separate booking tool.',
    execute:
      'The booking is being finalized by the backend. Speak the confirmation it returns. If it reports the ' +
      'time is unavailable, use check_availability to offer another slot, update the preferred_time, and ' +
      'transition_to "execute" again — never blame "the system".',
    complete: 'Recap the booking and any prep or cancellation policy note, then ask if there is anything else.',
  },
};
