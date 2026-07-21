import { supabase } from '../db/index.js';
import { callService, clientService } from '../services/index.js';
import { notificationsQueue, crmSyncQueue } from '../queues/index.js';
import { buildIdempotencyKey } from '../utils/index.js';
import { logger } from '../utils/index.js';
import type { NormalizedEvent } from '../types/index.js';

// Follow-up timings (delayed BullMQ jobs; reuses the notifications queue).
const LEAD_RECOVERY_DELAY_MS = 60 * 60 * 1000; // 1 hour after the call
const MISSED_CALL_DELAY_MS = 15 * 60 * 1000; // 15 min after the call
const REMINDER_LEAD_MS = 24 * 60 * 60 * 1000; // fire 24h before the appointment

async function activeCrmConnectionId(clientId: string): Promise<string | null> {
  const { data } = await supabase
    .from('crm_connections')
    .select('id')
    .eq('client_id', clientId)
    .eq('is_active', true)
    .maybeSingle();
  return data?.id ?? null;
}

/** Sync the call outcome to the CRM as a note (contact id resolved in the worker). */
async function enqueueOutcomeNote(
  clientId: string,
  contactId: string | null,
  callId: string,
  body: string
): Promise<void> {
  const crmConnectionId = await activeCrmConnectionId(clientId);
  if (!crmConnectionId || !contactId) return;
  await crmSyncQueue.add(
    'outcome-note',
    {
      clientId,
      crmConnectionId,
      entityType: 'note',
      entityId: callId,
      operation: 'create',
      payload: { contactId, body, createdAt: new Date().toISOString() },
      idempotencyKey: buildIdempotencyKey('note', callId),
    },
    { jobId: buildIdempotencyKey('crm-note', callId) }
  );
}

/**
 * After a call is analyzed: record the outcome in the CRM and trigger revenue
 * follow-through (lead recovery for qualified-but-unbooked, callback for missed).
 */
export async function handleCallSummaryCompleted(event: NormalizedEvent): Promise<void> {
  try {
    const call = await callService.findByRetellId(event.callId ?? '');
    if (!call) return;

    const settings = await clientService.getSettings(event.clientId);
    const recipients = settings?.notification_emails ?? [];

    const { data: convo } = await supabase
      .from('conversations')
      .select('lead_captured, booking_requested, handoff_requested, contact_id')
      .eq('call_id', call.id)
      .maybeSingle();
    const { data: appts } = await supabase.from('appointments').select('id').eq('call_id', call.id).limit(1);

    const booked = (appts?.length ?? 0) > 0;
    const contactId = convo?.contact_id ?? call.contact_id ?? null;
    const summaryText = (event.payload?.summary as string) ?? '';

    const outcome = booked
      ? 'booked'
      : convo?.lead_captured
        ? 'qualified_no_booking'
        : convo?.handoff_requested
          ? 'handoff'
          : call.status === 'completed' && (call.duration_seconds ?? 0) > 15
            ? 'info_only'
            : 'missed';

    // 1. Full interaction → CRM: outcome note (contact/summary/transcript/appt
    //    sync already happen elsewhere; this adds the outcome).
    await enqueueOutcomeNote(event.clientId, contactId, call.id, `Voice call outcome: ${outcome}.\n\n${summaryText}`);

    // 2. Lead recovery: qualified but didn't book.
    if (outcome === 'qualified_no_booking' && recipients.length) {
      await notificationsQueue.add(
        'lead-recovery',
        {
          clientId: event.clientId,
          type: 'lead',
          recipients,
          subject: 'Lead to recover — qualified, no booking',
          body: `A qualified caller did not book. Please follow up.\n\nSummary:\n${summaryText}`,
          callId: call.id,
          metadata: { outcome },
        },
        { delay: LEAD_RECOVERY_DELAY_MS, jobId: buildIdempotencyKey('lead-recovery', call.id) }
      );
    }

    // 3. Missed/abandoned call: schedule a callback nudge.
    if (outcome === 'missed' && recipients.length) {
      await notificationsQueue.add(
        'missed-call',
        {
          clientId: event.clientId,
          type: 'escalation',
          recipients,
          subject: 'Missed/abandoned call — consider a callback',
          body: `An inbound call ended without resolution.\n\nSummary:\n${summaryText}`,
          callId: call.id,
          metadata: { outcome },
        },
        { delay: MISSED_CALL_DELAY_MS, jobId: buildIdempotencyKey('missed-call', call.id) }
      );
    }

    logger.info({ callId: call.id, outcome }, 'Post-call automation processed');
  } catch (err) {
    logger.error({ err, eventId: event.id }, 'Post-call automation failed');
  }
}

/**
 * Advance the CRM on a booking: move the contact's opportunity to the booked
 * stage, tag the contact, and create a staff follow-up task. Runs in the
 * crm-sync worker; no-op when the client has no active CRM connection.
 */
async function enqueueBookingCrmAutomation(
  clientId: string,
  contactId: string | undefined,
  appt: { id?: string; title?: string }
): Promise<void> {
  if (!contactId || !appt.id) return;
  const crmConnectionId = await activeCrmConnectionId(clientId);
  if (!crmConnectionId) return;
  await crmSyncQueue.add(
    'booking-automation',
    {
      clientId,
      crmConnectionId,
      entityType: 'booking-automation',
      entityId: appt.id,
      operation: 'update',
      payload: { contactId, title: appt.title ?? 'Appointment' },
      idempotencyKey: buildIdempotencyKey('booking-automation', appt.id),
    },
    { jobId: buildIdempotencyKey('crm-booking-automation', appt.id) }
  );
}

/**
 * On booking: advance the CRM (stage/tag/task), schedule a confirmation now and
 * a reminder before the appointment to reduce no-shows. Contact/calendar
 * write-back already happens in booking.service.
 */
export async function handleBookingRequested(event: NormalizedEvent): Promise<void> {
  try {
    const appt = (event.payload?.appointment ?? {}) as {
      id?: string;
      start_time?: string;
      title?: string;
    };
    if (!appt.id) return;

    // CRM-side booking reactions (independent of notification recipients).
    await enqueueBookingCrmAutomation(event.clientId, event.contactId, appt);

    const settings = await clientService.getSettings(event.clientId);
    const recipients = settings?.notification_emails ?? [];
    if (!recipients.length) return;

    await notificationsQueue.add(
      'appointment-confirmation',
      {
        clientId: event.clientId,
        type: 'booking',
        recipients,
        subject: `New booking — ${appt.title ?? 'Appointment'}`,
        body: `A new appointment was booked.\nWhen: ${appt.start_time}\nConfirm details with the client and set arrival/prep expectations to reduce no-shows.`,
        metadata: { appointmentId: appt.id },
      },
      { jobId: buildIdempotencyKey('appt-confirm', appt.id) }
    );

    if (appt.start_time) {
      const delay = new Date(appt.start_time).getTime() - REMINDER_LEAD_MS - Date.now();
      if (delay > 0) {
        await notificationsQueue.add(
          'appointment-reminder',
          {
            clientId: event.clientId,
            type: 'booking',
            recipients,
            subject: `Reminder due — ${appt.title ?? 'Appointment'}`,
            body: `Send the client a reminder for their appointment at ${appt.start_time}.`,
            metadata: { appointmentId: appt.id },
          },
          { delay, jobId: buildIdempotencyKey('appt-reminder', appt.id) }
        );
      }
    }

    logger.info({ appointmentId: appt.id }, 'Booking follow-ups scheduled');
  } catch (err) {
    logger.error({ err, eventId: event.id }, 'Booking automation failed');
  }
}
