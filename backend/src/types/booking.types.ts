export type AppointmentStatus =
  | 'pending'
  | 'confirmed'
  | 'cancelled'
  | 'rescheduled'
  | 'completed'
  | 'no_show';

export interface Appointment {
  id: string;
  client_id: string;
  contact_id: string;
  call_id: string | null;
  external_calendar_id: string | null;
  title: string;
  description: string | null;
  start_time: string;
  end_time: string;
  timezone: string;
  status: AppointmentStatus;
  service_type: string | null;
  staff_member_id: string | null;
  notes: string | null;
  reminder_sent: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface TimeSlot {
  start: Date;
  end: Date;
  available: boolean;
}

export interface AvailabilityRequest {
  clientId: string;
  date: string;
  serviceType?: string;
  timezone?: string;
}

export interface BookingRequest {
  clientId: string;
  contactId: string;
  callId?: string;
  title: string;
  startTime: Date;
  endTime: Date;
  timezone: string;
  serviceType?: string;
  notes?: string;
}

export interface RescheduleRequest {
  appointmentId: string;
  newStartTime: Date;
  newEndTime: Date;
  reason?: string;
}

export type CalendarProvider = 'google' | 'outlook' | 'calendly' | 'internal';

export interface CalendarEvent {
  id?: string;
  title: string;
  description?: string;
  startTime: Date;
  endTime: Date;
  timezone: string;
  attendees?: string[];
  location?: string;
}

export interface CalendarSyncResult {
  success: boolean;
  externalEventId?: string;
  error?: string;
}
