import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import type { EventType, NormalizedEvent } from '../types/index.js';
import { supabase } from '../db/index.js';
import { logger } from '../utils/index.js';

class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
  }

  async publish(event: Omit<NormalizedEvent, 'id' | 'timestamp'>): Promise<NormalizedEvent> {
    const normalized: NormalizedEvent = {
      ...event,
      id: uuidv4(),
      timestamp: new Date(),
    };

    // Persist to DB for audit trail and replay
    await this.persist(normalized);

    // Emit locally for in-process handlers
    this.emit(event.type, normalized);
    this.emit('*', normalized);

    logger.debug({ eventId: normalized.id, type: normalized.type }, 'Event published');
    return normalized;
  }

  private async persist(event: NormalizedEvent): Promise<void> {
    const { error } = await supabase.from('events').upsert({
      id: event.id,
      client_id: event.clientId,
      event_type: event.type,
      source: event.source,
      payload: event.payload,
      processed: false,
      idempotency_key: event.idempotencyKey,
    }, { onConflict: 'idempotency_key', ignoreDuplicates: true });

    if (error) {
      logger.error({ error, eventId: event.id }, 'Failed to persist event');
    }
  }

  subscribe(eventType: EventType | '*', handler: (event: NormalizedEvent) => void): void {
    this.on(eventType, handler);
  }

  unsubscribe(eventType: EventType | '*', handler: (event: NormalizedEvent) => void): void {
    this.off(eventType, handler);
  }
}

export const eventBus = new EventBus();
