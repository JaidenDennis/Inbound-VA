export type ClientStatus = 'active' | 'inactive' | 'suspended';
export type Industry =
  | 'dental'
  | 'medical'
  | 'legal'
  | 'real_estate'
  | 'fitness'
  | 'beauty'
  | 'auto'
  | 'other';
export type CrmType =
  | 'gohighlevel'
  | 'hubspot'
  | 'salesforce'
  | 'zoho'
  | 'webhook'
  | 'none';

export interface Client {
  id: string;
  name: string;
  slug: string;
  industry: Industry;
  timezone: string;
  phone_numbers: string[];
  status: ClientStatus;
  retell_agent_id: string | null;
  retell_llm_id: string | null;
  retell_voice_id: string | null;
  retell_agent_version: number | null;
  retell_last_provisioned_at: string | null;
  created_at: string;
  updated_at: string;
}

/** One TTS pronunciation override passed through to the Retell agent. */
export interface PronunciationEntry {
  word: string;
  alphabet: 'ipa' | 'cmu';
  phoneme: string;
}

export interface AgentConfig {
  /** A recurring membership/loyalty program, if the client runs one. */
  membership_program?: { name: string; description?: string };
  /** Whether the client sells multi-treatment packages. */
  offers_packages?: boolean;
  /** Whether the client offers a PRP enhancement add-on. */
  offers_prp?: boolean;
  /** Whether consultations are free (affects how they're offered). */
  free_consultation?: boolean;
  /**
   * Per-client TTS pronunciation overrides (business name, unusual service or
   * surname pronunciations) passed straight through to the Retell agent. A
   * TTS-layer safety net that catches digit/name strings regardless of LLM text.
   */
  pronunciation_dictionary?: PronunciationEntry[];
  /**
   * Run this client's inbound agent under the workflow engine: the agent
   * classifies intents via route_intent, and every tool invocation is
   * scope-checked against the active workflow's grant. Off (default) =
   * legacy single-prompt behavior.
   */
  workflow_routing?: boolean;
  /** Link to the client's intake/consent forms (sent to callers by forms_send). */
  intake_form_url?: string;
  /** Client-specific intake questions the agent asks during new_client_intake. */
  intake_questions?: string[];
  [key: string]: unknown;
}

export interface ClientSettings {
  id: string;
  client_id: string;
  /** Public-facing business + agent names rendered into the prompt (no {{vars}}). */
  business_name: string | null;
  agent_name: string | null;
  /** Vertical offerings config that drives upsell decisions (reusable per client). */
  agent_config: AgentConfig;
  agent_prompt: string;
  agent_personality: string;
  agent_tone: string;
  agent_response_style: string;
  faqs: FAQ[];
  services: Service[];
  pricing: PricingItem[];
  business_policies: string[];
  booking_enabled: boolean;
  booking_rules: BookingRules;
  notification_emails: string[];
  escalation_rules: EscalationRule[];
  crm_type: CrmType;
  crm_config: Record<string, unknown>;
  custom_field_mapping: Record<string, string>;
  /** Per-client GHL provisioning blueprint; NULL falls back to a shipped default. */
  ghl_blueprint: import('./ghl-blueprint.types.js').GhlBlueprint | null;
  created_at: string;
  updated_at: string;
}

export interface FAQ {
  question: string;
  answer: string;
  category?: string;
}

export interface Service {
  name: string;
  description: string;
  duration_minutes: number;
  price?: number;
}

export interface PricingItem {
  name: string;
  price: number;
  unit?: string;
  notes?: string;
  /** Member/loyalty price when the client distinguishes member vs non-member. */
  member_price?: number;
  /** Package/upsell reference surfaced with this price ("3-pack saves 15%"). */
  upsell_note?: string;
}

/** An active offer from the relational promotions table (inbound Phase 2). */
export interface Promotion {
  title: string;
  description: string;
  eligibility?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
}

export interface BookingRules {
  advance_booking_hours: number;
  max_advance_booking_days: number;
  buffer_minutes: number;
  working_hours: WorkingHours;
  blackout_dates: string[];
  lead_qualification_required: boolean;
  lead_qualification_fields: string[];
  /** Hours of notice required to cancel without triggering the policy note. */
  cancellation_notice_hours?: number;
  /** Spoken cancellation policy ("Cancellations under 24h incur a $50 fee."). */
  cancellation_policy?: string;
}

export interface WorkingHours {
  monday?: DayHours;
  tuesday?: DayHours;
  wednesday?: DayHours;
  thursday?: DayHours;
  friday?: DayHours;
  saturday?: DayHours;
  sunday?: DayHours;
}

export interface DayHours {
  open: string;
  close: string;
}

export interface EscalationRule {
  trigger: string;
  action: 'email' | 'sms' | 'transfer';
  target: string;
  priority: number;
}
