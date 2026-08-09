import { roleScope, type UserRole } from '../types/index.js';

/**
 * The line between what a tenant configures and what Gravvia owns.
 *
 * Migration 022 made `agents:write` client-reachable, which was the right call
 * for everything that shapes how an agent *sounds* — names, voice, greeting,
 * what it may offer. It is the wrong call for the prompt body, and grants alone
 * cannot express that difference: a grant is one bit, and this boundary is about
 * which fields the bit applies to.
 *
 * So the boundary lives here, in the service layer, and is checked on the write
 * path rather than in middleware. A client-scope actor is refused these fields
 * even holding every grant in the vocabulary, including `agents:write`. Staff
 * keep them via the platform-only `/clients/:id/agent` route.
 *
 * WHY THE PROMPT SPECIFICALLY
 * Free-text prompt content is the one edit that can make an agent say something
 * the business would never stand behind, on every call, silently — no error, no
 * failed sync, nothing in the console to notice. Every other field in this
 * editor either works or visibly does not.
 *
 * The UI must carry the reason, not just the restriction (spec §6.3): a stated
 * boundary reads as a quality guarantee, an unexplained missing field reads as a
 * product that cannot do it. `describeBoundary()` exists so the explanation and
 * the enforcement come from the same source and cannot drift apart.
 */

/**
 * Fields a client-scope actor may never write.
 *
 * Each is here because writing it changes what the agent SAYS rather than what
 * it knows or offers:
 *
 *  - `agent_prompt`      the prompt body itself
 *  - `prompt_overrides`  per-slot appended prompt sections (migration 018)
 *  - `template`/`vertical` which prompt template renders at all
 */
export const GRAVVIA_MANAGED_FIELDS = [
  'agent_prompt',
  'prompt_overrides',
  'template',
  'vertical',
] as const;

export type GravviaManagedField = (typeof GRAVVIA_MANAGED_FIELDS)[number];

export class PromptBoundaryError extends Error {
  constructor(
    readonly fields: string[],
    message?: string
  ) {
    super(
      message ??
        `${fields.join(', ')} ${fields.length === 1 ? 'is' : 'are'} managed by Gravvia and cannot be ` +
          'edited from the client dashboard. Prompt wording affects every call and is ' +
          'changed through a support request so it can be reviewed first.'
    );
    this.name = 'PromptBoundaryError';
  }
}

/**
 * Refuse a client-scope write that reaches a Gravvia-managed field.
 *
 * Takes the role rather than a boolean so the decision is made from the same
 * source of truth the rest of the RBAC layer uses, and a caller cannot get it
 * backwards by passing the wrong flag.
 *
 * Platform actors pass through untouched — this is not a global freeze on the
 * prompt, it is a tenancy boundary.
 */
export function assertWithinPromptBoundary(
  role: UserRole,
  patch: Record<string, unknown>
): void {
  if (roleScope(role) === 'platform') return;

  const offending = (GRAVVIA_MANAGED_FIELDS as readonly string[]).filter((field) =>
    Object.prototype.hasOwnProperty.call(patch, field)
  );

  if (offending.length > 0) throw new PromptBoundaryError(offending);
}

/**
 * True when a patch is clean for a client-scope actor. For callers that want to
 * branch rather than catch — the route layer uses the assertion.
 */
export function isWithinPromptBoundary(patch: Record<string, unknown>): boolean {
  return !(GRAVVIA_MANAGED_FIELDS as readonly string[]).some((field) =>
    Object.prototype.hasOwnProperty.call(patch, field)
  );
}

export interface BoundaryDescription {
  clientManaged: Array<{ field: string; label: string; note?: string }>;
  gravviaManaged: Array<{ field: string; label: string; why: string }>;
  requestPath: string;
}

/**
 * What the dashboard shows next to the editor.
 *
 * Served from the API rather than hardcoded in the frontend so the explanation
 * and the enforcement cannot disagree — a field added to
 * `GRAVVIA_MANAGED_FIELDS` without a matching entry here fails
 * `prompt-boundary.test.ts`.
 */
export function describeBoundary(): BoundaryDescription {
  return {
    clientManaged: [
      { field: 'business_name', label: 'Business name' },
      { field: 'agent_name', label: 'Agent name' },
      {
        field: 'opening_message',
        label: 'Greeting',
        note: 'The first thing every caller hears. Yours to write.',
      },
      { field: 'agent_personality', label: 'Personality' },
      { field: 'agent_tone', label: 'Tone' },
      { field: 'agent_response_style', label: 'Response style' },
      { field: 'voice_id', label: 'Voice' },
      {
        field: 'booking_enabled',
        label: 'Booking, transfers, callbacks, waitlist',
        note: 'What the agent is allowed to do on a call.',
      },
      { field: 'booking_rules', label: 'Booking windows, buffers and cancellation policy' },
      { field: 'notification_emails', label: 'Who gets notified' },
      { field: 'escalation_rules', label: 'Escalation routing' },
      { field: 'faqs', label: 'FAQs, services and pricing' },
      {
        field: 'pronunciation_dictionary',
        label: 'Pronunciations',
        note: 'How the agent says unusual names and words.',
      },
    ],
    gravviaManaged: [
      {
        field: 'agent_prompt',
        label: 'Prompt wording',
        why:
          'The prompt decides what the agent says on every call, and a bad edit degrades ' +
          'them all silently — no error, nothing in the console. We review changes here ' +
          'so that cannot happen to you.',
      },
      {
        field: 'prompt_overrides',
        label: 'Custom prompt sections',
        why:
          'Bespoke wording appended to your prompt. We write these with you so they stay ' +
          'consistent with the rest of the agent.',
      },
      {
        field: 'template',
        label: 'Industry template',
        why:
          'Which conversation template your agent runs on. Changing it rebuilds the agent ' +
          'from a different starting point, so it is a migration rather than a setting.',
      },
      {
        field: 'vertical',
        label: 'Vertical',
        why: 'Paired with the template above and changed alongside it.',
      },
    ],
    requestPath:
      'Raise a support ticket to change anything in the Gravvia-managed list. Prompt ' +
      'changes are usually turned around the same day.',
  };
}
