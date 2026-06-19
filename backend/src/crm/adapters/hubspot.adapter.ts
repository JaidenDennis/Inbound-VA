import { BaseCrmAdapter } from './base.adapter.js';
import type {
  CrmContact, CrmLead, CrmNote, CrmTask,
  CrmAppointment, CrmSyncResult,
} from '../../types/index.js';
import type { Plugin } from '../../plugins/index.js';
import type { ICrmAdapter } from '../crm.interface.js';

interface HubSpotConfig {
  accessToken: string;
  portalId?: string;
}

class HubSpotAdapter extends BaseCrmAdapter {
  readonly name = 'hubspot';

  constructor(config: Record<string, unknown>) {
    super(config);
    const cfg = config as unknown as HubSpotConfig;
    this.http.defaults.baseURL = 'https://api.hubapi.com';
    this.http.defaults.headers.common['Authorization'] = `Bearer ${cfg.accessToken}`;
    this.http.defaults.headers.common['Content-Type'] = 'application/json';
  }

  async createOrUpdateContact(contact: CrmContact): Promise<CrmSyncResult> {
    try {
      const properties = {
        firstname: contact.firstName,
        lastname: contact.lastName,
        email: contact.email ?? '',
        phone: contact.phone,
        ...contact.customFields,
      };

      if (contact.id) {
        const { data } = await this.http.patch(`/crm/v3/objects/contacts/${contact.id}`, { properties });
        return this.success(data.id);
      }

      const { data } = await this.http.post('/crm/v3/objects/contacts', { properties });
      return this.success(data.id);
    } catch (err) {
      return this.failure(err);
    }
  }

  async createLead(lead: CrmLead): Promise<CrmSyncResult> {
    try {
      const { data } = await this.http.post('/crm/v3/objects/deals', {
        properties: {
          dealname: lead.title,
          pipeline: lead.pipelineId ?? 'default',
          dealstage: lead.stageId ?? 'appointmentscheduled',
          amount: lead.value ?? 0,
        },
        associations: [
          {
            to: { id: lead.contactId },
            types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }],
          },
        ],
      });
      return this.success(data.id);
    } catch (err) {
      return this.failure(err);
    }
  }

  async createNote(note: CrmNote): Promise<CrmSyncResult> {
    try {
      const { data } = await this.http.post('/crm/v3/objects/notes', {
        properties: {
          hs_note_body: note.body,
          hs_timestamp: note.createdAt.toISOString(),
        },
        associations: [
          {
            to: { id: note.contactId },
            types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }],
          },
        ],
      });
      return this.success(data.id);
    } catch (err) {
      return this.failure(err);
    }
  }

  async createTask(task: CrmTask): Promise<CrmSyncResult> {
    try {
      const { data } = await this.http.post('/crm/v3/objects/tasks', {
        properties: {
          hs_task_subject: task.title,
          hs_timestamp: task.dueDate.toISOString(),
          hs_task_status: 'NOT_STARTED',
          hubspot_owner_id: task.assigneeId,
        },
        associations: [
          {
            to: { id: task.contactId },
            types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 204 }],
          },
        ],
      });
      return this.success(data.id);
    } catch (err) {
      return this.failure(err);
    }
  }

  async createAppointment(appointment: CrmAppointment): Promise<CrmSyncResult> {
    try {
      const { data } = await this.http.post('/crm/v3/objects/meetings', {
        properties: {
          hs_meeting_title: appointment.title,
          hs_meeting_start_time: appointment.startTime.getTime(),
          hs_meeting_end_time: appointment.endTime.getTime(),
          hs_meeting_body: appointment.notes ?? '',
          hs_meeting_location: appointment.location ?? '',
        },
        associations: [
          {
            to: { id: appointment.contactId },
            types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 200 }],
          },
        ],
      });
      return this.success(data.id);
    } catch (err) {
      return this.failure(err);
    }
  }

  async updateConversation(contactId: string, data: Record<string, unknown>): Promise<CrmSyncResult> {
    try {
      await this.http.patch(`/crm/v3/objects/contacts/${contactId}`, { properties: data });
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
      await this.http.get('/crm/v3/objects/contacts?limit=1');
      return true;
    } catch {
      return false;
    }
  }
}

export const hubSpotPlugin: Plugin<ICrmAdapter> = {
  manifest: {
    name: 'hubspot',
    version: '1.0.0',
    description: 'HubSpot CRM adapter',
    author: 'Gravvia',
  },
  factory: (config) => new HubSpotAdapter(config),
};
