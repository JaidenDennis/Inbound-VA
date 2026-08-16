import { supabase } from '../db/index.js';
import { env } from '../config/index.js';
import { logger } from '../utils/index.js';
import { clientService } from './client.service.js';
import { knowledgeService } from './knowledge.service.js';
import { writeAuditLog } from './audit.service.js';
import { agentSyncService } from './agentSync.service.js';
import {
  provisionRetellAgent,
  setInboundAgent,
  purchaseNumber,
} from '../providers/retell/retell.agent.js';
import { getTemplate, resolveVertical } from '../providers/retell/templates/index.js';
import type { AgentSpec, ResponseEngineSpec } from '../providers/retell/templates/index.js';
import type { Client, ClientSettings } from '../types/index.js';

function baseUrl(): string {
  // Prefer an explicit webhook base; fall back to API_BASE_URL.
  return env.WEBHOOK_BASE_URL ?? env.API_BASE_URL;
}

export interface ProvisionOptions {
  /** Override the vertical/template (defaults to one derived from client.industry). */
  template?: string;
  /** Phone numbers to map to the agent (defaults to client.phone_numbers). */
  phoneNumbers?: string[];
  /** If set, buy a new number in this area code and bind it to the agent. */
  buyAreaCode?: number;
  /** Audit attribution. */
  userId?: string;
}

export interface ProvisionResult {
  clientId: string;
  agentId: string;
  llmId: string;
  version: number;
  vertical: string;
  webhookUrl: string;
  mappedNumbers: string[];
}

/** Practical ceiling for a rendered prompt before quality degrades badly. */
const MAX_PROMPT_CHARS = 120_000;

export interface RenderedAgent {
  client: Client;
  settings: ClientSettings;
  vertical: string;
  responseEngine: ResponseEngineSpec;
  agent: AgentSpec;
  webhookUrl: string;
}

export class ProvisioningService {
  /**
   * Build exactly what would be sent to Retell, without sending it.
   *
   * One code path serves three callers — the prompt preview, the pre-flight
   * validation gate, and the version snapshot — so what staff read in the
   * dashboard is byte-for-byte what the agent runs with.
   */
  async renderClient(clientId: string, opts: { template?: string } = {}): Promise<RenderedAgent> {
    const client = await clientService.findById(clientId);
    if (!client) throw new Error(`Client not found: ${clientId}`);
    const baseSettings = await clientService.getSettings(clientId);
    if (!baseSettings) throw new Error(`Client settings not found for client: ${clientId}`);
    // Relational knowledge (services/pricing/faqs tables) overlays the legacy
    // JSONB columns, so agent prompts render from the live knowledge base.
    const settings = await knowledgeService.settingsWithKnowledge(clientId, baseSettings);

    const vertical = opts.template ?? resolveVertical(client.industry);
    const template = getTemplate(vertical);
    if (!template) throw new Error(`No agent template registered for vertical: ${vertical}`);

    const built = template.build({
      client,
      settings,
      functionBaseUrl: `${baseUrl()}/functions/retell`,
      defaultVoiceId: env.RETELL_DEFAULT_VOICE_ID,
    });

    return {
      client,
      settings,
      vertical,
      responseEngine: built.responseEngine,
      agent: built.agent,
      webhookUrl: `${baseUrl()}/webhooks/retell`,
    };
  }

  /**
   * Pre-flight check run before a sync is queued. Catching this here means bad
   * configuration fails visibly in the dashboard instead of silently degrading
   * every call until someone notices.
   */
  async validateClient(clientId: string, opts: { template?: string } = {}): Promise<string[]> {
    const problems: string[] = [];
    let rendered: RenderedAgent;

    try {
      rendered = await this.renderClient(clientId, opts);
    } catch (err) {
      return [(err as Error).message];
    }

    const settings = rendered.settings as unknown as Record<string, unknown>;
    if (!settings.business_name) problems.push('Business name is not set');
    if (!settings.agent_name) problems.push('Agent name is not set');

    const prompt = rendered.responseEngine.general_prompt ?? '';
    if (!prompt.trim()) problems.push('The rendered prompt is empty');
    if (prompt.length > MAX_PROMPT_CHARS) {
      problems.push(`The rendered prompt is ${prompt.length} characters, over the ${MAX_PROMPT_CHARS} limit`);
    }
    // A raw {{placeholder}} means the agent would read the variable name aloud.
    const unresolved = prompt.match(/\{\{\s*[\w.]+\s*\}\}/g);
    if (unresolved) {
      problems.push(`Prompt still contains unresolved placeholders: ${[...new Set(unresolved)].join(', ')}`);
    }

    return problems;
  }

