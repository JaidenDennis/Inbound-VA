import type { ActionMetadata } from '../../types/index.js';

// Every Retell tool (function endpoint) declares metadata here, keyed by its
// tool name. The scope guard enforces `scope` + `requiresVerifiedIdentity` on
// every invocation for routing-enabled calls; `idempotent`/`retrySafe` feed the
// retry policy for actions that run through queues. Adding a tool without a
// metadata entry is a deploy-time error (asserted by getActionMetadata).

export const ACTION_METADATA: Record<string, ActionMetadata> = {
  // ── system (never scope-gated: routing + safety must always be reachable) ──
  route_intent: {
    action: 'route.intent',
    scope: 'system',
    requiresVerifiedIdentity: false,
    idempotent: true,
    retrySafe: true,
  },
  update_workflow: {
    action: 'workflow.update',
    scope: 'system',
    requiresVerifiedIdentity: false,
    idempotent: true,
    retrySafe: true,
  },
  emergency_flag: {
    action: 'emergency.flag',
    scope: 'system',
    requiresVerifiedIdentity: false,
    idempotent: true,
    retrySafe: true,
    workflows: ['emergency'],
  },
  set_language: {
    action: 'language.set',
    scope: 'system',
    requiresVerifiedIdentity: false,
    idempotent: true,
    retrySafe: true,
    workflows: ['language_selection'],
  },
  set_location: {
    action: 'location.set',
    scope: 'system',
    requiresVerifiedIdentity: false,
    idempotent: true,
    retrySafe: true,
    workflows: ['multi_location_routing'],
  },

  // ── booking ───────────────────────────────────────────────────────────────
  check_availability: {
    action: 'calendar.getAvailability',
    scope: 'booking',
    requiresVerifiedIdentity: false,
    idempotent: true,
    retrySafe: true,
    workflows: ['book_appointment'],
  },
  book_appointment: {
    action: 'booking.create',
    scope: 'booking',
    requiresVerifiedIdentity: false,
    idempotent: false,
    retrySafe: false,
    workflows: ['book_appointment'],
  },
  book_consultation: {
    action: 'booking.create',
    scope: 'booking',
    requiresVerifiedIdentity: false,
    idempotent: false,
    retrySafe: false,
    workflows: ['book_appointment'],
  },
  find_appointment: {
    action: 'booking.find',
    scope: 'booking',
    requiresVerifiedIdentity: false,
    idempotent: true,
    retrySafe: true,
    workflows: ['reschedule_appointment', 'cancel_appointment', 'existing_appointment_inquiry'],
  },
  reschedule_appointment: {
    action: 'booking.update',
    scope: 'booking',
    requiresVerifiedIdentity: false,
    idempotent: false,
    retrySafe: false,
    workflows: ['reschedule_appointment'],
  },
  cancel_appointment: {
    action: 'booking.cancel',
    scope: 'booking',
    requiresVerifiedIdentity: false,
    idempotent: true,
    retrySafe: true,
    workflows: ['cancel_appointment'],
  },
  waitlist_add: {
    action: 'waitlist.add',
    scope: 'booking',
    requiresVerifiedIdentity: false,
    idempotent: false,
    retrySafe: true,
    workflows: ['waitlist'],
  },

  // ── knowledge ─────────────────────────────────────────────────────────────
  knowledge_search: {
    action: 'knowledge.search',
    scope: 'knowledge',
    requiresVerifiedIdentity: false,
    idempotent: true,
    retrySafe: true,
    workflows: ['faq', 'pricing', 'promotions', 'general_information'],
  },

  // ── crm ───────────────────────────────────────────────────────────────────
  lookup_existing_client: {
    action: 'contact.lookup',
    scope: 'crm',
    requiresVerifiedIdentity: false,
    idempotent: true,
    retrySafe: true,
  },
  qualify_lead: {
    action: 'crm.createLead',
    scope: 'crm',
    requiresVerifiedIdentity: false,
    idempotent: true,
    retrySafe: true,
    workflows: ['lead_qualification'],
  },
  forms_send: {
    action: 'forms.send',
    scope: 'crm',
    requiresVerifiedIdentity: false,
    idempotent: true,
    retrySafe: true,
    workflows: ['new_client_intake', 'intake_forms'],
  },

  // ── account (identity-gated where account data is exposed) ────────────────
  verify_identity: {
    action: 'identity.verify',
    scope: 'crm',
    requiresVerifiedIdentity: false, // this is what GRANTS verification
    idempotent: true,
    retrySafe: true,
    workflows: ['identity_verification'],
  },
  membership_lookup: {
    action: 'membership.lookup',
    scope: 'crm',
    requiresVerifiedIdentity: true,
    idempotent: true,
    retrySafe: true,
    workflows: ['membership'],
  },
  payment_lookup: {
    action: 'payment.lookup',
    scope: 'payments',
    requiresVerifiedIdentity: true,
    idempotent: true,
    retrySafe: true,
    workflows: ['payment_questions'],
  },
  documentation_request: {
    action: 'documentation.request',
    scope: 'crm',
    requiresVerifiedIdentity: true,
    idempotent: false,
    retrySafe: true,
    workflows: ['documentation_requests'],
  },

  // ── support ───────────────────────────────────────────────────────────────
  schedule_callback: {
    action: 'callback.create',
    scope: 'support',
    requiresVerifiedIdentity: false,
    idempotent: false,
    retrySafe: true,
    workflows: ['callback_request'],
  },
  leave_staff_message: {
    action: 'staff.notify',
    scope: 'support',
    requiresVerifiedIdentity: false,
    idempotent: false,
    retrySafe: true,
  },
  request_human_handoff: {
    action: 'staff.transfer',
    scope: 'support',
    requiresVerifiedIdentity: false,
    idempotent: true,
    retrySafe: true,
    workflows: ['staff_transfer'],
  },
  create_complaint: {
    action: 'ticket.create',
    scope: 'support',
    requiresVerifiedIdentity: false,
    idempotent: false,
    retrySafe: true,
    workflows: ['complaint'],
  },
};

export function getActionMetadata(toolName: string): ActionMetadata {
  const meta = ACTION_METADATA[toolName];
  if (!meta) throw new Error(`No action metadata declared for tool "${toolName}"`);
  return meta;
}
