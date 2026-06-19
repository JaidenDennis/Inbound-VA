import { PluginRegistry } from '../plugins/index.js';
import type { ICalendarAdapter } from './calendar.interface.js';
import { googleCalendarPlugin } from './adapters/google-calendar.adapter.js';
import { outlookCalendarPlugin } from './adapters/outlook.adapter.js';
import { calendlyPlugin } from './adapters/calendly.adapter.js';

export const calendarRegistry = new PluginRegistry<ICalendarAdapter>('calendar');

calendarRegistry.register(googleCalendarPlugin);
calendarRegistry.register(outlookCalendarPlugin);
calendarRegistry.register(calendlyPlugin);

export function getCalendarAdapter(
  provider: string,
  config: Record<string, unknown>
): ICalendarAdapter {
  return calendarRegistry.resolve(provider, config);
}
