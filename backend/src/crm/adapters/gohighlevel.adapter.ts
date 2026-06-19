import { BaseCrmAdapter } from './base.adapter.js';
import type {
  CrmContact, CrmLead, CrmNote, CrmTask,
  CrmAppointment, CrmSyncResult,
} from '../../types/index.js';
import type { Plugin } from '../../plugins/index.js';
import type { ICrmAdapter } from '../crm.interface.js';

interface GhlConfig {
  apiKey: string;
  locationId: string;
  baseUrl?: string;
}

class GoHighLevelAdapter extends BaseCrmAdapter {
  readonly name = 'gohighlevel';
  private readonly locationId: string;

  constructor(config: Record<string, unknown>) {
    super(config);
    const cfg = config as unknown as GhlConfig;
    this.locationId = cfg.locationId;
    this.http.defaults.baseURL = cfg.baseUrl ?? 'https://rest.gohighlevel.com/v1';
    this.http.defaults.headers.common['Authorization'] = `Bearer ${cfg.apiKey}`;
    this.http.defaults.headers.common['Content-Type'] = 'application/json';
  }

  async createOrUpdateContact(contact: CrmContact): Promise<CrmSyncResult> {
    try {
      const { data } = await this.http.post('/contacts/', {
        locationId: this.locationId,
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: contact.email,
        phone: contact.phone,
        tags: contact.tags ?? [],
        customField: contact.customFields,
      });
      return this.success(data.contact?.id);
    } catch (err) {
      return this.failure(err);
    }
  }

  async createLead(lead: CrmLead): Promise<CrmSyncResult> {
    try {
      const { data } = await this.http.post('/opportunities/', {
        pipelineId: lead.pipelineId,
        locationId: this.locationId,
        name: lead.title,
        pipelineStageId: lead.stageId,
        contactId: lead.contactId,
        monetaryValue: lead.value ?? 0,
        source: lead.source,
      });
      return this.success(data.opportunity?.id);
    } catch (err) {
      return this.failure(err);
    }
  }

  async createNote(note: CrmNote): Promise<CrmSyncResult> {
    try {
      const { data } = await this.http.post(`/contacts/${note.contactId}/notes/`, {
        body: note.body,
      });
      return this.success(data.note?.id);
    } catch (err) {
      return this.failure(err);
    }
  }

  async createTask(task: CrmTask): Promise<CrmSyncResult> {
    try {
      const { data } = await this.http.post(`/contacts/${task.contactId}/tasks/`, {
        title: task.title,
        dueDate: task.dueDate.toISOString(),
        assignedTo: task.assigneeId,
      });
      return this.success(data.task?.id);
    } catch (err) {
      return this.failure(err);
    }
  }

  async createAppointment(appointment: CrmAppointment): Promise<CrmSyncResult> {
    try {
      const { data } = await this.http.post('/appointments/', {
        calendarId: (this.config as unknown as GhlConfig & { calendarId?: string }).calendarId,
        locationId: this.locationId,
        contactId: appointment.contactId,
        title: appointment.title,
        startTime: appointment.startTime.toISOString(),
        endTime: appointment.endTime.toISOString(),
        notes: appointment.notes,
      });
      return this.success(data.appointment?.id);
    } catch (err) {
      return this.failure(err);
    }
  }

  async updateConversation(contactId: string, data: Record<string, unknown>): Promise<CrmSyncResult> {
    try {
      await this.http.put(`/contacts/${contactId}`, data);
      return this.success(contactId);
    } catch (err) {
      return this.failure(err);
    }
  }

  async pushTranscript(contactId: string, transcript: string, callId: string): Promise<CrmSyncResult> {
    return this.createNote({
      contactId,
      body: `📞 Call Transcript (${callId}):\n\n${transcript}`,
      createdAt: new Date(),
    });
  }

  async pushCallSummary(contactId: string, summary: string, callId: string): Promise<CrmSyncResult> {
    return this.createNote({
      contactId,
      body: `📋 Call Summary (${callId}):\n\n${summary}`,
      createdAt: new Date(),
    });
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.http.get(`/locations/${this.locationId}`);
      return true;
    } catch {
      return false;
    }
  }
}

export const goHighLevelPlugin: Plugin<ICrmAdapter> = {
  manifest: {
    name: 'gohighlevel',
    version: '1.0.0',
    description: 'GoHighLevel CRM adapter',
    author: 'Gravvia',
  },
  factory: (config) => new GoHighLevelAdapter(config),
};
