import { BaseCrmAdapter } from './base.adapter.js';
import type {
  CrmContact, CrmLead, CrmNote, CrmTask,
  CrmAppointment, CrmSyncResult,
  CrmAvailabilityRequest, CrmAvailabilitySlot, CrmBookingUpdate,
} from '../../types/index.js';
import type { Plugin } from '../../plugins/index.js';
import type { ICrmAdapter } from '../crm.interface.js';

// GoHighLevel v2 API (services.leadconnectorhq.com), authenticated with the
// OAuth access token resolved by resolveAdapterConfig(). The legacy v1 API
// (rest.gohighlevel.com + location API keys) is deprecated and new
// sub-accounts can no longer issue v1 keys, so v1 is not supported here.
//
// Every v2 request needs a Version header; contacts/opportunities/locations
// use 2021-07-28, calendars use 2021-04-15.
const DEFAULT_BASE_URL = 'https://services.leadconnectorhq.com';
const API_VERSION = '2021-07-28';
const CALENDARS_API_VERSION = '2021-04-15';

interface GhlConfig {
  accessToken: string;
  locationId: string;
  /** Default pipeline for new opportunities (crm_connections.pipeline_id). */
  pipelineId?: string;
  /** Default stage inside pipelineId (crm_config.stageId). */
  stageId?: string;
  /** Calendar that receives AI-booked appointments (crm_config.calendarId). */
  calendarId?: string;
  /**
   * Team member appointments are assigned to (crm_config.assignedUserId).
   * Required by GHL for round-robin calendars ("assignedUserId is missing").
   */
  assignedUserId?: string;
  /** Maps internal custom-field names → GHL custom-field keys/ids. */
  customFieldMapping?: Record<string, string>;
  baseUrl?: string;
}

export interface GhlPipeline {
  id: string;
  name: string;
  stages: Array<{ id: string; name: string }>;
}

export interface GhlCalendar {
  id: string;
  name: string;
}

class GoHighLevelAdapter extends BaseCrmAdapter {
  readonly name = 'gohighlevel';
  private readonly cfg: GhlConfig;

  constructor(config: Record<string, unknown>) {
    super(config);
    this.cfg = config as unknown as GhlConfig;
    this.http.defaults.baseURL = this.cfg.baseUrl ?? DEFAULT_BASE_URL;
    this.http.defaults.headers.common['Authorization'] = `Bearer ${this.cfg.accessToken}`;
    this.http.defaults.headers.common['Version'] = API_VERSION;
    this.http.defaults.headers.common['Content-Type'] = 'application/json';
  }

  async createOrUpdateContact(contact: CrmContact): Promise<CrmSyncResult> {
    try {
      const { data } = await this.http.post('/contacts/upsert', {
        locationId: this.cfg.locationId,
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: contact.email,
        phone: contact.phone,
        tags: contact.tags ?? [],
        ...this.mapCustomFields(contact.customFields),
      });
      return this.success(data.contact?.id);
    } catch (err) {
      return this.failure(err);
    }
  }

