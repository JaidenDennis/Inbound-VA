import { retell } from './retell.client.js';
import type { ResponseEngineSpec, AgentSpec } from './templates/template.types.js';

type RetellCustomTool = {
  type: 'custom';
  name: string;
  url: string;
  description?: string;
  speak_during_execution?: boolean;
  parameters?: ResponseEngineSpec['general_tools'][number]['parameters'];
};

function toCustomTools(tools: ResponseEngineSpec['general_tools']): RetellCustomTool[] {
  return tools.map((t) => ({
    type: 'custom',
    name: t.name,
    url: t.url,
    description: t.description,
    speak_during_execution: t.speak_during_execution ?? true,
    parameters: t.parameters,
  }));
}

/**
 * Create the Retell LLM (Response Engine) or UPDATE it in place when the client
 * already has one. Returns the llm_id.
 */
export async function createOrUpdateResponseEngine(
  spec: ResponseEngineSpec,
  existingLlmId?: string | null
): Promise<string> {
  const body = {
    model: (spec.model ?? 'gpt-4.1') as 'gpt-4.1',
    general_prompt: spec.general_prompt,
    begin_message: spec.begin_message,
    general_tools: toCustomTools(spec.general_tools),
  };
  if (existingLlmId) {
    const res = await retell.llm.update(existingLlmId, body);
    return res.llm_id;
  }
  const res = await retell.llm.create(body);
  return res.llm_id;
}

/**
 * Create or UPDATE the Retell Agent bound to the given Response Engine.
 * webhookUrl is the single URL Retell posts all call events to.
 */
export async function createOrUpdateAgent(input: {
  spec: AgentSpec;
  llmId: string;
  webhookUrl: string;
  existingAgentId?: string | null;
}): Promise<{ agentId: string; version: number }> {
  const body = {
    response_engine: { type: 'retell-llm' as const, llm_id: input.llmId },
    voice_id: input.spec.voice_id,
    agent_name: input.spec.agent_name,
    language: input.spec.language,
    webhook_url: input.webhookUrl,
    webhook_events: ['call_started', 'call_ended', 'call_analyzed'] as Array<
      'call_started' | 'call_ended' | 'call_analyzed'
    >,
    // Pacing / experience + end-call timing (undefined fields are omitted).
    responsiveness: input.spec.responsiveness,
    interruption_sensitivity: input.spec.interruption_sensitivity,
    enable_backchannel: input.spec.enable_backchannel,
    begin_message_delay_ms: input.spec.begin_message_delay_ms,
    end_call_after_silence_ms: input.spec.end_call_after_silence_ms,
    reminder_trigger_ms: input.spec.reminder_trigger_ms,
    reminder_max_count: input.spec.reminder_max_count,
  };
  if (input.existingAgentId) {
    const res = await retell.agent.update(input.existingAgentId, body);
    return { agentId: res.agent_id, version: res.version };
  }
  const res = await retell.agent.create(body);
  return { agentId: res.agent_id, version: res.version };
}

/** Point an existing Retell phone number at an agent (no purchase). */
export async function setInboundAgent(phoneNumber: string, agentId: string): Promise<void> {
  await retell.phoneNumber.update(phoneNumber, {
    inbound_agents: [{ agent_id: agentId, weight: 1 }],
  });
}

/** Buy a new number via Retell and bind it to the agent. Returns the number (E.164). */
export async function purchaseNumber(input: {
  areaCode: number;
  agentId: string;
}): Promise<string> {
  const res = await retell.phoneNumber.create({
    area_code: input.areaCode,
    inbound_agents: [{ agent_id: input.agentId, weight: 1 }],
  });
  return res.phone_number;
}
