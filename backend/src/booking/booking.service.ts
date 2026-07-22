import { v4 as uuidv4 } from 'uuid';
import { formatInTimeZone, toZonedTime } from 'date-fns-tz';
import { addMinutes } from 'date-fns';
import { supabase } from '../db/index.js';
import { logger } from '../utils/index.js';
import { getCalendarAdapter } from '../calendar/index.js';
import { getCrmAdapter, resolveAdapterConfig, type ICrmAdapter } from '../crm/index.js';
import { eventBus } from '../events/index.js';
import { crmSyncQueue } from '../queues/index.js';
import { buildIdempotencyKey } from '../utils/index.js';
import type {
  Appointment, BookingRequest, RescheduleRequest,
  TimeSlot, AvailabilityRequest, CrmConnection,
} from '../types/index.js';
import type { ClientSettings } from '../types/index.js';

export class BookingService {
  async createAppointment(req: BookingRequest): Promise<Appointment> {
    // Conflict detection
    const conflict = await this.hasConflict(req.clientId, req.startTime, req.endTime);
    if (conflict) {
      throw new Error('Time slot is not available');
    }

    const appointment: Partial<Appointment> = {
      id: uuidv4(),
      client_id: req.clientId,
      contact_id: req.contactId,
      call_id: req.callId ?? null,
      title: req.title,
      start_time: req.startTime.toISOString(),
      end_time: req.endTime.toISOString(),
      timezone: req.timezone,
      status: 'pending',
      service_type: req.serviceType ?? null,
      notes: req.notes ?? null,
      reminder_sent: false,
      metadata: {},
    };

    const { data, error } = await supabase
      .from('appointments')
      .insert(appointment)
      .select()
      .single();

    if (error) throw new Error(`Failed to create appointment: ${error.message}`);

    // Push to the client's external calendar (best-effort) and store the event id
    // so future reschedule/cancel can sync. Then enqueue CRM appointment sync.
    await this.syncCreateToCalendar(data as Appointment);
    await this.enqueueCrmAppointmentSync(data as Appointment);

    await eventBus.publish({
      type: 'booking.requested',
      clientId: req.clientId,
      contactId: req.contactId,
      appointmentId: data.id,
      callId: req.callId,
      payload: { appointment: data },
      source: 'internal',
      idempotencyKey: buildIdempotencyKey('booking.requested', data.id),
    });

    logger.info({ appointmentId: data.id, clientId: req.clientId }, 'Appointment created');
    return data as Appointment;
  }

  private async syncCreateToCalendar(appointment: Appointment): Promise<void> {
    try {
      const calendarConfig = await this.getCalendarConfig(appointment.client_id);
      if (!calendarConfig) return;
      const adapter = getCalendarAdapter(calendarConfig.provider, calendarConfig.config);
      const res = await adapter.createEvent({
        title: appointment.title,
        description: appointment.notes ?? undefined,
        startTime: new Date(appointment.start_time),
        endTime: new Date(appointment.end_time),
        timezone: appointment.timezone,
      });
      if (res.success && res.externalEventId) {
        await supabase
          .from('appointments')
          .update({ external_calendar_id: res.externalEventId })
          .eq('id', appointment.id);
      }
    } catch (err) {
      logger.warn({ err, appointmentId: appointment.id }, 'Calendar create sync failed');
    }
  }

  private async enqueueCrmAppointmentSync(appointment: Appointment): Promise<void> {
    try {
      const { data: conn } = await supabase
        .from('crm_connections')
        .select('id')
        .eq('client_id', appointment.client_id)
        .eq('is_active', true)
        .maybeSingle();
      if (!conn) return;

      await crmSyncQueue.add(
        'appointment-sync',
        {
          clientId: appointment.client_id,
          crmConnectionId: conn.id,
          entityType: 'appointment',
          entityId: appointment.id,
          operation: 'create',
          payload: {
            contactId: appointment.contact_id,
            title: appointment.title,
            startTime: appointment.start_time,
            endTime: appointment.end_time,
            notes: appointment.notes ?? undefined,
          },
          idempotencyKey: buildIdempotencyKey('appointment', appointment.id),
        },
        { jobId: buildIdempotencyKey('crm-appointment', appointment.id) }
      );
    } catch (err) {
      logger.warn({ err, appointmentId: appointment.id }, 'CRM appointment enqueue failed');
    }
  }

