import { supabase } from '../db/index.js';
import { logger } from '../utils/index.js';
import { ONBOARDING_STAGES } from '../types/index.js';
import type { OnboardingMilestone, OnboardingStageKey, OnboardingStatus } from '../types/index.js';

export class OnboardingService {
  /**
   * Seed all 8 milestones (status 'not_started') for a client. Idempotent via
   * the (client_id, stage_key) unique constraint — safe to call on every client
   * create even if a backfill already ran. Logged-but-not-fatal so a seeding
   * hiccup never blocks client creation.
   */
  async seedForClient(clientId: string): Promise<void> {
    const rows = ONBOARDING_STAGES.map((s) => ({
      client_id: clientId,
      stage_key: s.key,
      status: 'not_started',
      sort_order: s.sort_order,
    }));
    const { error } = await supabase
      .from('onboarding_milestones')
      .upsert(rows, { onConflict: 'client_id,stage_key', ignoreDuplicates: true });
    if (error) logger.error({ err: error, clientId }, 'Failed to seed onboarding milestones');
  }

  async listForClient(clientId: string): Promise<OnboardingMilestone[]> {
    const { data } = await supabase
      .from('onboarding_milestones')
      .select('*')
      .eq('client_id', clientId)
      .order('sort_order', { ascending: true });
    return (data ?? []) as OnboardingMilestone[];
  }

  /** Set a stage's status; stamps completed_at on 'complete', clears it otherwise. */
  async updateStage(
    clientId: string,
    stageKey: OnboardingStageKey,
    status: OnboardingStatus
  ): Promise<OnboardingMilestone> {
    const completed_at = status === 'complete' ? new Date().toISOString() : null;
    const { data, error } = await supabase
      .from('onboarding_milestones')
      .update({ status, completed_at })
      .eq('client_id', clientId)
      .eq('stage_key', stageKey)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as OnboardingMilestone;
  }
}

export const onboardingService = new OnboardingService();
