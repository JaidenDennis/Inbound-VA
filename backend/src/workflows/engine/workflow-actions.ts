import { contactService, callService } from '../../services/index.js';
import { bookingService } from '../../booking/index.js';
import { crmSyncQueue, notificationsQueue } from '../../queues/index.js';
import { supabase } from '../../db/index.js';
import { buildIdempotencyKey, formatPhone, spellName, logger } from '../../utils/index.js';
import type { Client, ClientSettings } from '../../types/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Workflow action registry.
//
// When a workflow enters its declared action state, the update_workflow handler
// runs the named action HERE — the BACKEND performs it deterministically from
// the slots the engine already collected and validated, instead of trusting the
// LLM to separately invoke an action tool. (That two-step gap is exactly what
// let a live booking reach "execute" and then never actually book.)
//
// Service coupling lives in this module, never in the declarative definitions.
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkflowActionContext {
  client: Client;
  settings: ClientSettings | null;
  slots: Record<string, unknown>;
  callId: string | null;
  retellCallId: string;
}

export interface WorkflowActionResult {
  ok: boolean;
  /** Overrides the workflow's outcomeOnSuccess/Failure when set. */
  outcome?: string;
  /** Conversational guidance for the agent (spoken next). */
  message: string;
  data?: Record<string, unknown>;
}

type WorkflowActionHandler = (ctx: WorkflowActionContext) => Promise<WorkflowActionResult>;

function splitName(full: string): { first: string; last: string } {
  const [first, ...rest] = String(full).trim().split(/\s+/);
  return { first: first ?? '', last: rest.join(' ') };
}

function serviceDuration(settings: ClientSettings | null, name: string | undefined, fallback: number): number {
  if (!name || !settings?.services) return fallback;
  const svc = settings.services.find((s) => s.name.toLowerCase() === name.toLowerCase());
  return svc?.duration_minutes ?? fallback;
}

/** booking.create — book an appointment/consultation from the collected slots. */
const bookingCreate: WorkflowActionHandler = async (ctx) => {
  const { client, settings, slots } = ctx;
  if (!settings?.booking_enabled) {
    return { ok: false, outcome: 'no_availability', message: 'Booking is not available for this client; offer to take a message or schedule a callback instead.' };
  }

  const name = String(slots.name ?? '').trim();
  const phone = String(slots.phone ?? '').trim();
  const service = String(slots.service ?? '').trim();
  const startRaw = String(slots.preferred_time ?? '').trim();
  if (!name || !phone || !startRaw) {
    return { ok: false, outcome: 'no_availability', message: 'Still missing the name, phone, or time — collect them before finalizing.' };
  }
  const startTime = new Date(startRaw);
  if (Number.isNaN(startTime.getTime())) {
    return { ok: false, outcome: 'no_availability', message: 'The appointment time is not a valid date — re-confirm the date and time with the caller.' };
  }

  const isConsult = /consult/i.test(service) || !service;
  const durationMin = isConsult ? serviceDuration(settings, 'Consultation', 30) : serviceDuration(settings, service, 60);
  const endTime = new Date(startTime.getTime() + durationMin * 60_000);

  const { first, last } = splitName(name);
  const contact = await contactService.upsertByPhone(client.id, phone, {
    first_name: first,
    last_name: last,
    email: (slots.email as string) ?? null,
  });
  const existingCall = ctx.callId ? { id: ctx.callId } : await callService.findByRetellId(ctx.retellCallId);

  try {
    const appt = await bookingService.createAppointment({
      clientId: client.id,
      contactId: contact.id,
      callId: existingCall?.id,
      title: isConsult ? `Consultation${service && !/consult/i.test(service) ? ` — ${service}` : ''}` : service,
      startTime,
      endTime,
      timezone: client.timezone,
      serviceType: isConsult ? 'consultation' : service,
    });
    return {
      ok: true,
      outcome: 'booked',
      message: `Booked ${isConsult ? 'a consultation' : service} for ${name} at ${startTime.toISOString()}. Confirm the date, time, and service back to the caller, and to confirm the phone, ${verbatim(formatPhone(phone))}. Then close warmly.`,
      data: { appointmentId: appt.id, startTime: startTime.toISOString() },
    };
  } catch (err) {
    return {
      ok: false,
      outcome: 'no_availability',
      message: `That time isn't available (${(err as Error).message}). Use check_availability to offer another slot, then finalize again.`,
    };
  }
};

