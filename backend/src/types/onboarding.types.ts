export type OnboardingStatus = 'not_started' | 'in_progress' | 'complete';

export type OnboardingStageKey =
  | 'account_setup'
  | 'business_discovery'
  | 'system_configuration'
  | 'crm_integrations'
  | 'demo_review'
  | 'testing_qa'
  | 'go_live'
  | 'post_launch_optimization';

export interface OnboardingMilestone {
  id: string;
  client_id: string;
  stage_key: OnboardingStageKey;
  status: OnboardingStatus;
  completed_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface OnboardingStageDef {
  key: OnboardingStageKey;
  label: string;
  sort_order: number;
}

// Canonical 8-stage pipeline, in order. The single source of truth for seeding
// (matches the CHECK constraint + backfill in migration 008).
export const ONBOARDING_STAGES: OnboardingStageDef[] = [
  { key: 'account_setup', label: 'Account Setup', sort_order: 1 },
  { key: 'business_discovery', label: 'Business Discovery', sort_order: 2 },
  { key: 'system_configuration', label: 'System Configuration', sort_order: 3 },
  { key: 'crm_integrations', label: 'CRM Integrations', sort_order: 4 },
  { key: 'demo_review', label: 'Demo Review', sort_order: 5 },
  { key: 'testing_qa', label: 'Testing & QA', sort_order: 6 },
  { key: 'go_live', label: 'Go Live', sort_order: 7 },
  { key: 'post_launch_optimization', label: 'Post Launch Optimization', sort_order: 8 },
];

export const ONBOARDING_STATUSES: OnboardingStatus[] = ['not_started', 'in_progress', 'complete'];
