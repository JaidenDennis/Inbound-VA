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

  /**
   * Every client's onboarding progress in one pass — the staff rollup.
   *
   * Staff have no single client to scope to, so asking them for a clientId
   * (which is what the route used to do) left the page with nothing to draw.
   * Clients with no milestone rows still appear, at zero, so a client that was
   * created before seeding existed is visible rather than silently missing.
   */
  async listAllForPlatform(): Promise<
    Array<{
      client_id: string;
      client_name: string;
      status: string;
      total: number;
      complete: number;
      current_stage: OnboardingStageKey | null;
    }>
  > {
    const [{ data: clients }, { data: milestones }] = await Promise.all([
      supabase.from('clients').select('id, name, status').order('name'),
      supabase.from('onboarding_milestones').select('client_id, stage_key, status, sort_order'),
    ]);

    const byClient = new Map<string, OnboardingMilestone[]>();
    for (const m of (milestones ?? []) as OnboardingMilestone[]) {
      const list = byClient.get(m.client_id) ?? [];
      list.push(m);
      byClient.set(m.client_id, list);
    }

    return (clients ?? []).map((c: { id: string; name: string; status: string }) => {
      const rows = (byClient.get(c.id) ?? []).sort((a, b) => a.sort_order - b.sort_order);
      const complete = rows.filter((r) => r.status === 'complete').length;
      // The current stage is the first one not finished; a fully complete
      // client has none, which the UI renders as "live" rather than a stage.
      const current = rows.find((r) => r.status !== 'complete') ?? null;
      return {
        client_id: c.id,
        client_name: c.name,
        status: c.status,
        total: rows.length || ONBOARDING_STAGES.length,
        complete,
        current_stage: current?.stage_key ?? null,
      };
    });
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
