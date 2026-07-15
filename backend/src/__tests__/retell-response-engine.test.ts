import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the shared Retell client so we can assert on the exact bodies sent.
const llmCreate = vi.fn((_body: Record<string, unknown>) => Promise.resolve({ llm_id: 'llm_created' }));
const llmUpdate = vi.fn((_id: string, _body: Record<string, unknown>) => Promise.resolve({ llm_id: 'llm_updated' }));
vi.mock('../providers/retell/retell.client.js', () => ({
  retell: { llm: { create: llmCreate, update: llmUpdate } },
}));

const { createOrUpdateResponseEngine } = await import('../providers/retell/retell.agent.js');

const spec = {
  model: 'gpt-4.1',
  general_prompt: 'hello',
  begin_message: 'hi',
  general_tools: [
    { name: 'check_availability' as const, url: 'https://x/functions/retell/check_availability', description: 'd' },
  ],
};

describe('createOrUpdateResponseEngine model handling', () => {
  beforeEach(() => vi.clearAllMocks());

  it('CREATE includes model', async () => {
    const id = await createOrUpdateResponseEngine(spec, null);
    expect(id).toBe('llm_created');
    expect(llmCreate).toHaveBeenCalledOnce();
    expect(llmCreate.mock.calls[0][0]).toHaveProperty('model', 'gpt-4.1');
  });

  it('UPDATE omits model (avoids "Cannot set both model and s2s_model")', async () => {
    const id = await createOrUpdateResponseEngine(spec, 'llm_existing');
    expect(id).toBe('llm_updated');
    expect(llmUpdate).toHaveBeenCalledOnce();
    const body = llmUpdate.mock.calls[0][1];
    expect(body).not.toHaveProperty('model');
    // Still refreshes prompt + tools + greeting.
    expect(body).toHaveProperty('general_prompt', 'hello');
    expect(body).toHaveProperty('begin_message', 'hi');
    expect(body).toHaveProperty('general_tools');
  });
});
