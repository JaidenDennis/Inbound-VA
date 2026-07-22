import type {
  CrmContact,
  CrmLead,
  CrmNote,
  CrmTask,
  CrmAppointment,
  CrmSyncResult,
  CrmAvailabilityRequest,
  CrmAvailabilitySlot,
  CrmBookingUpdate,
} from '../../types/index.js';
import type { Plugin } from '../../plugins/index.js';
import type { ICrmAdapter } from '../crm.interface.js';

// No-op CRM adapter: stubs EVERY interface method (including the optional
// calendar-booking capability) with successful no-ops. Used for clients with
// no CRM, and in tests as the canonical "does nothing, breaks nothing"
// implementation every new interface method must be added to.

const ok = (metadata?: Record<string, unknown>): CrmSyncResult => ({
  success: true,
  metadata: { noop: true, ...metadata },
});

class NoopCrmAdapter implements ICrmAdapter {
  readonly name = 'noop';

  constructor(_config: Record<string, unknown>) {}

  async createOrUpdateContact(_contact: CrmContact): Promise<CrmSyncResult> {
    return ok();
  }
  async createLead(_lead: CrmLead): Promise<CrmSyncResult> {
    return ok();
  }
  async createNote(_note: CrmNote): Promise<CrmSyncResult> {
    return ok();
  }
  async createTask(_task: CrmTask): Promise<CrmSyncResult> {
    return ok();
  }
  async createAppointment(_appointment: CrmAppointment): Promise<CrmSyncResult> {
    return ok();
  }
  async updateConversation(_contactId: string, _data: Record<string, unknown>): Promise<CrmSyncResult> {
    return ok();
  }
  async pushTranscript(_contactId: string, _transcript: string, _callId: string): Promise<CrmSyncResult> {
    return ok();
  }
  async pushCallSummary(_contactId: string, _summary: string, _callId: string): Promise<CrmSyncResult> {
    return ok();
  }

  async getAvailability(_req: CrmAvailabilityRequest): Promise<CrmAvailabilitySlot[]> {
    return [];
  }
  async createBooking(appointment: CrmAppointment): Promise<CrmSyncResult> {
    return this.createAppointment(appointment);
  }
  async updateBooking(_externalEventId: string, _update: CrmBookingUpdate): Promise<CrmSyncResult> {
    return ok();
  }
  async cancelBooking(_externalEventId: string): Promise<CrmSyncResult> {
    return ok();
  }

  async testConnection(): Promise<boolean> {
    return true;
  }
}

export const noopPlugin: Plugin<ICrmAdapter> = {
  manifest: {
    name: 'noop',
    version: '1.0.0',
    description: 'No-op CRM adapter (clients without a CRM; test stub)',
    author: 'Gravvia',
  },
  factory: (config) => new NoopCrmAdapter(config),
};
