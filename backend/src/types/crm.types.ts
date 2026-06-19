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

export interface CrmConnection {
  id: string;
  client_id: string;
  crm_type: string;
  credentials_encrypted: string;
  pipeline_id: string | null;
  stage_mapping: Record<string, string>;
  custom_field_mapping: Record<string, string>;
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
  operation: 'create' | 'update' | 'delete';
  status: 'success' | 'failed' | 'pending';
  external_id: string | null;
  error_message: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
}
