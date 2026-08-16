import { retell } from './retell.client.js';
import { buildPostCallAnalysisSchema } from './retell.analysis-fields.js';
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
 * Retell versions agents, and an update only ever writes to a DRAFT.
 *
 * Verified against the live API on 2026-08-14 rather than read from the docs,
 * because every one of these is a hard failure or a silent one:
 *
 *   agent.create   → v0 with is_published FALSE. A new agent is not live.
 *   agent.update   → 422 "Cannot update published agent other than version
 *                    title" if the newest version is published.
 *   llm.update     → 400 "Cannot update published LLM" if no draft exists.
 *   agent.publish  → succeeds with an EMPTY body, which retell-sdk then throws
 *                    on while trying to parse it as JSON.
 *
 * Until this was fixed the provisioner called update + never published, so
 * every dashboard edit landed in a draft nobody shipped while the phone number
 * kept answering on the last published version — and provisionClient reported
 * success, because the update itself had returned 200. Seven agents were found
 * carrying unpublished drafts, one of them thirteen days old.
 */

/**
 * publish answers 200 with no body; the SDK tries to JSON.parse it and throws.
 * A parse failure therefore means the call SUCCEEDED, which is why this cannot
 * simply be a catch-all — a genuine 4xx must still propagate.
 */
function isEmptyBodyError(err: unknown): boolean {
  const message = (err as Error | undefined)?.message ?? '';
  const status = (err as { status?: number } | undefined)?.status;
  return status === undefined && /Unexpected end of JSON input/i.test(message);
}

/** getVersions returns no particular order, so never trust position. */
function newestVersion<T extends { version: number }>(versions: T[]): T | undefined {
  return versions.reduce<T | undefined>(
    (best, v) => (best === undefined || v.version > best.version ? v : best),
    undefined
  );
}

async function listVersions(agentId: string): Promise<Array<{ version: number; is_published?: boolean }>> {
  const res = (await retell.agent.getVersions(agentId)) as unknown;
  if (Array.isArray(res)) return res as Array<{ version: number; is_published?: boolean }>;
  return ((res as { items?: unknown[] })?.items ?? []) as Array<{ version: number; is_published?: boolean }>;
}

/**
 * Make sure a draft exists to write into, branching one from the newest version
 * when everything is published. Reuses an existing draft rather than stacking
 * another, so a burst of edits does not litter the version history.
 */
async function ensureDraftVersion(agentId: string): Promise<void> {
  const newest = newestVersion(await listVersions(agentId));
  if (!newest || !newest.is_published) return;
  await retell.agent.createVersion(agentId, { base_version: newest.version });
}

/**
 * Publish a version and CONFIRM it went live.
 *
 * The read-back is the point. This whole bug was a provisioner that reported
 * success on the strength of a 200 it never checked the meaning of, so the one
 * thing this must not do is assume. If the version is not published afterwards,
 * throwing is what keeps the dashboard's sync badge honest.
 */
async function publishVersion(agentId: string, version: number): Promise<void> {
  try {
    await retell.agent.publish(agentId, { version });
  } catch (err) {
    if (!isEmptyBodyError(err)) throw err;
  }

  const published = (await listVersions(agentId)).find((v) => v.version === version);
  if (!published?.is_published) {
    throw new Error(
      `Retell accepted the publish but agent ${agentId} v${version} did not go live — the agent is still serving its previous version`
    );
  }
}

/**
 * Create the Retell LLM (Response Engine) or UPDATE it in place when the client
 * already has one. Returns the llm_id.
 *
 * NOTE: on the update path a draft agent version must already exist, or Retell
 * answers 400 "Cannot update published LLM". provisionRetellAgent owns that
 * ordering; call this directly at your peril.
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
    // Voice stability — keeps the tone consistent across the call (see AgentSpec).
    voice_temperature: input.spec.voice_temperature,
    voice_speed: input.spec.voice_speed,
    // TTS-layer pronunciation overrides (omitted when undefined).
    pronunciation_dictionary: input.spec.pronunciation_dictionary,
    // Post-call extractions that back the demand-intelligence surfaces
    // (migration 023). Sent on both create and update, so an existing agent
    // picks the fields up on its next provision — which is the only way older
    // agents start reporting them, since no backfill of past calls is possible.
    post_call_analysis_data: buildPostCallAnalysisSchema(),
  };
  if (input.existingAgentId) {
    const res = await retell.agent.update(input.existingAgentId, body);
    return { agentId: res.agent_id, version: res.version };
  }
  const res = await retell.agent.create(body);
  return { agentId: res.agent_id, version: res.version };
}

/**
 * Push a client's whole configuration to Retell and make it LIVE.
 *
 * The four steps have to happen in this order and the ordering is the entire
 * reason this function exists rather than the caller composing the pieces:
 *
 *   1. branch a draft   — llm.update and agent.update both refuse to touch a
 *                         published version
 *   2. update the LLM   — prompt, greeting, tools
 *   3. update the agent — voice, pacing, webhook, analysis fields
 *   4. publish          — without this the phone number keeps answering on the
 *                         previous version, which is the bug this replaced
 *
 * Returns the version that is now serving calls, not merely the one written.
 */
export async function provisionRetellAgent(input: {
  responseEngine: ResponseEngineSpec;
  agentSpec: AgentSpec;
  webhookUrl: string;
  existingAgentId?: string | null;
  existingLlmId?: string | null;
}): Promise<{ agentId: string; llmId: string; version: number }> {
  // A brand new agent has no version to branch from; create() makes v0 for us.
  if (input.existingAgentId) await ensureDraftVersion(input.existingAgentId);

  const llmId = await createOrUpdateResponseEngine(input.responseEngine, input.existingLlmId);

  const { agentId, version } = await createOrUpdateAgent({
    spec: input.agentSpec,
    llmId,
    webhookUrl: input.webhookUrl,
    existingAgentId: input.existingAgentId,
  });

  // create() leaves v0 unpublished too, so this is not update-only.
  await publishVersion(agentId, version);

  return { agentId, llmId, version };
}

/**
 * Point an existing Retell phone number at an agent (no purchase).
 *
 * `latest_published` is pinned explicitly rather than left to Retell's default.
 * The numbers in this account carry no `agent_version` at all, which resolves
 * to the published version — the behaviour we want, but only by luck. Saying it
 * out loud means a future Retell default cannot silently switch every client's
 * line onto unpublished drafts.
 */
export async function setInboundAgent(phoneNumber: string, agentId: string): Promise<void> {
  await retell.phoneNumber.update(phoneNumber, {
    inbound_agents: [{ agent_id: agentId, weight: 1, agent_version: 'latest_published' }],
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
