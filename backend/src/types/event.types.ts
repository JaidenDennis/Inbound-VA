export type EventType =
  | 'call.started'
  | 'call.ended'
  | 'call.transcript.completed'
  | 'call.summary.completed'
  | 'lead.created'
  | 'booking.requested'
  | 'booking.confirmed'
  | 'booking.cancelled'
  | 'booking.rescheduled'
  | 'handoff.requested'
  | 'handoff.connected'
  | 'crm.sync.started'
  | 'crm.sync.completed'
  | 'crm.sync.failed'
  | 'contact.created'
  | 'contact.updated'
  | 'automation.triggered'
  | 'automation.completed'
  | 'notification.sent';

export interface NormalizedEvent {
  id: string;
  type: EventType;
  clientId: string;
  callId?: string;
  contactId?: string;
  appointmentId?: string;
  payload: Record<string, unknown>;
  timestamp: Date;
  source: 'retell' | 'internal' | 'crm' | 'booking';
  idempotencyKey: string;
}

export interface StoredEvent {
  id: string;
  client_id: string;
  event_type: EventType;
  source: string;
  payload: Record<string, unknown>;
  processed: boolean;
  idempotency_key: string;
  created_at: string;
}

export type AutomationTrigger =
  | 'call.ended'
  | 'lead.created'
  | 'booking.confirmed'
  | 'handoff.requested';

export interface AutomationRule {
  id: string;
  client_id: string;
  name: string;
  trigger: AutomationTrigger;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AutomationCondition {
  field: string;
  operator: 'equals' | 'contains' | 'gt' | 'lt' | 'exists';
  value: unknown;
}

export interface AutomationAction {
  type: 'crm_sync' | 'send_email' | 'create_task' | 'webhook';
  config: Record<string, unknown>;
}

export interface AutomationRun {
  id: string;
  rule_id: string;
  client_id: string;
  trigger_event_id: string;
  status: 'running' | 'completed' | 'failed';
  result: Record<string, unknown> | null;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}
