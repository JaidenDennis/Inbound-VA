import { supabase } from '../db/index.js';
import { logger } from '../utils/index.js';
import { agentProvisioningQueue } from '../queues/index.js';

/**
 * Owns the "database changed, the live agent has not" problem.
 *
 * Any write that affects what the agent says — knowledge rows, identity, voice,
 * booking rules — calls requestSync(). The client is marked pending immediately
 * so the dashboard can say so, and one job is scheduled per burst of edits.
 */

/** Window a burst of edits collapses into a single provision. */
export const SYNC_DEBOUNCE_MS = 60_000;

export type AgentSyncState = 'never' | 'pending' | 'synced' | 'failed';

/**
 * BullMQ rejects a custom job id containing ':' unless it has exactly two of
 * them (a legacy carve-out for repeatable jobs — see Job.validateOptions). The
 * original `agent-sync:${clientId}` had one, so EVERY call threw
 * "Custom Id cannot contain :" before the job was ever queued.
 *
 * That single character took down three separate user-visible features, because
 * everything that changes what the agent says routes through requestSync():
 * the Publish Now button, every knowledge-base save (FAQs, services, pricing,
 * promotions, policies) and the business-hours save. All of them 500'd.
 *
 * Separator is now '-'. Client ids are UUIDs, which contain no colons, so the
 * result is colon-free by construction.
 */
function jobIdFor(clientId: string): string {
  return `agent-sync-${clientId}`;
}

export class AgentSyncService {
  /**
   * Mark the client out of date and schedule a re-provision.
   *
   * `immediate` skips the delay for an explicit "sync now" from the dashboard —
   * a person waiting for a result should not sit through the coalescing window.
   */
  async requestSync(clientId: string, opts: { userId?: string; immediate?: boolean } = {}): Promise<void> {
    await supabase
      .from('clients')
      .update({
        agent_sync_state: 'pending',
        agent_sync_requested_at: new Date().toISOString(),
        agent_sync_error: null,
      })
      .eq('id', clientId);

    const jobId = jobIdFor(clientId);

    if (opts.immediate) {
      // A delayed job from an earlier edit would otherwise run again right after
      // this one and re-provision for nothing.
      const pending = await agentProvisioningQueue.getJob(jobId);
      if (pending) await pending.remove().catch(() => undefined);
      await agentProvisioningQueue.add(
        'provision',
        { clientId, userId: opts.userId },
        { jobId: `${jobId}-now-${Date.now()}` }
      );
      return;
    }

    // Same jobId + delay = the burst collapses. BullMQ ignores an add for a
    // jobId that already exists, so edits 2..n within the window are free.
    //
    // That id outlives the run that used it: the queue retains completed jobs
    // (removeOnComplete: { count: 200 }) and keeps failed ones forever
    // (removeOnFail: false). So the dedup key that should last 60 seconds
    // lasted until the retention window rotated it out — the first successful
    // sync permanently blocked every later one for that client, and a failed
    // one blocked even the retry that would have fixed it. Bare Beauty last
    // reached Retell on 14 Aug and reported 'pending' for five days without a
    // single error, because requestSync returned cleanly having queued nothing.
    //
    // Clearing the corpse first is what frees the id. A job still delayed,
    // waiting or active is left alone — that one is the coalescing working.
    const stale = await agentProvisioningQueue.getJob(jobId);
    if (stale) {
      const state = await stale.getState();
      if (state === 'completed' || state === 'failed') {
        await stale.remove().catch(() => undefined);
      }
    }

    await agentProvisioningQueue.add(
      'provision',
      { clientId, userId: opts.userId },
      { jobId, delay: SYNC_DEBOUNCE_MS }
    );

    logger.info({ clientId, immediate: !!opts.immediate }, 'Agent re-provision requested');
  }

  async markSynced(clientId: string): Promise<void> {
    await supabase
      .from('clients')
      .update({
        agent_sync_state: 'synced',
        agent_synced_at: new Date().toISOString(),
        agent_sync_error: null,
      })
      .eq('id', clientId);
  }

  async markFailed(clientId: string, message: string): Promise<void> {
    await supabase
      .from('clients')
      .update({ agent_sync_state: 'failed', agent_sync_error: message.slice(0, 1000) })
      .eq('id', clientId);
  }

  /** Snapshot a successful provision so it can be diffed and restored. */
  async recordVersion(input: {
    clientId: string;
    settingsSnapshot: Record<string, unknown>;
    renderedPrompt: string | null;
    retellAgentId: string | null;
    retellAgentVersion: number | null;
    vertical: string | null;
    createdBy?: string | null;
  }): Promise<number | null> {
    const { data: latest } = await supabase
      .from('agent_config_versions')
      .select('version')
      .eq('client_id', input.clientId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();

    const version = ((latest as { version: number } | null)?.version ?? 0) + 1;

    const { error } = await supabase.from('agent_config_versions').insert({
      client_id: input.clientId,
      version,
      settings_snapshot: input.settingsSnapshot,
      rendered_prompt: input.renderedPrompt,
      retell_agent_id: input.retellAgentId,
      retell_agent_version: input.retellAgentVersion,
      vertical: input.vertical,
      created_by: input.createdBy ?? null,
    });

    if (error) {
      // Losing a version row must not fail the provision that already succeeded
      // on Retell's side — the agent is live either way.
      logger.error({ err: error, clientId: input.clientId }, 'Failed to record agent config version');
      return null;
    }
    return version;
  }

  async listVersions(clientId: string, limit = 25) {
    const { data } = await supabase
      .from('agent_config_versions')
      .select('id, version, vertical, retell_agent_version, created_by, created_at')
      .eq('client_id', clientId)
      .order('version', { ascending: false })
      .limit(limit);
    return data ?? [];
  }

  async getVersion(clientId: string, version: number) {
    const { data } = await supabase
      .from('agent_config_versions')
      .select('*')
      .eq('client_id', clientId)
      .eq('version', version)
      .maybeSingle();
    return data;
  }
}

export const agentSyncService = new AgentSyncService();