  async confirmAppointment(appointmentId: string): Promise<Appointment> {
    const { data, error } = await supabase
      .from('appointments')
      .update({ status: 'confirmed' })
      .eq('id', appointmentId)
      .select()
      .single();

    if (error) throw new Error(`Failed to confirm appointment: ${error.message}`);

    await eventBus.publish({
      type: 'booking.confirmed',
      clientId: data.client_id,
      contactId: data.contact_id,
      appointmentId: data.id,
      payload: { appointment: data },
      source: 'internal',
      idempotencyKey: buildIdempotencyKey('booking.confirmed', data.id),
    });

    return data as Appointment;
  }

  async cancelAppointment(appointmentId: string, reason?: string): Promise<Appointment> {
    const { data, error } = await supabase
      .from('appointments')
      .update({ status: 'cancelled', notes: reason })
      .eq('id', appointmentId)
      .select()
      .single();

    if (error) throw new Error(`Failed to cancel appointment: ${error.message}`);

    if (data.external_calendar_id) {
      await this.syncCancelToCalendar(data);
    }
    await this.syncCrmBookingChange(data as Appointment, 'cancel');

    await eventBus.publish({
      type: 'booking.cancelled',
      clientId: data.client_id,
      contactId: data.contact_id,
      appointmentId: data.id,
      payload: { appointment: data, reason },
      source: 'internal',
      idempotencyKey: buildIdempotencyKey('booking.cancelled', data.id, Date.now()),
    });

    return data as Appointment;
  }

  async rescheduleAppointment(req: RescheduleRequest): Promise<Appointment> {
    const conflict = await this.hasConflict(
      await this.getClientIdForAppointment(req.appointmentId),
      req.newStartTime,
      req.newEndTime,
      req.appointmentId
    );
    if (conflict) throw new Error('New time slot is not available');

    const { data, error } = await supabase
      .from('appointments')
      .update({
        start_time: req.newStartTime.toISOString(),
        end_time: req.newEndTime.toISOString(),
        status: 'rescheduled',
        notes: req.reason,
      })
      .eq('id', req.appointmentId)
      .select()
      .single();

    if (error) throw new Error(`Failed to reschedule: ${error.message}`);

    if (data.external_calendar_id) {
      await this.syncRescheduleToCalendar(data);
    }
    await this.syncCrmBookingChange(data as Appointment, 'reschedule');

    await eventBus.publish({
      type: 'booking.rescheduled',
      clientId: data.client_id,
      contactId: data.contact_id,
      appointmentId: data.id,
      payload: { appointment: data },
      source: 'internal',
      idempotencyKey: buildIdempotencyKey('booking.rescheduled', data.id, req.newStartTime.getTime()),
    });

    return data as Appointment;
  }

  /**
   * The client's CRM-calendar adapter when it is the booking source of truth
   * (active connection + calendar capability + configured calendar). Null ⇒
   * fall back to the internal rules engine.
   */
  private async crmCalendar(
    clientId: string
  ): Promise<{ adapter: ICrmAdapter; config: Record<string, unknown> } | null> {
    try {
      const { data: conn } = await supabase
        .from('crm_connections')
        .select('*')
        .eq('client_id', clientId)
        .eq('is_active', true)
        .maybeSingle();
      if (!conn) return null;
      const config = await resolveAdapterConfig(conn as CrmConnection);
      const adapter = getCrmAdapter((conn as CrmConnection).crm_type, config);
      if (!adapter.getAvailability || !config.calendarId) return null;
      return { adapter, config };
    } catch (err) {
      logger.warn({ err, clientId }, 'CRM calendar resolution failed; using internal availability');
      return null;
    }
  }

