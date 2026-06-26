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

// Retell's built-in end-call tool: lets the LLM hang up the line itself once the
// goodbye is done, so calls don't sit in dead air waiting on the silence timer.
type RetellEndCallTool = { type: 'end_call'; name: string; description?: string };
type RetellGeneralTool = RetellCustomTool | RetellEndCallTool;

function buildGeneralTools(tools: ResponseEngineSpec['general_tools']): RetellGeneralTool[] {
  const custom: RetellGeneralTool[] = tools.map((t) => ({
    type: 'custom',
    name: t.name,
    url: t.url,
    description: t.description,
    speak_during_execution: t.speak_during_execution ?? true,
    parameters: t.parameters,
  }));
  custom.push({
    type: 'end_call',
    name: 'end_call',
    description:
      'End the phone call. Call this ONLY after you have given the caller a warm goodbye and confirmed they need nothing else, so the line hangs up instead of sitting silent.',
  });
  return custom;
}

/**
 * Create the Retell LLM (Response Engine) or UPDATE it in place when the client
 * already has one. Returns the llm_id.
 */
export async function createOrUpdateResponseEngine(
  spec: ResponseEngineSpec,
  existingLlmId?: string | null
): Promise<string> {
  // Prompt + greeting + tools are what provisioning refreshes on every run.
  const common = {
    general_prompt: spec.general_prompt,
    begin_message: spec.begin_message,
    general_tools: buildGeneralTools(spec.general_tools),
  };
  if (existingLlmId) {
    // On UPDATE, deliberately omit `model`. The LLM may have been switched to a
    // speech-to-speech model (`s2s_model`) in the Retell dashboard; Retell then
    // rejects any body that also sets `model` ("Cannot set both model and
    // s2s_model"). Omitting it preserves whichever model is configured and just
    // refreshes the prompt/tools/greeting.
    const res = await retell.llm.update(existingLlmId, common);
    return res.llm_id;
  }
  // On CREATE there's no model yet, so set the template's text model.
  const res = await retell.llm.create({ model: (spec.model ?? 'gpt-4.1') as 'gpt-4.1', ...common });
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
    // TTS-layer pronunciation overrides (omitted when undefined).
    pronunciation_dictionary: input.spec.pronunciation_dictionary,
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
