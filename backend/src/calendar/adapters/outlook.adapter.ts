import { BaseCalendarAdapter } from './base.calendar.adapter.js';
import type { CalendarEvent, CalendarSyncResult, TimeSlot } from '../../types/index.js';
import type { Plugin } from '../../plugins/index.js';
import type { ICalendarAdapter } from '../calendar.interface.js';

interface OutlookConfig {
  accessToken: string;
  userId?: string;
}

class OutlookCalendarAdapter extends BaseCalendarAdapter {
  readonly name = 'outlook';
  private readonly userId: string;

  constructor(config: Record<string, unknown>) {
    super(config);
    const cfg = config as unknown as OutlookConfig;
    this.userId = cfg.userId ?? 'me';
    this.http.defaults.baseURL = 'https://graph.microsoft.com/v1.0';
    this.http.defaults.headers.common['Authorization'] = `Bearer ${cfg.accessToken}`;
    this.http.defaults.headers.common['Content-Type'] = 'application/json';
  }

  async createEvent(event: CalendarEvent): Promise<CalendarSyncResult> {
    try {
      const { data } = await this.http.post(`/users/${this.userId}/events`, {
        subject: event.title,
        body: { contentType: 'text', content: event.description ?? '' },
        start: { dateTime: event.startTime.toISOString(), timeZone: event.timezone },
        end: { dateTime: event.endTime.toISOString(), timeZone: event.timezone },
        location: event.location ? { displayName: event.location } : undefined,
        attendees: event.attendees?.map((email) => ({
          emailAddress: { address: email },
          type: 'required',
        })),
      });
      return { success: true, externalEventId: data.id };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async updateEvent(externalEventId: string, event: Partial<CalendarEvent>): Promise<CalendarSyncResult> {
    try {
      const patch: Record<string, unknown> = {};
      if (event.title) patch['subject'] = event.title;
      if (event.startTime && event.timezone) patch['start'] = { dateTime: event.startTime.toISOString(), timeZone: event.timezone };
      if (event.endTime && event.timezone) patch['end'] = { dateTime: event.endTime.toISOString(), timeZone: event.timezone };

      await this.http.patch(`/users/${this.userId}/events/${externalEventId}`, patch);
      return { success: true, externalEventId };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async deleteEvent(externalEventId: string): Promise<CalendarSyncResult> {
    try {
      await this.http.delete(`/users/${this.userId}/events/${externalEventId}`);
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async getAvailableSlots(startDate: Date, endDate: Date, durationMinutes: number, timezone: string): Promise<TimeSlot[]> {
    try {
      const { data } = await this.http.post(`/users/${this.userId}/calendar/getSchedule`, {
        schedules: [this.userId],
        startTime: { dateTime: startDate.toISOString(), timeZone: timezone },
        endTime: { dateTime: endDate.toISOString(), timeZone: timezone },
        availabilityViewInterval: durationMinutes,
      });

      const availabilityView: string = data.value?.[0]?.availabilityView ?? '';
      const slots: TimeSlot[] = [];
      let cursor = new Date(startDate);

      for (const char of availabilityView) {
        const slotEnd = new Date(cursor.getTime() + durationMinutes * 60 * 1000);
        slots.push({ start: new Date(cursor), end: slotEnd, available: char === '0' });
        cursor = slotEnd;
      }
      return slots;
    } catch {
      return [];
    }
  }

  async checkConflict(startTime: Date, endTime: Date): Promise<boolean> {
    try {
      const { data } = await this.http.get(`/users/${this.userId}/calendarView`, {
        params: {
          startDateTime: startTime.toISOString(),
          endDateTime: endTime.toISOString(),
          $top: 1,
        },
      });
      return (data.value?.length ?? 0) > 0;
    } catch {
      return false;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.http.get(`/users/${this.userId}/calendar`);
      return true;
    } catch {
      return false;
    }
  }
}

export const outlookCalendarPlugin: Plugin<ICalendarAdapter> = {
  manifest: {
    name: 'outlook',
    version: '1.0.0',
    description: 'Microsoft Outlook / Graph Calendar adapter',
    author: 'Gravvia',
  },
  factory: (config) => new OutlookCalendarAdapter(config),
};
