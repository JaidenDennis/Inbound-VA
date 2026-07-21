export type QueueName =
  | 'crm-sync'
  | 'booking'
  | 'notifications'
  | 'call-processing'
  | 'transcript-processing'
  | 'analytics';

export interface CrmSyncJobData {
  clientId: string;
  crmConnectionId: string;
  entityType: 'contact' | 'lead' | 'appointment' | 'transcript' | 'summary' | 'note' | 'booking-automation';
  entityId: string;
  operation: 'create' | 'update' | 'delete';
  payload: Record<string, unknown>;
  idempotencyKey: string;
}

/**
 * GHL blueprint provisioning job (job name 'provision' on the crm-sync
 * queue). The blueprint is snapshotted at enqueue time so retries apply what
 * was requested even if client_settings changes mid-run.
 */
export interface CrmProvisionJobData {
  kind: 'provision';
  clientId: string;
  crmConnectionId: string;
  runId: string;
  blueprintName: string;
  blueprint: import('./ghl-blueprint.types.js').GhlBlueprint;
  idempotencyKey: string;
}

export type CrmSyncJob = CrmSyncJobData | CrmProvisionJobData;

export interface BookingJobData {
  clientId: string;
  action: 'create' | 'cancel' | 'reschedule';
  appointmentId?: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
}

export interface NotificationJobData {
  clientId: string;
  type: 'handoff' | 'lead' | 'booking' | 'escalation';
  recipients: string[];
  subject: string;
  body: string;
  callId?: string;
  metadata?: Record<string, unknown>;
}

export interface CallProcessingJobData {
  clientId: string;
  callId: string;
  retellCallId: string;
  idempotencyKey: string;
}

export interface TranscriptProcessingJobData {
  clientId: string;
  callId: string;
  transcript: Array<{ role: string; content: string; timestamp_ms: number }>;
  idempotencyKey: string;
}

export interface AnalyticsJobData {
  clientId: string;
  eventType: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface FailedJob {
  id: string;
  queue_name: QueueName;
  job_id: string;
  job_data: Record<string, unknown>;
  error_message: string;
  attempts: number;
  status: 'failed' | 'manual_review' | 'resolved';
  created_at: string;
  updated_at: string;
}
