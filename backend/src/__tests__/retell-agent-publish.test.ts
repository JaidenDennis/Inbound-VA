import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Retell's draft/publish model, which the provisioner ignored for two weeks.
 *
 * Every one of these assertions corresponds to a real API response observed
 * against the live account on 2026-08-14, not to a reading of the docs:
 *
 *   agent.create   → v0 with is_published FALSE. New agents are not live.
 *   agent.update   → 422 "Cannot update published agent other than version
 *                    title" when the newest version is published.
 *   llm.update     → 400 "Cannot update published LLM" when no draft exists.
 *   agent.publish  → succeeds, but answers with an empty body, which the SDK
 *                    then fails to parse as JSON.
 *
 * The ordering is therefore load-bearing: branch a draft, THEN touch the LLM,
 * then the agent, then publish. Two of those steps fail loudly if reordered,
 * which is the only reason the old code failed silently instead — it never
 * created a draft, so it always found the stale one left behind.
 */

interface Version {
  version: number;
  is_published: boolean;
}

const agentCreate = vi.fn();
const agentUpdate = vi.fn();
const agentPublish = vi.fn();
const agentGetVersions = vi.fn();
const agentCreateVersion = vi.fn();
const llmCreate = vi.fn();
const llmUpdate = vi.fn();
const phoneNumberUpdate = vi.fn();

vi.mock('../providers/retell/retell.client.js', () => ({
  retell: {
    agent: {
      create: agentCreate,
      update: agentUpdate,
      publish: agentPublish,
      getVersions: agentGetVersions,
      createVersion: agentCreateVersion,
    },
    llm: { create: llmCreate, update: llmUpdate },
    phoneNumber: { update: phoneNumberUpdate },
  },
}));

const { provisionRetellAgent, setInboundAgent } = await import('../providers/retell/retell.agent.js');

/** The exact error retell-sdk raises on publish's empty 200 body. */
function emptyBodyError(): Error {
  return new SyntaxError('Unexpected end of JSON input');
}

/** Point getVersions at a fixed set of versions. */
function withVersions(...versions: Version[]): void {
  agentGetVersions.mockResolvedValue(versions);
}

const responseEngine = {
  model: 'gpt-4.1',
  general_prompt: 'be helpful',
  begin_message: 'hello',
  general_tools: [],
};

const agentSpec = {
  voice_id: '11labs-Emily',
  agent_name: 'Emily',
  language: 'en-US',
};