  async getAvailability(req: AvailabilityRequest): Promise<TimeSlot[]> {
    // CRM calendar (e.g. GoHighLevel) is the availability truth when
    // configured; its answer stands even when empty. Errors fall back to the
    // internal rules engine so a CRM outage never strands a caller.
    const crm = await this.crmCalendar(req.clientId);
    if (crm) {
      try {
        const timezone = req.timezone ?? 'UTC';
        const dayStart = new Date(`${req.date}T00:00:00.000Z`);
        const dayEnd = new Date(`${req.date}T23:59:59.999Z`);
        const slots = await crm.adapter.getAvailability!({
          startDate: dayStart.toISOString(),
          endDate: dayEnd.toISOString(),
          timezone,
        });
        return slots.map((s) => ({
          start: new Date(s.start),
          end: s.end ? new Date(s.end) : new Date(new Date(s.start).getTime() + 30 * 60_000),
          available: true,
        }));
      } catch (err) {
        logger.warn({ err, clientId: req.clientId }, 'CRM availability failed; using internal rules');
      }
    }
    return this.internalAvailability(req);
  }

  private async internalAvailability(req: AvailabilityRequest): Promise<TimeSlot[]> {
    const { data: settings } = await supabase
      .from('client_settings')
      .select('booking_rules')
      .eq('client_id', req.clientId)
      .single();

    if (!settings) return [];

    const rules = settings.booking_rules as ClientSettings['booking_rules'];
    const timezone = req.timezone ?? 'UTC';
    const date = new Date(req.date);

    const dayName = formatInTimeZone(date, timezone, 'EEEE').toLowerCase() as keyof typeof rules.working_hours;
    const hours = rules.working_hours?.[dayName];

    if (!hours) return [];

    const [openH, openM] = hours.open.split(':').map(Number);
    const [closeH, closeM] = hours.close.split(':').map(Number);

    const dayStart = toZonedTime(date, timezone);
    dayStart.setHours(openH, openM, 0, 0);
    const dayEnd = toZonedTime(date, timezone);
    dayEnd.setHours(closeH, closeM, 0, 0);

    const slotDuration = 30; // default 30-min slots
    const slots: TimeSlot[] = [];
    let cursor = new Date(dayStart);

    while (cursor < dayEnd) {
      const slotEnd = addMinutes(cursor, slotDuration);
      if (slotEnd > dayEnd) break;

      const busy = await this.hasConflict(req.clientId, cursor, slotEnd);
      slots.push({ start: new Date(cursor), end: slotEnd, available: !busy });
      cursor = slotEnd;
    }

    return slots;
  }

  private async hasConflict(
    clientId: string,
    start: Date,
    end: Date,
    excludeId?: string
  ): Promise<boolean> {
    let query = supabase
      .from('appointments')
      .select('id')
      .eq('client_id', clientId)
      .not('status', 'in', '("cancelled","no_show")')
      .lt('start_time', end.toISOString())
      .gt('end_time', start.toISOString());

    if (excludeId) {
      query = query.neq('id', excludeId);
    }

    const { data } = await query;
    return (data?.length ?? 0) > 0;
  }

  private async getClientIdForAppointment(appointmentId: string): Promise<string> {
    const { data } = await supabase
      .from('appointments')
      .select('client_id')
      .eq('id', appointmentId)
      .single();
    return data?.client_id ?? '';
  }

  private async syncCancelToCalendar(appointment: Appointment): Promise<void> {
    try {
      const calendarConfig = await this.getCalendarConfig(appointment.client_id);
      if (!calendarConfig) return;
      const adapter = getCalendarAdapter(calendarConfig.provider, calendarConfig.config);
      await adapter.deleteEvent(appointment.external_calendar_id!);
    } catch (err) {
      logger.warn({ err, appointmentId: appointment.id }, 'Calendar cancel sync failed');
    }
  }

