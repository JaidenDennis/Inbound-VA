export interface CrmContact {
  id?: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone: string;
  tags?: string[];
  customFields?: Record<string, unknown>;
}

export interface CrmLead {
  contactId: string;
  title: string;
  source: string;
  value?: number;
  pipelineId?: string;
  stageId?: string;
  notes?: string;
}

export interface CrmNote {
  contactId: string;
  body: string;
  createdAt: Date;
}

export interface CrmTask {
  contactId: string;
  title: string;
  dueDate: Date;
  assigneeId?: string;
}

export interface CrmAppointment {
  contactId: string;
  title: string;
  startTime: Date;
  endTime: Date;
  location?: string;
  notes?: string;
}

export interface CrmSyncResult {
  success: boolean;
  externalId?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

// ── Canonical calendar-booking types (CRM-calendar truth, inbound Phase 3) ──
// The workflow engine and actions never touch vendor-specific shapes; CRM
// calendar access goes through these adapter methods only.

export interface CrmAvailabilityRequest {
  /** Window start, ISO 8601. */
  startDate: string;
  /** Window end, ISO 8601. */
  endDate: string;
  /** IANA timezone the caller thinks in. */
  timezone: string;
}

export interface CrmAvailabilitySlot {
  /** Slot start, ISO 8601. */
  start: string;
  /** Slot end when the provider reports one. */
  end?: string;
}

export interface CrmBookingUpdate {
  startTime?: Date;
  endTime?: Date;
  title?: string;
}

export interface CrmConnection {
  id: string;
  client_id: string;
  crm_type: string;
  credentials_encrypted: string;
  pipeline_id: string | null;
  stage_mapping: Record<string, string>;
  custom_field_mapping: Record<string, string>;
  /** CRM-specific settings merged into the adapter config (e.g. GHL stageId/calendarId). */
  crm_config: Record<string, unknown> | null;
  /** Set on a 401 from the CRM: the OAuth install must be re-run. Cleared by the callback. */
  needs_reauth: boolean;
  is_active: boolean;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CrmSyncLog {
  id: string;
  client_id: string;
  crm_connection_id: string;
  entity_type: string;
  entity_id: string;
  operation: 'create' | 'update' | 'delete' | 'provision';
  status: 'success' | 'failed' | 'pending' | 'manual_review';
  external_id: string | null;
  error_message: string | null;
  attempts: number;
  /** Provision runs store { blueprintName, steps: ProvisionStepResult[] } here. */
  payload: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}