function provision(overrides: Record<string, unknown> = {}) {
  return provisionRetellAgent({
    responseEngine: responseEngine as never,
    agentSpec: agentSpec as never,
    webhookUrl: 'https://api.example.com/webhooks/retell',
    existingAgentId: null,
    existingLlmId: null,
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  llmCreate.mockResolvedValue({ llm_id: 'llm_new' });
  llmUpdate.mockResolvedValue({ llm_id: 'llm_existing', version: 1 });
  agentCreate.mockResolvedValue({ agent_id: 'agent_new', version: 0, is_published: false });
  agentUpdate.mockResolvedValue({ agent_id: 'agent_existing', version: 4, is_published: false });
  agentCreateVersion.mockResolvedValue({ version: 4, is_published: false });
  agentPublish.mockResolvedValue(undefined);
  // Default read-back: whatever was published is published.
  withVersions({ version: 4, is_published: true });
});

describe('provisionRetellAgent — new agent', () => {
  it('publishes the version it just created, because create leaves it a draft', async () => {
    withVersions({ version: 0, is_published: true });

    const result = await provision();

    expect(agentCreate).toHaveBeenCalledOnce();
    expect(agentPublish).toHaveBeenCalledWith('agent_new', { version: 0 });
    expect(result).toMatchObject({ agentId: 'agent_new', llmId: 'llm_new', version: 0 });
  });

  it('does not branch a draft version for an agent that does not exist yet', async () => {
    withVersions({ version: 0, is_published: true });

    await provision();

    expect(agentCreateVersion).not.toHaveBeenCalled();
    expect(agentUpdate).not.toHaveBeenCalled();
  });
});

describe('provisionRetellAgent — existing agent', () => {
  it('branches a new draft when the newest version is published', async () => {
    agentGetVersions
      .mockResolvedValueOnce([
        { version: 2, is_published: true },
        { version: 3, is_published: true },
      ])
      .mockResolvedValue([{ version: 4, is_published: true }]);

    await provision({ existingAgentId: 'agent_existing', existingLlmId: 'llm_existing' });

    // Branched from the NEWEST version, not the first one the list happened to
    // return — getVersions is not ordered.
    expect(agentCreateVersion).toHaveBeenCalledWith('agent_existing', { base_version: 3 });
    expect(agentUpdate).toHaveBeenCalledOnce();
    expect(agentPublish).toHaveBeenCalledWith('agent_existing', { version: 4 });
  });

  it('reuses the existing draft rather than stacking another one', async () => {
    agentGetVersions
      .mockResolvedValueOnce([
        { version: 3, is_published: true },
        { version: 4, is_published: false },
      ])
      .mockResolvedValue([{ version: 4, is_published: true }]);

    await provision({ existingAgentId: 'agent_existing', existingLlmId: 'llm_existing' });

    expect(agentCreateVersion).not.toHaveBeenCalled();
    expect(agentPublish).toHaveBeenCalledWith('agent_existing', { version: 4 });
  });

  it('branches the draft BEFORE updating the LLM (llm.update 400s otherwise)', async () => {
    agentGetVersions
      .mockResolvedValueOnce([{ version: 3, is_published: true }])
      .mockResolvedValue([{ version: 4, is_published: true }]);

    await provision({ existingAgentId: 'agent_existing', existingLlmId: 'llm_existing' });

    expect(agentCreateVersion.mock.invocationCallOrder[0])
      .toBeLessThan(llmUpdate.mock.invocationCallOrder[0]);
    expect(llmUpdate.mock.invocationCallOrder[0])
      .toBeLessThan(agentUpdate.mock.invocationCallOrder[0]);
    expect(agentUpdate.mock.invocationCallOrder[0])
      .toBeLessThan(agentPublish.mock.invocationCallOrder[0]);
  });
});

describe('publish result handling', () => {
  it('treats the empty response body as success, not failure', async () => {
    agentPublish.mockRejectedValue(emptyBodyError());
    withVersions({ version: 0, is_published: true });

    await expect(provision()).resolves.toMatchObject({ version: 0 });
  });

  it('rethrows a genuine publish failure', async () => {
    agentPublish.mockRejectedValue(Object.assign(new Error('422 Cannot publish'), { status: 422 }));

    await expect(provision()).rejects.toThrow('Cannot publish');
  });

  it('fails when the version did not actually go live, rather than reporting success', async () => {
    // The whole bug was a provisioner that claimed success without checking.
    withVersions({ version: 0, is_published: false });

    await expect(provision()).rejects.toThrow(/did not go live|not published/i);
  });
});

describe('setInboundAgent', () => {
  it('pins the number to the published version rather than relying on a default', async () => {
    await setInboundAgent('+19047605971', 'agent_existing');

    expect(phoneNumberUpdate).toHaveBeenCalledWith('+19047605971', {
      inbound_agents: [{ agent_id: 'agent_existing', weight: 1, agent_version: 'latest_published' }],
    });
  });
});

/**
 * The transfer tool has to reach the payload, not just the spec.
 *
 * `transfer_enabled` and `transfer_number` were editable in the dashboard and
 * never sent to Retell at all — RetellToolSpec modelled only custom function
 * tools, so a transfer could not be expressed. The template now emits a
 * `transfer` spec; this is the half that turns it into Retell's built-in
 * `transfer_call` tool, and a mistake here is invisible from the template side.
 */
describe('provisionRetellAgent — live transfer', () => {
  // These provision a NEW agent, which create() leaves at v0; the suite default
  // describes v4 and would fail the publish read-back for unrelated reasons.
  beforeEach(() => withVersions({ version: 0, is_published: true }));

  const toolsSent = () => {
    const payload = (llmCreate.mock.calls[0]?.[0] ?? llmUpdate.mock.calls[0]?.[1]) as {
      general_tools?: Array<Record<string, unknown>>;
    };
    return payload.general_tools ?? [];
  };

  it('sends a cold transfer_call tool with the configured destination', async () => {
    await provision({ responseEngine: { ...responseEngine, transfer: { number: '+19045551234' } } as never });

    const transfer = toolsSent().find((t) => t.type === 'transfer_call');
    expect(transfer).toBeDefined();
    expect(transfer!.transfer_destination).toEqual({ type: 'predefined', number: '+19045551234' });
    expect(transfer!.transfer_option).toEqual({ type: 'cold_transfer' });
    // The caller must be told before the line goes quiet mid-handover.
    expect(transfer!.speak_during_execution).toBe(true);
  });

  it('sends no transfer tool when the spec carries no destination', async () => {
    await provision();
    expect(toolsSent().some((t) => t.type === 'transfer_call')).toBe(false);
  });

  it('still sends end_call either way, so the two built-ins do not displace each other', async () => {
    await provision({ responseEngine: { ...responseEngine, transfer: { number: '+19045551234' } } as never });
    expect(toolsSent().some((t) => t.type === 'end_call')).toBe(true);
  });
});
