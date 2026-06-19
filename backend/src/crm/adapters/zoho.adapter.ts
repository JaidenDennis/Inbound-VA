import { BaseCrmAdapter } from './base.adapter.js';
import type {
  CrmContact, CrmLead, CrmNote, CrmTask,
  CrmAppointment, CrmSyncResult,
} from '../../types/index.js';
import type { Plugin } from '../../plugins/index.js';
import type { ICrmAdapter } from '../crm.interface.js';

interface ZohoConfig {
  accessToken: string;
  baseUrl?: string;
}

class ZohoAdapter extends BaseCrmAdapter {
  readonly name = 'zoho';

  constructor(config: Record<string, unknown>) {
    super(config);
    const cfg = config as unknown as ZohoConfig;
    this.http.defaults.baseURL = cfg.baseUrl ?? 'https://www.zohoapis.com/crm/v3';
    this.http.defaults.headers.common['Authorization'] = `Zoho-oauthtoken ${cfg.accessToken}`;
    this.http.defaults.headers.common['Content-Type'] = 'application/json';
  }

  async createOrUpdateContact(contact: CrmContact): Promise<CrmSyncResult> {
    try {
      const body = {
        data: [{
          First_Name: contact.firstName,
          Last_Name: contact.lastName,
          Email: contact.email,
          Phone: contact.phone,
          ...contact.customFields,
        }],
        duplicate_check_fields: ['Phone'],
      };
      const { data } = await this.http.post('/Contacts/upsert', body);
      return this.success(data.data?.[0]?.details?.id);
    } catch (err) {
      return this.failure(err);
    }
  }

  async createLead(lead: CrmLead): Promise<CrmSyncResult> {
    try {
      const { data } = await this.http.post('/Deals', {
        data: [{
          Deal_Name: lead.title,
          Stage: lead.stageId ?? 'Qualification',
          Amount: lead.value ?? 0,
          Lead_Source: lead.source,
          Contact_Name: { id: lead.contactId },
        }],
      });
      return this.success(data.data?.[0]?.details?.id);
    } catch (err) {
      return this.failure(err);
    }
  }

  async createNote(note: CrmNote): Promise<CrmSyncResult> {
    try {
      const { data } = await this.http.post('/Notes', {
        data: [{
          Note_Title: 'Call Note',
          Note_Content: note.body,
          Parent_Id: note.contactId,
          $se_module: 'Contacts',
        }],
      });
      return this.success(data.data?.[0]?.details?.id);
    } catch (err) {
      return this.failure(err);
    }
  }

  async createTask(task: CrmTask): Promise<CrmSyncResult> {
    try {
      const { data } = await this.http.post('/Tasks', {
        data: [{
          Subject: task.title,
          Due_Date: task.dueDate.toISOString().split('T')[0],
          Who_Id: { id: task.contactId, type: 'Contacts' },
          Owner: task.assigneeId ? { id: task.assigneeId } : undefined,
        }],
      });
      return this.success(data.data?.[0]?.details?.id);
    } catch (err) {
      return this.failure(err);
    }
  }

  async createAppointment(appointment: CrmAppointment): Promise<CrmSyncResult> {
    try {
      const { data } = await this.http.post('/Events', {
        data: [{
          Event_Title: appointment.title,
          Start_DateTime: appointment.startTime.toISOString(),
          End_DateTime: appointment.endTime.toISOString(),
          Description: appointment.notes,
          Location: appointment.location,
          Who_Id: { id: appointment.contactId, type: 'Contacts' },
        }],
      });
      return this.success(data.data?.[0]?.details?.id);
    } catch (err) {
      return this.failure(err);
    }
  }

  async updateConversation(contactId: string, data: Record<string, unknown>): Promise<CrmSyncResult> {
    try {
      await this.http.put(`/Contacts/${contactId}`, { data: [data] });
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
      await this.http.get('/users?type=CurrentUser');
      return true;
    } catch {
      return false;
    }
  }
}

export const zohoPlugin: Plugin<ICrmAdapter> = {
  manifest: {
    name: 'zoho',
    version: '1.0.0',
    description: 'Zoho CRM adapter',
    author: 'Gravvia',
  },
  factory: (config) => new ZohoAdapter(config),
};