  private async syncRescheduleToCalendar(appointment: Appointment): Promise<void> {
    try {
      const calendarConfig = await this.getCalendarConfig(appointment.client_id);
      if (!calendarConfig) return;
      const adapter = getCalendarAdapter(calendarConfig.provider, calendarConfig.config);
      await adapter.updateEvent(appointment.external_calendar_id!, {
        startTime: new Date(appointment.start_time),
        endTime: new Date(appointment.end_time),
        timezone: appointment.timezone,
      });
    } catch (err) {
      logger.warn({ err, appointmentId: appointment.id }, 'Calendar reschedule sync failed');
    }
  }

  private async getCalendarConfig(
    clientId: string
  ): Promise<{ provider: string; config: Record<string, unknown> } | null> {
    const { data } = await supabase
      .from('client_settings')
      .select('crm_config')
      .eq('client_id', clientId)
      .single();
    const cfg = data?.crm_config as Record<string, unknown> | undefined;
    if (!cfg?.calendar_provider) return null;
    return { provider: cfg.calendar_provider as string, config: cfg.calendar_config as Record<string, unknown> };
  }

  /**
   * Push a reschedule/cancel to the CRM calendar (best-effort). The CRM's
   * event id is mirrored into appointments.metadata.crm_event_id by the
   * crm-sync worker when the original booking synced.
   */
  private async syncCrmBookingChange(
    appointment: Appointment,
    kind: 'reschedule' | 'cancel'
  ): Promise<void> {
    const eventId = appointment.metadata?.crm_event_id as string | undefined;
    if (!eventId) return;
    try {
      const crm = await this.crmCalendar(appointment.client_id);
      if (!crm) return;
      if (kind === 'cancel' && crm.adapter.cancelBooking) {
        await crm.adapter.cancelBooking(eventId);
      } else if (kind === 'reschedule' && crm.adapter.updateBooking) {
        await crm.adapter.updateBooking(eventId, {
          startTime: new Date(appointment.start_time),
          endTime: new Date(appointment.end_time),
        });
      }
    } catch (err) {
      logger.warn({ err, appointmentId: appointment.id, kind }, 'CRM booking change sync failed');
    }
  }

  /** Add a caller to the waitlist and audit it. */
  async addToWaitlist(input: {
    clientId: string;
    contactId: string;
    callId?: string | null;
    service?: string;
    preferredDays?: string[];
    preferredTimes?: string;
    notes?: string;
  }): Promise<{ id: string }> {
    const { data, error } = await supabase
      .from('waitlist_entries')
      .insert({
        client_id: input.clientId,
        contact_id: input.contactId,
        call_id: input.callId ?? null,
        service: input.service ?? null,
        preferred_days: input.preferredDays ?? [],
        preferred_times: input.preferredTimes ?? null,
        notes: input.notes ?? null,
        status: 'waiting',
      })
      .select('id')
      .single();
    if (error) throw new Error(`Failed to add waitlist entry: ${error.message}`);

    await eventBus.publish({
      type: 'waitlist.added',
      clientId: input.clientId,
      contactId: input.contactId,
      callId: input.callId ?? undefined,
      payload: { waitlist_entry_id: data.id, service: input.service, preferred_days: input.preferredDays },
      source: 'internal',
      idempotencyKey: buildIdempotencyKey('waitlist', data.id),
    });
    return { id: data.id };
  }

  async getAppointment(id: string): Promise<Appointment | null> {
    const { data } = await supabase.from('appointments').select('*').eq('id', id).single();
    return data as Appointment | null;
  }

  async listAppointments(clientId: string, status?: string): Promise<Appointment[]> {
    let query = supabase.from('appointments').select('*').eq('client_id', clientId).order('start_time');
    if (status) query = query.eq('status', status);
    const { data } = await query;
    return (data ?? []) as Appointment[];
  }
}

export const bookingService = new BookingService();
