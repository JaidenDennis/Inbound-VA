import { supabase } from '../db/index.js';
import { env } from '../config/index.js';
import { logger } from '../utils/index.js';
import { clientService } from './client.service.js';
import { knowledgeService } from './knowledge.service.js';
import { writeAuditLog } from './audit.service.js';
import {
  createOrUpdateResponseEngine,
  createOrUpdateAgent,
  setInboundAgent,
  purchaseNumber,
} from '../providers/retell/retell.agent.js';
import { getTemplate, resolveVertical } from '../providers/retell/templates/index.js';

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

export class ProvisioningService {
  /**
   * Idempotently create OR update a client's Retell agent from its settings.
   * Re-running updates the existing agent + response engine in place.
   */
  async provisionClient(clientId: string, opts: ProvisionOptions = {}): Promise<ProvisionResult> {
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

    const functionBaseUrl = `${baseUrl()}/functions/retell`;
    const webhookUrl = `${baseUrl()}/webhooks/retell`;

    const { responseEngine, agent } = template.build({
      client,
      settings,
      functionBaseUrl,
      defaultVoiceId: env.RETELL_DEFAULT_VOICE_ID,
    });

    // 1. Response Engine (Retell LLM) — update in place if one exists.
    const llmId = await createOrUpdateResponseEngine(responseEngine, client.retell_llm_id);

    // 2. Agent — update in place if one exists.
    const { agentId, version } = await createOrUpdateAgent({
      spec: agent,
      llmId,
      webhookUrl,
      existingAgentId: client.retell_agent_id,
    });

    // 3. Persist provisioning result on the client record.
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

    // 4. Phone numbers — map existing, optionally buy a new one.
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
