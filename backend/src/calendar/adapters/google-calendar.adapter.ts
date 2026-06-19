import { BaseCalendarAdapter } from './base.calendar.adapter.js';
import type { CalendarEvent, CalendarSyncResult, TimeSlot } from '../../types/index.js';
import type { Plugin } from '../../plugins/index.js';
import type { ICalendarAdapter } from '../calendar.interface.js';

interface GoogleCalendarConfig {
  accessToken: string;
  calendarId?: string;
}

class GoogleCalendarAdapter extends BaseCalendarAdapter {
  readonly name = 'google';
  private readonly calendarId: string;

  constructor(config: Record<string, unknown>) {
    super(config);
    const cfg = config as unknown as GoogleCalendarConfig;
    this.calendarId = cfg.calendarId ?? 'primary';
    this.http.defaults.baseURL = 'https://www.googleapis.com/calendar/v3';
    this.http.defaults.headers.common['Authorization'] = `Bearer ${cfg.accessToken}`;
    this.http.defaults.headers.common['Content-Type'] = 'application/json';
  }

  async createEvent(event: CalendarEvent): Promise<CalendarSyncResult> {
    try {
      const { data } = await this.http.post(`/calendars/${this.calendarId}/events`, {
        summary: event.title,
        description: event.description,
        location: event.location,
        start: { dateTime: event.startTime.toISOString(), timeZone: event.timezone },
        end: { dateTime: event.endTime.toISOString(), timeZone: event.timezone },
        attendees: event.attendees?.map((email) => ({ email })),
      });
      return { success: true, externalEventId: data.id };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async updateEvent(externalEventId: string, event: Partial<CalendarEvent>): Promise<CalendarSyncResult> {
    try {
      const patch: Record<string, unknown> = {};
      if (event.title) patch['summary'] = event.title;
      if (event.description) patch['description'] = event.description;
      if (event.startTime && event.timezone) patch['start'] = { dateTime: event.startTime.toISOString(), timeZone: event.timezone };
      if (event.endTime && event.timezone) patch['end'] = { dateTime: event.endTime.toISOString(), timeZone: event.timezone };

      await this.http.patch(`/calendars/${this.calendarId}/events/${externalEventId}`, patch);
      return { success: true, externalEventId };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async deleteEvent(externalEventId: string): Promise<CalendarSyncResult> {
    try {
      await this.http.delete(`/calendars/${this.calendarId}/events/${externalEventId}`);
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async getAvailableSlots(startDate: Date, endDate: Date, durationMinutes: number, timezone: string): Promise<TimeSlot[]> {
    try {
      const { data } = await this.http.post('/freeBusy', {
        timeMin: startDate.toISOString(),
        timeMax: endDate.toISOString(),
        timeZone: timezone,
        items: [{ id: this.calendarId }],
      });

      const busySlots: Array<{ start: string; end: string }> =
        data.calendars?.[this.calendarId]?.busy ?? [];

      const slots: TimeSlot[] = [];
      let cursor = new Date(startDate);

      while (cursor < endDate) {
        const slotEnd = new Date(cursor.getTime() + durationMinutes * 60 * 1000);
        if (slotEnd > endDate) break;

        const conflict = busySlots.some(
          (b) => new Date(b.start) < slotEnd && new Date(b.end) > cursor
        );
        slots.push({ start: new Date(cursor), end: slotEnd, available: !conflict });

        cursor = slotEnd;
      }
      return slots;
    } catch {
      return [];
    }
  }

  async checkConflict(startTime: Date, endTime: Date): Promise<boolean> {
    try {
      const { data } = await this.http.post('/freeBusy', {
        timeMin: startTime.toISOString(),
        timeMax: endTime.toISOString(),
        items: [{ id: this.calendarId }],
      });
      return (data.calendars?.[this.calendarId]?.busy ?? []).length > 0;
    } catch {
      return false;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.http.get(`/calendars/${this.calendarId}`);
      return true;
    } catch {
      return false;
    }
  }
}

export const googleCalendarPlugin: Plugin<ICalendarAdapter> = {
  manifest: {
    name: 'google',
    version: '1.0.0',
    description: 'Google Calendar adapter',
    author: 'Gravvia',
  },
  factory: (config) => new GoogleCalendarAdapter(config),
};
