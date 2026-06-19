import { BaseCrmAdapter } from './base.adapter.js';
import type {
  CrmContact, CrmLead, CrmNote, CrmTask,
  CrmAppointment, CrmSyncResult,
} from '../../types/index.js';
import type { Plugin } from '../../plugins/index.js';
import type { ICrmAdapter } from '../crm.interface.js';

interface SalesforceConfig {
  instanceUrl: string;
  accessToken: string;
  apiVersion?: string;
}

class SalesforceAdapter extends BaseCrmAdapter {
  readonly name = 'salesforce';
  private apiBase: string;

  constructor(config: Record<string, unknown>) {
    super(config);
    const cfg = config as unknown as SalesforceConfig;
    const version = cfg.apiVersion ?? 'v59.0';
    this.apiBase = `${cfg.instanceUrl}/services/data/${version}`;
    this.http.defaults.baseURL = this.apiBase;
    this.http.defaults.headers.common['Authorization'] = `Bearer ${cfg.accessToken}`;
    this.http.defaults.headers.common['Content-Type'] = 'application/json';
  }

  async createOrUpdateContact(contact: CrmContact): Promise<CrmSyncResult> {
    try {
      if (contact.id) {
        await this.http.patch(`/sobjects/Contact/${contact.id}`, {
          FirstName: contact.firstName,
          LastName: contact.lastName,
          Email: contact.email,
          Phone: contact.phone,
          ...contact.customFields,
        });
        return this.success(contact.id);
      }
      const { data } = await this.http.post('/sobjects/Contact', {
        FirstName: contact.firstName,
        LastName: contact.lastName,
        Email: contact.email,
        Phone: contact.phone,
        ...contact.customFields,
      });
      return this.success(data.id);
    } catch (err) {
      return this.failure(err);
    }
  }

  async createLead(lead: CrmLead): Promise<CrmSyncResult> {
    try {
      const { data } = await this.http.post('/sobjects/Opportunity', {
        Name: lead.title,
        StageName: lead.stageId ?? 'Prospecting',
        CloseDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        Amount: lead.value ?? 0,
        LeadSource: lead.source,
      });
      return this.success(data.id);
    } catch (err) {
      return this.failure(err);
    }
  }

  async createNote(note: CrmNote): Promise<CrmSyncResult> {
    try {
      const { data } = await this.http.post('/sobjects/Note', {
        ParentId: note.contactId,
        Title: 'Call Note',
        Body: note.body,
      });
      return this.success(data.id);
    } catch (err) {
      return this.failure(err);
    }
  }

  async createTask(task: CrmTask): Promise<CrmSyncResult> {
    try {
      const { data } = await this.http.post('/sobjects/Task', {
        WhoId: task.contactId,
        Subject: task.title,
        ActivityDate: task.dueDate.toISOString().split('T')[0],
        OwnerId: task.assigneeId,
        Status: 'Not Started',
      });
      return this.success(data.id);
    } catch (err) {
      return this.failure(err);
    }
  }

  async createAppointment(appointment: CrmAppointment): Promise<CrmSyncResult> {
    try {
      const { data } = await this.http.post('/sobjects/Event', {
        WhoId: appointment.contactId,
        Subject: appointment.title,
        StartDateTime: appointment.startTime.toISOString(),
        EndDateTime: appointment.endTime.toISOString(),
        Description: appointment.notes,
        Location: appointment.location,
      });
      return this.success(data.id);
    } catch (err) {
      return this.failure(err);
    }
  }

  async updateConversation(contactId: string, data: Record<string, unknown>): Promise<CrmSyncResult> {
    try {
      await this.http.patch(`/sobjects/Contact/${contactId}`, data);
      return this.success(contactId);
    } catch (err) {
      return this.failure(err);
    }
  }

  async pushTranscript(contactId: string, transcript: string, callId: string): Promise<CrmSyncResult> {
    return this.createNote({ contactId, body: `Call Transcript (${callId}):\n\n${transcript}`, createdAt: new Date() });
  }

  async pushCallSummary(contactId: string, summary: string, callId: string): Promise<CrmSyncResult> {
    return this.createNote({ contactId, body: `Call Summary (${callId}):\n\n${summary}`, createdAt: new Date() });
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.http.get('/limits');
      return true;
    } catch {
      return false;
    }
  }
}

export const salesforcePlugin: Plugin<ICrmAdapter> = {
  manifest: {
    name: 'salesforce',
    version: '1.0.0',
    description: 'Salesforce CRM adapter',
    author: 'Gravvia',
  },
  factory: (config) => new SalesforceAdapter(config),
};
