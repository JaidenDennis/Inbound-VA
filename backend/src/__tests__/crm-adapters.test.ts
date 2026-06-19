import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PluginRegistry } from '../plugins/plugin-registry.js';
import type { ICrmAdapter } from '../crm/crm.interface.js';

describe('PluginRegistry', () => {
  let registry: PluginRegistry<ICrmAdapter>;

  beforeEach(() => {
    registry = new PluginRegistry<ICrmAdapter>('test-crm');
  });

  it('registers and resolves a plugin', () => {
    const mockAdapter: ICrmAdapter = {
      name: 'mock',
      createOrUpdateContact: vi.fn().mockResolvedValue({ success: true }),
      createLead: vi.fn().mockResolvedValue({ success: true }),
      createNote: vi.fn().mockResolvedValue({ success: true }),
      createTask: vi.fn().mockResolvedValue({ success: true }),
      createAppointment: vi.fn().mockResolvedValue({ success: true }),
      updateConversation: vi.fn().mockResolvedValue({ success: true }),
      pushTranscript: vi.fn().mockResolvedValue({ success: true }),
      pushCallSummary: vi.fn().mockResolvedValue({ success: true }),
      testConnection: vi.fn().mockResolvedValue(true),
    };

    registry.register({
      manifest: { name: 'mock', version: '1.0.0', description: 'Mock CRM' },
      factory: () => mockAdapter,
    });

    expect(registry.has('mock')).toBe(true);
    const adapter = registry.resolve('mock', {});
    expect(adapter.name).toBe('mock');
  });

  it('lists registered plugins', () => {
    registry.register({
      manifest: { name: 'crm-a', version: '1.0.0', description: 'A' },
      factory: () => ({} as ICrmAdapter),
    });
    registry.register({
      manifest: { name: 'crm-b', version: '1.0.0', description: 'B' },
      factory: () => ({} as ICrmAdapter),
    });
    expect(registry.list()).toEqual(['crm-a', 'crm-b']);
  });

  it('throws for unknown plugin', () => {
    expect(() => registry.resolve('nonexistent', {})).toThrow(/Unknown plugin/);
  });

  it('is case-insensitive for plugin names', () => {
    registry.register({
      manifest: { name: 'TestCRM', version: '1.0.0', description: 'Test' },
      factory: () => ({} as ICrmAdapter),
    });
    expect(registry.has('testcrm')).toBe(true);
    expect(registry.has('TESTCRM')).toBe(true);
  });
});