  /**
   * Idempotently create OR update a client's Retell agent from its settings.
   * Re-running updates the existing agent + response engine in place.
   */
  async provisionClient(clientId: string, opts: ProvisionOptions = {}): Promise<ProvisionResult> {
    const rendered = await this.renderClient(clientId, { template: opts.template });
    const { client, settings, vertical, responseEngine, agent, webhookUrl } = rendered;

    // 1. Push the configuration and PUBLISH it. Retell's draft/publish model
    //    makes the ordering of the LLM and agent writes load-bearing, so the
    //    whole sequence lives behind one call — see retell.agent.ts.
    const { agentId, llmId, version } = await provisionRetellAgent({
      responseEngine,
      agentSpec: agent,
      webhookUrl,
      existingAgentId: client.retell_agent_id,
      existingLlmId: client.retell_llm_id,
    });

    // 2. Persist provisioning result on the client record.
    const { error: updateErr } = await supabase
      .from('clients')
      .update({
        retell_agent_id: agentId,
        retell_llm_id: llmId,
        retell_voice_id: agent.voice_id,
        retell_agent_version: version,
        retell_last_provisioned_at: new Date().toISOString(),
      })
      .eq('id', clientId);
    if (updateErr) throw new Error(`Failed to persist provisioning: ${updateErr.message}`);

    // 3. Phone numbers — map existing, optionally buy a new one.
    const mappedNumbers: string[] = [];
    const phoneNumbers = opts.phoneNumbers ?? client.phone_numbers ?? [];
    for (const number of phoneNumbers) {
      try {
        await setInboundAgent(number, agentId);
        await this.recordPhoneNumber(clientId, number, agentId, false);
        mappedNumbers.push(number);
      } catch (err) {
        logger.warn({ err, number, clientId }, 'Failed to map phone number to Retell agent');
      }
    }
    if (opts.buyAreaCode) {
      const bought = await purchaseNumber({ areaCode: opts.buyAreaCode, agentId });
      await this.recordPhoneNumber(clientId, bought, agentId, true);
      mappedNumbers.push(bought);
      const merged = Array.from(new Set([...phoneNumbers, bought]));
      await supabase.from('clients').update({ phone_numbers: merged }).eq('id', clientId);
    }

    await writeAuditLog({
      userId: opts.userId,
      clientId,
      action: client.retell_agent_id ? 'retell.agent.updated' : 'retell.agent.created',
      entityType: 'client',
      entityId: clientId,
      newValue: { agentId, llmId, vertical, version },
    });

    // Snapshot what actually shipped. Only on success, so the history is a
    // record of configurations the agent really ran with — not attempts.
    await agentSyncService.recordVersion({
      clientId,
      settingsSnapshot: settings as unknown as Record<string, unknown>,
      renderedPrompt: responseEngine.general_prompt,
      retellAgentId: agentId,
      retellAgentVersion: version,
      vertical,
      createdBy: opts.userId ?? null,
    });
    await agentSyncService.markSynced(clientId);

    logger.info({ clientId, agentId, llmId, vertical, version }, 'Client provisioned with Retell agent');
    return { clientId, agentId, llmId, version, vertical, webhookUrl, mappedNumbers };
  }

  private async recordPhoneNumber(
    clientId: string,
    phone: string,
    agentId: string,
    purchased: boolean
  ): Promise<void> {
    await supabase.from('retell_phone_numbers').upsert(
      {
        client_id: clientId,
        phone_number: phone,
        retell_agent_id: agentId,
        provider: purchased ? 'retell' : 'imported',
        purchased,
      },
      { onConflict: 'phone_number' }
    );
  }
}

export const provisioningService = new ProvisioningService();
