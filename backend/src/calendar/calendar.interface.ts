import type { CalendarEvent, CalendarSyncResult, TimeSlot } from '../types/index.js';

export interface ICalendarAdapter {
  readonly name: string;

  createEvent(event: CalendarEvent): Promise<CalendarSyncResult>;
  updateEvent(externalEventId: string, event: Partial<CalendarEvent>): Promise<CalendarSyncResult>;
  deleteEvent(externalEventId: string): Promise<CalendarSyncResult>;
  getAvailableSlots(
    startDate: Date,
    endDate: Date,
    durationMinutes: number,
    timezone: string
  ): Promise<TimeSlot[]>;
  checkConflict(startTime: Date, endTime: Date): Promise<boolean>;

  testConnection(): Promise<boolean>;
}
