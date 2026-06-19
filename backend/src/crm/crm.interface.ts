import type {
  CrmContact,
  CrmLead,
  CrmNote,
  CrmTask,
  CrmAppointment,
  CrmSyncResult,
} from '../types/index.js';

export interface ICrmAdapter {
  readonly name: string;

  createOrUpdateContact(contact: CrmContact): Promise<CrmSyncResult>;
  createLead(lead: CrmLead): Promise<CrmSyncResult>;
  createNote(note: CrmNote): Promise<CrmSyncResult>;
  createTask(task: CrmTask): Promise<CrmSyncResult>;
  createAppointment(appointment: CrmAppointment): Promise<CrmSyncResult>;
  updateConversation(contactId: string, data: Record<string, unknown>): Promise<CrmSyncResult>;
  pushTranscript(contactId: string, transcript: string, callId: string): Promise<CrmSyncResult>;
  pushCallSummary(contactId: string, summary: string, callId: string): Promise<CrmSyncResult>;

  testConnection(): Promise<boolean>;
}
