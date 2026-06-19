import { BaseCrmAdapter } from './base.adapter.js';
import type {
  CrmContact, CrmLead, CrmNote, CrmTask,
  CrmAppointment, CrmSyncResult,
} from '../../types/index.js';
import type { Plugin } from '../../plugins/index.js';
import type { ICrmAdapter } from '../crm.interface.js';

interface WebhookConfig {
  webhookUrl: string;
  secret?: string;
  headers?: Record<string, string>;
}

class WebhookAdapter extends BaseCrmAdapter {
  readonly name = 'webhook';

  constructor(config: Record<string, unknown>) {
    super(config);
    const cfg = config as unknown as WebhookConfig;
    this.http.defaults.headers.common['Content-Type'] = 'application/json';
    if (cfg.secret) {
      this.http.defaults.headers.common['X-Webhook-Secret'] = cfg.secret;
    }
    if (cfg.headers) {
      Object.entries(cfg.headers).forEach(([k, v]) => {
        this.http.defaults.headers.common[k] = v;
      });
    }
  }

  private get webhookUrl(): string {
    return (this.config as unknown as WebhookConfig).webhookUrl;
  }

  private async post(event: string, data: unknown): Promise<CrmSyncResult> {
    try {
      const { data: res } = await this.http.post(this.webhookUrl, {
        event,
        timestamp: new Date().toISOString(),
        data,
      });
      return this.success(res?.id?.toString());
    } catch (err) {
      return this.failure(err);
    }
  }

  createOrUpdateContact(contact: CrmContact): Promise<CrmSyncResult> {
    return this.post('contact.upserted', contact);
  }

  createLead(lead: CrmLead): Promise<CrmSyncResult> {
    return this.post('lead.created', lead);
  }

  createNote(note: CrmNote): Promise<CrmSyncResult> {
    return this.post('note.created', note);
  }

  createTask(task: CrmTask): Promise<CrmSyncResult> {
    return this.post('task.created', task);
  }

  createAppointment(appointment: CrmAppointment): Promise<CrmSyncResult> {
    return this.post('appointment.created', appointment);
  }

  updateConversation(contactId: string, data: Record<string, unknown>): Promise<CrmSyncResult> {
    return this.post('conversation.updated', { contactId, ...data });
  }

  pushTranscript(contactId: string, transcript: string, callId: string): Promise<CrmSyncResult> {
    return this.post('call.transcript', { contactId, callId, transcript });
  }

  pushCallSummary(contactId: string, summary: string, callId: string): Promise<CrmSyncResult> {
    return this.post('call.summary', { contactId, callId, summary });
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.post('ping', { test: true });
      return true;
    } catch {
      return false;
    }
  }
}

export const webhookPlugin: Plugin<ICrmAdapter> = {
  manifest: {
    name: 'webhook',
    version: '1.0.0',
    description: 'Generic webhook CRM adapter — posts events to any HTTP endpoint',
    author: 'Gravvia',
  },
  factory: (config) => new WebhookAdapter(config),
};
