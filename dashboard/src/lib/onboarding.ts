// Client-side mirror of the backend onboarding stage definitions.
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

export interface Milestone {
  id: string;
  client_id: string;
  stage_key: OnboardingStageKey;
  status: OnboardingStatus;
  completed_at: string | null;
  sort_order: number;
}

export const STAGE_LABEL: Record<OnboardingStageKey, string> = {
  account_setup: 'Account Setup',
  business_discovery: 'Business Discovery',
  system_configuration: 'System Configuration',
  crm_integrations: 'CRM Integrations',
  demo_review: 'Demo Review',
  testing_qa: 'Testing & QA',
  go_live: 'Go Live',
  post_launch_optimization: 'Post Launch Optimization',
};

export const ONBOARDING_STATUSES: OnboardingStatus[] = ['not_started', 'in_progress', 'complete'];

export function stageLabel(key: string): string {
  return STAGE_LABEL[key as OnboardingStageKey] ?? key;
}

/** Index of the current stage = first one that isn't complete (−1 if all done). */
export function currentStageIndex(milestones: Milestone[]): number {
  return milestones.findIndex((m) => m.status !== 'complete');
}
