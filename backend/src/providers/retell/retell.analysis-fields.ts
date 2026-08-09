/**
 * Post-call analysis fields configured on every Retell agent (migration 023).
 *
 * These are what turn `call_records` from five booleans into demand
 * intelligence. Retell extracts them at the end of each call and returns them in
 * `call_analysis.custom_analysis_data`, from which callRecord.service promotes
 * them into columns.
 *
 * WHY HERE AND NOT PER CLIENT
 * The CLAUDE.md rule is that no client-specific logic lives in source. These
 * fields are deliberately generic — "why did they call", "where did they hear
 * about you" — and mean the same thing for a dentist and a law firm. A field
 * that only made sense for one vertical would belong in that vertical's
 * template, not here.
 *
 * WHY THE THREE LEGACY BOOLEANS ARE INCLUDED
 * `appointment_booked`, `lead_recaptured` and `missed_call_recovered` predate
 * this file and were configured by hand in the Retell dashboard per agent. That
 * is why some agents report them and some do not. Declaring them here makes the
 * set uniform on the next provision, and callRecord.service already tolerates
 * their absence.
 *
 * COST NOTE: each field is an extraction Retell performs per call. They are
 * short and cheap, but they are not free, and the list should stay small enough
 * to justify every entry.
 */

export interface RetellAnalysisField {
  type: 'string' | 'boolean' | 'number';
  name: string;
  description: string;
  /** Constrains the model to a fixed set. Only meaningful for `string`. */
  choices?: string[];
}

export const RETELL_ANALYSIS_FIELDS: RetellAnalysisField[] = [
  // ---- Predates 023; declared here so every agent reports the same set. ----
  {
    type: 'boolean',
    name: 'appointment_booked',
    description:
      'True only if an appointment was actually confirmed with a specific date and time during this call. False if the caller merely asked about availability or said they would call back.',
  },
  {
    type: 'boolean',
    name: 'lead_recaptured',
    description:
      'True if the caller provided contact details (name plus phone or email) for follow-up and was not already a known, identified existing customer.',
  },
  {
    type: 'boolean',
    name: 'missed_call_recovered',
    description:
      'True if this call was a return of, or follow-up to, an earlier missed call or voicemail from the same caller.',
  },

  // ---- Demand intelligence (migration 023). ----
  {
    type: 'string',
    name: 'call_reason',
    description:
      'The single primary reason the caller rang, as a short noun phrase in lower case — for example "book appointment", "ask about pricing", "reschedule", "opening hours", "complaint", "insurance question". Use the caller\'s actual purpose, not the outcome. If genuinely unclear, return an empty string.',
  },
  {
    type: 'string',
    name: 'referral_source',
    description:
      'How the caller said they heard about the business, if they said at all — for example "google", "instagram", "friend referral", "drove past", "existing customer". Return an empty string if they did not say. Never guess or infer from context.',
  },
  {
    type: 'string',
    name: 'requested_service',
    description:
      'The specific service or treatment the caller asked for, in their own words, lower case. Empty string if they did not name one.',
  },
  {
    type: 'boolean',
    name: 'service_available',
    description:
      'Whether the business could actually provide and book the requested service. False when the caller asked for something not offered, or offered but not bookable by phone. Leave unset (do not guess) if no specific service was requested.',
  },
  {
    type: 'string',
    name: 'escalation_reason',
    description:
      'If the call was transferred to a human or the caller asked for one, the reason in a few words — for example "caller insisted", "complex billing", "complaint", "agent could not answer", "existing appointment change". Empty string if there was no escalation.',
  },
];

/**
 * The field list in the shape Retell's agent API expects.
 *
 * Kept as a function rather than a constant so a caller cannot mutate the shared
 * array and quietly change every subsequent provision.
 */
export function buildPostCallAnalysisSchema(): RetellAnalysisField[] {
  return RETELL_ANALYSIS_FIELDS.map((f) => ({ ...f }));
}