/** waitlist.add — add the caller to the waitlist from the collected slots. */
const waitlistAdd: WorkflowActionHandler = async (ctx) => {
  const { client, slots } = ctx;
  const name = String(slots.name ?? '').trim();
  const phone = String(slots.phone ?? '').trim();
  if (!name || !phone) return { ok: false, message: 'Need the name and phone before adding to the waitlist.' };

  const { first, last } = splitName(name);
  const contact = await contactService.upsertByPhone(client.id, phone, { first_name: first, last_name: last, tags: ['waitlist', 'voice'] });
  const existingCall = ctx.callId ? { id: ctx.callId } : await callService.findByRetellId(ctx.retellCallId);
  const entry = await bookingService.addToWaitlist({
    clientId: client.id,
    contactId: contact.id,
    callId: existingCall?.id,
    service: (slots.service as string) ?? undefined,
    preferredDays: (slots.preferred_days as string[]) ?? undefined,
    preferredTimes: (slots.preferred_times as string) ?? undefined,
  });
  return {
    ok: true,
    outcome: 'added',
    message: `Added ${name} to the waitlist${slots.service ? ` for ${slots.service}` : ''}. To confirm the number, ${verbatim(formatPhone(phone))}. Reassure them they'll be contacted when an opening appears.`,
    data: { waitlistId: entry.id },
  };
};

/** crm.createLead — capture a qualified lead, push to CRM pipeline, alert staff. */
const leadCapture: WorkflowActionHandler = async (ctx) => {
  const { client, settings, slots } = ctx;
  const name = String(slots.name ?? '').trim();
  const phone = String(slots.phone ?? '').trim();
  const interest = String(slots.service_interest ?? slots.service ?? '').trim();
  if (!name || !phone || !interest) return { ok: false, message: 'Need the name, phone, and service interest before capturing the lead.' };

  const { first, last } = splitName(name);
  const { name: _n, phone: _p, service_interest: _s, ...extra } = slots;
  const contact = await contactService.upsertByPhone(client.id, phone, {
    first_name: first,
    last_name: last,
    email: (slots.email as string) ?? null,
    tags: ['lead', 'voice'],
    custom_fields: { service_interest: interest, ...extra },
  });
  const existingCall = ctx.callId ? { id: ctx.callId } : await callService.findByRetellId(ctx.retellCallId);

  const { data: conn } = await supabase
    .from('crm_connections').select('id').eq('client_id', client.id).eq('is_active', true).maybeSingle();
  if (conn) {
    await crmSyncQueue.add(
      'lead-capture',
      {
        clientId: client.id,
        crmConnectionId: conn.id,
        entityType: 'lead',
        entityId: contact.id,
        operation: 'create',
        payload: { contactId: contact.id, title: `${name} — ${interest}`, source: 'inbound-voice' },
        idempotencyKey: buildIdempotencyKey('lead', existingCall?.id ?? contact.id),
      },
      { jobId: buildIdempotencyKey('crm-lead', existingCall?.id ?? contact.id) }
    );
  }
  if (settings?.notification_emails?.length) {
    await notificationsQueue.add('new-lead', {
      clientId: client.id,
      type: 'lead',
      recipients: settings.notification_emails,
      subject: `New lead — ${name} (${interest})`,
      body: `A new lead was captured on a call.\nName: ${name}\nPhone: ${phone}\nInterested in: ${interest}`,
      callId: existingCall?.id,
    }, existingCall ? { jobId: buildIdempotencyKey('new-lead', existingCall.id) } : undefined);
  }
  return {
    ok: true,
    outcome: 'qualified',
    message: `Lead captured for ${name}. To confirm the phone, ${verbatim(formatPhone(phone))}, and the name, ${verbatim(spellName(name))}. Then offer to book a consultation.`,
    data: { contactId: contact.id },
  };
};

// See retell-functions.route.ts — forces the LLM to speak break-tagged readback verbatim.
function verbatim(value: string): string {
  return `say this back to the caller EXACTLY as written, reproducing the "<break ... />" pause markers but NEVER speaking them aloud (they are silent pauses): "${value}"`;
}

const REGISTRY: Record<string, WorkflowActionHandler> = {
  'booking.create': bookingCreate,
  'waitlist.add': waitlistAdd,
  'crm.createLead': leadCapture,
};

/** Run a workflow action by name. Unknown/erroring actions never throw — they
 *  return a graceful failure the agent can speak. */
export async function runWorkflowAction(name: string, ctx: WorkflowActionContext): Promise<WorkflowActionResult> {
  const handler = REGISTRY[name];
  if (!handler) {
    logger.error({ action: name }, 'No workflow action handler registered');
    return { ok: false, message: 'That step could not be completed automatically; offer to take a message or a callback.' };
  }
  try {
    return await handler(ctx);
  } catch (err) {
    logger.error({ err, action: name, clientId: ctx.client.id }, 'Workflow action failed');
    return { ok: false, message: 'Something went wrong finalizing that; apologize briefly and offer a callback or to take a message.' };
  }
}

export function hasWorkflowAction(name: string): boolean {
  return name in REGISTRY;
}
