import { BaseCalendarAdapter } from './base.calendar.adapter.js';
import type { CalendarEvent, CalendarSyncResult, TimeSlot } from '../../types/index.js';
import type { Plugin } from '../../plugins/index.js';
import type { ICalendarAdapter } from '../calendar.interface.js';

interface CalendlyConfig {
  accessToken: string;
  userUri?: string;
  eventTypeUri?: string;
}

class CalendlyAdapter extends BaseCalendarAdapter {
  readonly name = 'calendly';

  constructor(config: Record<string, unknown>) {
    super(config);
    const cfg = config as unknown as CalendlyConfig;
    this.http.defaults.baseURL = 'https://api.calendly.com';
    this.http.defaults.headers.common['Authorization'] = `Bearer ${cfg.accessToken}`;
    this.http.defaults.headers.common['Content-Type'] = 'application/json';
  }

  async createEvent(event: CalendarEvent): Promise<CalendarSyncResult> {
    // Calendly creates events via scheduling links; one-off events go via single-use links.
    // For direct booking, use invitee creation on an event type.
    try {
      const cfg = this.config as unknown as CalendlyConfig;
      if (!cfg.eventTypeUri || !event.attendees?.[0]) {
        return { success: false, error: 'eventTypeUri and attendee email required for Calendly' };
      }

      const { data } = await this.http.post('/one_off_event_types', {
        name: event.title,
        description: event.description,
        host: cfg.userUri,
        duration: Math.round((event.endTime.getTime() - event.startTime.getTime()) / 60000),
        timezone: event.timezone,
        date_setting: {
          type: 'date_range',
          start_date: event.startTime.toISOString().split('T')[0],
          end_date: event.endTime.toISOString().split('T')[0],
        },
      });
      return { success: true, externalEventId: data.resource?.uri };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async updateEvent(_externalEventId: string, _event: Partial<CalendarEvent>): Promise<CalendarSyncResult> {
    // Calendly does not support direct event mutation via API — cancel + recreate
    return { success: false, error: 'Calendly does not support direct event updates. Cancel and recreate.' };
  }

  async deleteEvent(externalEventId: string): Promise<CalendarSyncResult> {
    try {
      await this.http.post(`${externalEventId}/cancellation`, {
        reason: 'Cancelled via Gravvia',
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async getAvailableSlots(startDate: Date, endDate: Date, _durationMinutes: number, timezone: string): Promise<TimeSlot[]> {
    try {
      const cfg = this.config as unknown as CalendlyConfig;
      const { data } = await this.http.get('/event_type_available_times', {
        params: {
          event_type: cfg.eventTypeUri,
          start_time: startDate.toISOString(),
          end_time: endDate.toISOString(),
          timezone,
        },
      });

      return (data.collection ?? []).map((slot: { start_time: string; invitees_remaining: number }) => ({
        start: new Date(slot.start_time),
        end: new Date(new Date(slot.start_time).getTime() + _durationMinutes * 60000),
        available: slot.invitees_remaining > 0,
      }));
    } catch {
      return [];
    }
  }

  async checkConflict(startTime: Date, endTime: Date): Promise<boolean> {
    const slots = await this.getAvailableSlots(startTime, endTime, 30, 'UTC');
    return !slots.some((s) => s.available);
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.http.get('/users/me');
      return true;
    } catch {
      return false;
    }
  }
}

export const calendlyPlugin: Plugin<ICalendarAdapter> = {
  manifest: {
    name: 'calendly',
    version: '1.0.0',
    description: 'Calendly scheduling adapter',
    author: 'Gravvia',
  },
  factory: (config) => new CalendlyAdapter(config),
};
