import { describe, it, expect } from 'vitest';
import {
  normalizeCallStarted,
  normalizeCallEnded,
} from '../providers/retell/retell.normalizer.js';
import type { RetellCallStartedPayload, RetellCallEndedPayload } from '../providers/retell/retell.types.js';

const clientId = 'test-client-id';

describe('Retell event normalizer', () => {
  it('normalizes call.started event', () => {
    const payload: RetellCallStartedPayload = {
      event: 'call_started',
      call: {
        call_id: 'call_abc123',
        agent_id: 'agent_1',
        call_status: 'ongoing',
        start_timestamp: 1700000000000,
        from_number: '+14155551234',
        to_number: '+12125559876',
        direction: 'inbound',
      },
    };
    const event = normalizeCallStarted(payload, clientId);
    expect(event.type).toBe('call.started');
    expect(event.clientId).toBe(clientId);
    expect(event.callId).toBe('call_abc123');
    expect(event.source).toBe('retell');
    expect(event.idempotencyKey).toBeTruthy();
  });

  it('normalizes call.ended event', () => {
    const payload: RetellCallEndedPayload = {
      event: 'call_ended',
      call: {
        call_id: 'call_abc123',
        agent_id: 'agent_1',
        call_status: 'ended',
        start_timestamp: 1700000000000,
        end_timestamp: 1700000060000,
        duration_ms: 60000,
        from_number: '+14155551234',
        to_number: '+12125559876',
        direction: 'inbound',
      },
    };
    const event = normalizeCallEnded(payload, clientId);
    expect(event.type).toBe('call.ended');
    expect((event.payload as Record<string, unknown>).durationMs).toBe(60000);
  });

  it('generates unique idempotency keys per call ID', () => {
    const p1: RetellCallStartedPayload = { event: 'call_started', call: { call_id: 'c1', agent_id: 'a1', call_status: 'ongoing', start_timestamp: 1000, from_number: '+1', to_number: '+2', direction: 'inbound' } };
    const p2: RetellCallStartedPayload = { event: 'call_started', call: { call_id: 'c2', agent_id: 'a1', call_status: 'ongoing', start_timestamp: 1000, from_number: '+1', to_number: '+2', direction: 'inbound' } };
    expect(normalizeCallStarted(p1, clientId).idempotencyKey).not.toBe(normalizeCallStarted(p2, clientId).idempotencyKey);
  });

  it('generates same key for same call ID (idempotent)', () => {
    const p: RetellCallStartedPayload = { event: 'call_started', call: { call_id: 'c1', agent_id: 'a1', call_status: 'ongoing', start_timestamp: 1000, from_number: '+1', to_number: '+2', direction: 'inbound' } };
    expect(normalizeCallStarted(p, clientId).idempotencyKey).toBe(normalizeCallStarted(p, clientId).idempotencyKey);
  });
});
