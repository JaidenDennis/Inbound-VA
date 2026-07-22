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

  // ── Calendar booking (optional capability; canonical types only) ──────────
  // Adapters whose CRM owns the calendar (GoHighLevel) implement these; the
  // booking service consults them as the availability/booking source of truth
  // and falls back to the internal rules engine when absent. The noop adapter
  // stubs every method.
  getAvailability?(req: CrmAvailabilityRequest): Promise<CrmAvailabilitySlot[]>;
  createBooking?(appointment: CrmAppointment): Promise<CrmSyncResult>;
  updateBooking?(externalEventId: string, update: CrmBookingUpdate): Promise<CrmSyncResult>;
  cancelBooking?(externalEventId: string): Promise<CrmSyncResult>;

  testConnection(): Promise<boolean>;
}