  async createLead(lead: CrmLead): Promise<CrmSyncResult> {
    const pipelineId = lead.pipelineId ?? this.cfg.pipelineId;
    if (!pipelineId) {
      return this.failure(
        new Error('No GoHighLevel pipeline configured — pick one in CRM settings (pipelines must be created in the GHL sub-account UI first)')
      );
    }
    const stageId = lead.stageId ?? this.cfg.stageId;
    try {
      const { data } = await this.http.post('/opportunities/', {
        locationId: this.cfg.locationId,
        pipelineId,
        ...(stageId ? { pipelineStageId: stageId } : {}),
        contactId: lead.contactId,
        name: lead.title,
        status: 'open',
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
      const { data } = await this.http.post(`/contacts/${note.contactId}/notes`, {
        body: note.body,
      });
      return this.success(data.note?.id ?? data.id);
    } catch (err) {
      return this.failure(err);
    }
  }

  async createTask(task: CrmTask): Promise<CrmSyncResult> {
    try {
      const { data } = await this.http.post(`/contacts/${task.contactId}/tasks`, {
        title: task.title,
        dueDate: task.dueDate.toISOString(),
        completed: false,
        ...(task.assigneeId ? { assignedTo: task.assigneeId } : {}),
      });
      return this.success(data.task?.id ?? data.id);
    } catch (err) {
      return this.failure(err);
    }
  }

  async createAppointment(appointment: CrmAppointment): Promise<CrmSyncResult> {
    if (!this.cfg.calendarId) {
      return this.failure(
        new Error('No GoHighLevel calendar configured — pick one in CRM settings so booked appointments sync')
      );
    }
    try {
      const { data } = await this.http.post(
        '/calendars/events/appointments',
        {
          calendarId: this.cfg.calendarId,
          locationId: this.cfg.locationId,
          contactId: appointment.contactId,
          title: appointment.title,
          startTime: appointment.startTime.toISOString(),
          endTime: appointment.endTime.toISOString(),
          appointmentStatus: 'confirmed',
          ...(this.cfg.assignedUserId ? { assignedUserId: this.cfg.assignedUserId } : {}),
          // Availability was already checked against the booking source of
          // truth; don't let GHL slot rules reject the write-back.
          ignoreFreeSlotValidation: true,
        },
        { headers: { Version: CALENDARS_API_VERSION } }
      );
      const appointmentId = data.id ?? data.event?.id ?? data.appointment?.id;
      // The v2 appointment payload has no notes field; preserve notes on the
      // contact instead. Best-effort — the appointment itself already synced.
      if (appointment.notes) {
        await this.createNote({
          contactId: appointment.contactId,
          body: `Appointment note (${appointment.title}): ${appointment.notes}`,
          createdAt: new Date(),
        });
      }
      return this.success(appointmentId);
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
      await this.http.get(`/locations/${this.cfg.locationId}`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Lists the sub-account's pipelines so the dashboard can offer a picker.
   * Pipeline creation/updates live in the provisioning client
   * (ghl-provisioning-client.ts), which needs the pipelines.* OAuth scopes.
   */
  // ── Calendar booking (GHL calendar is the booking source of truth) ────────

  /**
   * Free slots from the configured GHL calendar. GHL's free-slots endpoint
   * answers { "<YYYY-MM-DD>": { slots: [ISO...] }, traceId } — flatten every
   * day's slots into canonical { start } entries.
   */
  async getAvailability(req: CrmAvailabilityRequest): Promise<CrmAvailabilitySlot[]> {
    if (!this.cfg.calendarId) return [];
    const { data } = await this.http.get(`/calendars/${this.cfg.calendarId}/free-slots`, {
      params: {
        startDate: new Date(req.startDate).getTime(),
        endDate: new Date(req.endDate).getTime(),
        timezone: req.timezone,
      },
      headers: { Version: CALENDARS_API_VERSION },
    });
    const slots: CrmAvailabilitySlot[] = [];
    for (const [key, value] of Object.entries(data ?? {})) {
      if (key === 'traceId') continue;
      const daySlots = (value as { slots?: string[] })?.slots ?? [];
      for (const start of daySlots) slots.push({ start });
    }
    return slots.sort((a, b) => a.start.localeCompare(b.start));
  }

  /** Booking create — same write path as createAppointment (calendar-aware). */
  async createBooking(appointment: CrmAppointment): Promise<CrmSyncResult> {
    return this.createAppointment(appointment);
  }

  async updateBooking(externalEventId: string, update: CrmBookingUpdate): Promise<CrmSyncResult> {
    try {
      await this.http.put(
        `/calendars/events/appointments/${externalEventId}`,
        {
          ...(update.startTime ? { startTime: update.startTime.toISOString() } : {}),
          ...(update.endTime ? { endTime: update.endTime.toISOString() } : {}),
          ...(update.title ? { title: update.title } : {}),
          // Round-robin calendars require an explicit assignee on update: GHL
          // only auto-assigns when the target is a recognized open slot, so a
          // reschedule to an arbitrary time 422s ("assignedUserId is missing")
          // without this (verified live). Mirrors createAppointment.
          ...(this.cfg.assignedUserId ? { assignedUserId: this.cfg.assignedUserId } : {}),
          // A reschedule targets a time the booking source of truth already
          // vetted; without this, GHL's own slot rules reject moving an
          // appointment to any time it doesn't consider an open slot. Mirrors
          // createAppointment.
          ignoreFreeSlotValidation: true,
        },
        { headers: { Version: CALENDARS_API_VERSION } }
      );
      return this.success(externalEventId);
    } catch (err) {
      return this.failure(err);
    }
  }

  async cancelBooking(externalEventId: string): Promise<CrmSyncResult> {
    try {
      await this.http.delete(`/calendars/events/${externalEventId}`, {
        headers: { Version: CALENDARS_API_VERSION },
      });
      return this.success(externalEventId);
    } catch (err) {
      return this.failure(err);
    }
  }

  async listPipelines(): Promise<GhlPipeline[]> {
    const { data } = await this.http.get('/opportunities/pipelines', {
      params: { locationId: this.cfg.locationId },
    });
    const pipelines = (data.pipelines ?? []) as Array<{
      id: string; name: string; stages?: Array<{ id: string; name: string }>;
    }>;
    return pipelines.map((p) => ({
      id: p.id,
      name: p.name,
      stages: (p.stages ?? []).map((s) => ({ id: s.id, name: s.name })),
    }));
  }

  async listCalendars(): Promise<GhlCalendar[]> {
    const { data } = await this.http.get('/calendars/', {
      params: { locationId: this.cfg.locationId },
      headers: { Version: CALENDARS_API_VERSION },
    });
    const calendars = (data.calendars ?? []) as Array<{ id: string; name: string }>;
    return calendars.map((c) => ({ id: c.id, name: c.name }));
  }

  /**
   * GHL v2 wants custom fields as [{ key, field_value }]. Internal names go
   * through customFieldMapping when configured; unmapped names pass through
   * as-is (valid when they already are GHL field keys).
   */
  private mapCustomFields(customFields?: Record<string, unknown>): Record<string, unknown> {
    if (!customFields || Object.keys(customFields).length === 0) return {};
    const mapping = this.cfg.customFieldMapping ?? {};
    return {
      customFields: Object.entries(customFields).map(([name, value]) => ({
        key: mapping[name] ?? name,
        field_value: value,
      })),
    };
  }
}

export const goHighLevelPlugin: Plugin<ICrmAdapter> = {
  manifest: {
    name: 'gohighlevel',
    version: '2.0.0',
    description: 'GoHighLevel CRM adapter (v2 API, OAuth)',
    author: 'Gravvia',
  },
  factory: (config) => new GoHighLevelAdapter(config),
};
