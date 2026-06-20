import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { validateRetellWebhook } from '../../middleware/index.js';
import { clientService, contactService, callService } from '../../services/index.js';
import { bookingService } from '../../booking/index.js';
import { notificationsQueue } from '../../queues/index.js';
import { supabase } from '../../db/index.js';
import { buildIdempotencyKey } from '../../utils/index.js';
import type { Client, ClientSettings } from '../../types/index.js';

// ─── Retell custom-function request shape: { name, call, args } ──────────────
interface RetellFunctionCall {
  call_id?: string;
  agent_id?: string;
  from_number?: string;
  to_number?: string;
}
interface RetellFunctionBody {
  name?: string;
  call?: RetellFunctionCall;
  args?: Record<string, unknown>;
}

// Resolve the tenant from the inbound call (dialed number, then agent id).
async function resolveClient(call: RetellFunctionCall | undefined): Promise<Client | null> {
  if (!call) return null;
  if (call.to_number) {
    const byNumber = await clientService.findByPhoneNumber(call.to_number);
    if (byNumber) return byNumber;
  }
  if (call.agent_id) return clientService.findByAgentId(call.agent_id);
  return null;
}

function serviceDuration(settings: ClientSettings, name: string | undefined, fallback: number): number {
  if (!name) return fallback;
  const svc = settings.services?.find((s) => s.name.toLowerCase() === name.toLowerCase());
  return svc?.duration_minutes ?? fallback;
}

export async function retellFunctionRoutes(app: FastifyInstance): Promise<void> {
  // Every function endpoint validates the Retell signature (API key based).
  const guard = { preHandler: validateRetellWebhook };

  // ── lookup_existing_client ────────────────────────────────────────────────
  app.post<{ Body: RetellFunctionBody }>('/functions/retell/lookup_existing_client', guard, async (req, reply) => {
    const client = await resolveClient(req.body.call);
    if (!client) return reply.code(404).send({ found: false, message: 'Client not configured.' });
    const args = z.object({ phone: z.string().min(3) }).safeParse(req.body.args ?? {});
    if (!args.success) return reply.send({ found: false, message: 'No phone number provided.' });

    const contact = await contactService.findByPhone(client.id, args.data.phone);
    if (!contact) return reply.send({ found: false, message: 'No existing record for this caller.' });

    const { data: recentAppts } = await supabase
      .from('appointments')
      .select('title, start_time, status')
      .eq('client_id', client.id)
      .eq('contact_id', contact.id)
      .order('start_time', { ascending: false })
      .limit(3);

    return reply.send({
      found: true,
      first_name: contact.first_name,
      last_name: contact.last_name,
      tags: contact.tags ?? [],
      recent_appointments: recentAppts ?? [],
      message: `Returning client ${contact.first_name || ''} found. Greet them warmly and reference their history.`,
    });
  });

  // ── check_availability ────────────────────────────────────────────────────
  app.post<{ Body: RetellFunctionBody }>('/functions/retell/check_availability', guard, async (req, reply) => {
    const client = await resolveClient(req.body.call);
    if (!client) return reply.code(404).send({ message: 'Client not configured.' });
    const args = z.object({ date: z.string().min(4), service_type: z.string().optional() }).safeParse(req.body.args ?? {});
    if (!args.success) return reply.send({ available: false, message: 'Please provide a date to check.' });

    const slots = await bookingService.getAvailability({
      clientId: client.id,
      date: args.data.date,
      serviceType: args.data.service_type,
      timezone: client.timezone,
    });
    const open = slots.filter((s) => s.available).slice(0, 8).map((s) => s.start.toISOString());
    return reply.send({
      date: args.data.date,
      available: open.length > 0,
      slots: open,
      message: open.length ? `There are ${open.length} open times on ${args.data.date}.` : `No open times on ${args.data.date}; offer another day.`,
    });
  });

  // ── qualify_lead ──────────────────────────────────────────────────────────
  app.post<{ Body: RetellFunctionBody }>('/functions/retell/qualify_lead', guard, async (req, reply) => {
    const client = await resolveClient(req.body.call);
    if (!client) return reply.code(404).send({ message: 'Client not configured.' });
    const args = z
      .object({ name: z.string().min(1), phone: z.string().min(3), email: z.string().optional(), service_interest: z.string().min(1) })
      .passthrough()
      .safeParse(req.body.args ?? {});
    if (!args.success) return reply.send({ qualified: false, message: 'Need name, phone, and service interest.' });

    const { name, phone, email, service_interest, ...extra } = args.data;
    const [first, ...rest] = name.trim().split(' ');
    const contact = await contactService.upsertByPhone(client.id, phone, {
      first_name: first ?? '',
      last_name: rest.join(' '),
      email: email ?? null,
      tags: ['lead', 'voice'],
      custom_fields: { service_interest, ...extra },
    });
    return reply.send({ qualified: true, contact_id: contact.id, message: `Lead captured for ${name}. Offer to book a consultation or appointment.` });
  });

  // ── book_appointment & book_consultation share booking logic ──────────────
  async function handleBooking(
    req: { body: RetellFunctionBody },
    reply: import('fastify').FastifyReply,
    kind: 'appointment' | 'consultation'
  ) {
    const client = await resolveClient(req.body.call);
    if (!client) return reply.code(404).send({ booked: false, message: 'Client not configured.' });
    const settings = await clientService.getSettings(client.id);
    if (!settings || !settings.booking_enabled) {
      return reply.send({ booked: false, message: 'Booking is not available; offer to take a message instead.' });
    }

    const schema = z.object({
      contact_name: z.string().min(1),
      phone: z.string().min(3),
      service_type: z.string().optional(),
      service_interest: z.string().optional(),
      start_time: z.string().datetime(),
      notes: z.string().optional(),
    });
    const args = schema.safeParse(req.body.args ?? {});
    if (!args.success) return reply.send({ booked: false, message: 'Need the caller name, phone, and a valid start time.' });

    const svcName = kind === 'consultation' ? 'Consultation' : args.data.service_type ?? 'Appointment';
    const durationMin = kind === 'consultation' ? serviceDuration(settings, 'Consultation', 30) : serviceDuration(settings, args.data.service_type, 60);
    const startTime = new Date(args.data.start_time);
    const endTime = new Date(startTime.getTime() + durationMin * 60_000);

    const [first, ...rest] = args.data.contact_name.trim().split(' ');
    const contact = await contactService.upsertByPhone(client.id, args.data.phone, {
      first_name: first ?? '',
      last_name: rest.join(' '),
    });
    const existingCall = req.body.call?.call_id ? await callService.findByRetellId(req.body.call.call_id) : null;

    try {
      const appt = await bookingService.createAppointment({
        clientId: client.id,
        contactId: contact.id,
        callId: existingCall?.id,
        title: kind === 'consultation' ? `Consultation — ${args.data.service_interest ?? 'general'}` : svcName,
        startTime,
        endTime,
        timezone: client.timezone,
        serviceType: kind === 'consultation' ? 'consultation' : args.data.service_type,
        notes: args.data.notes,
      });
      return reply.send({
        booked: true,
        appointment_id: appt.id,
        start_time: startTime.toISOString(),
        message: `Booked ${svcName} for ${args.data.contact_name} at ${startTime.toISOString()}. Confirm the details out loud and set arrival expectations.`,
      });
    } catch (err) {
      return reply.send({ booked: false, reason: 'unavailable', message: `That time isn't available (${(err as Error).message}). Offer another slot.` });
    }
  }

  app.post<{ Body: RetellFunctionBody }>('/functions/retell/book_appointment', guard, (req, reply) => handleBooking(req, reply, 'appointment'));
  app.post<{ Body: RetellFunctionBody }>('/functions/retell/book_consultation', guard, (req, reply) => handleBooking(req, reply, 'consultation'));

  // ── schedule_callback ─────────────────────────────────────────────────────
  app.post<{ Body: RetellFunctionBody }>('/functions/retell/schedule_callback', guard, async (req, reply) => {
    const client = await resolveClient(req.body.call);
    if (!client) return reply.code(404).send({ scheduled: false, message: 'Client not configured.' });
    const args = z
      .object({
        caller_name: z.string().min(1),
        phone: z.string().min(3),
        preferred_time: z.string().optional(),
        topic: z.string().optional(),
      })
      .safeParse(req.body.args ?? {});
    if (!args.success) return reply.send({ scheduled: false, message: 'Need the caller name and phone number to schedule a callback.' });

    const settings = await clientService.getSettings(client.id);
    const existingCall = req.body.call?.call_id ? await callService.findByRetellId(req.body.call.call_id) : null;

    // Persist the contact + a callback request for staff.
    const [first, ...rest] = args.data.caller_name.trim().split(' ');
    await contactService.upsertByPhone(client.id, args.data.phone, {
      first_name: first ?? '',
      last_name: rest.join(' '),
      tags: ['callback', 'voice'],
    });
    await supabase.from('staff_notifications').insert({
      client_id: client.id,
      call_id: existingCall?.id ?? null,
      type: 'lead',
      status: 'pending',
      message: `Callback requested by ${args.data.caller_name} (${args.data.phone})${args.data.topic ? ` about ${args.data.topic}` : ''}${args.data.preferred_time ? `, preferred time: ${args.data.preferred_time}` : ''}.`,
      recipient_email: settings?.notification_emails?.join(', ') ?? null,
      metadata: { kind: 'callback', phone: args.data.phone, preferred_time: args.data.preferred_time, topic: args.data.topic },
    });
    if (settings?.notification_emails?.length) {
      await notificationsQueue.add(
        'schedule-callback',
        {
          clientId: client.id,
          type: 'lead',
          recipients: settings.notification_emails,
          subject: `Callback requested — ${args.data.caller_name}`,
          body: `${args.data.caller_name} (${args.data.phone}) asked for a callback.\nTopic: ${args.data.topic ?? 'n/a'}\nPreferred time: ${args.data.preferred_time ?? 'any'}`,
          callId: existingCall?.id,
        },
        existingCall ? { jobId: buildIdempotencyKey('callback', existingCall.id) } : undefined
      );
    }
    return reply.send({
      scheduled: true,
      message: `Got it — I've scheduled a callback for ${args.data.caller_name}${args.data.preferred_time ? ` around ${args.data.preferred_time}` : ''}. Reassure them a team member will follow up.`,
    });
  });

  // ── leave_staff_message ───────────────────────────────────────────────────
  app.post<{ Body: RetellFunctionBody }>('/functions/retell/leave_staff_message', guard, async (req, reply) => {
    const client = await resolveClient(req.body.call);
    if (!client) return reply.code(404).send({ saved: false, message: 'Client not configured.' });
    const args = z.object({ caller_name: z.string().min(1), phone: z.string().min(3), message: z.string().min(1), urgency: z.string().optional() }).safeParse(req.body.args ?? {});
    if (!args.success) return reply.send({ saved: false, message: 'Need the caller name, phone, and message.' });

    const settings = await clientService.getSettings(client.id);
    const existingCall = req.body.call?.call_id ? await callService.findByRetellId(req.body.call.call_id) : null;

    await supabase.from('staff_notifications').insert({
      client_id: client.id,
      call_id: existingCall?.id ?? null,
      type: 'escalation',
      status: 'pending',
      message: `Message from ${args.data.caller_name} (${args.data.phone}): ${args.data.message}`,
      recipient_email: settings?.notification_emails?.join(', ') ?? null,
      metadata: { kind: 'staff_message', urgency: args.data.urgency ?? 'normal', phone: args.data.phone },
    });
    if (settings?.notification_emails?.length) {
      await notificationsQueue.add('staff-message', {
        clientId: client.id,
        type: 'escalation',
        recipients: settings.notification_emails,
        subject: `New voicemail/message from ${args.data.caller_name}`,
        body: `${args.data.caller_name} (${args.data.phone}) left a message:\n\n${args.data.message}\n\nUrgency: ${args.data.urgency ?? 'normal'}`,
        callId: existingCall?.id,
      });
    }
    return reply.send({ saved: true, message: 'Message saved and staff notified. Reassure the caller someone will follow up.' });
  });

  // ── request_human_handoff ─────────────────────────────────────────────────
  app.post<{ Body: RetellFunctionBody }>('/functions/retell/request_human_handoff', guard, async (req, reply) => {
    const client = await resolveClient(req.body.call);
    if (!client) return reply.code(404).send({ message: 'Client not configured.' });
    const args = z.object({ reason: z.string().min(1), phone: z.string().optional() }).safeParse(req.body.args ?? {});
    if (!args.success) return reply.send({ transferring: false, message: 'Please describe what you need help with.' });

    const settings = await clientService.getSettings(client.id);
    const existingCall = req.body.call?.call_id ? await callService.findByRetellId(req.body.call.call_id) : null;

    if (existingCall) {
      await callService.upsertConversation({
        call_id: existingCall.id,
        client_id: client.id,
        contact_id: existingCall.contact_id,
        handoff_requested: true,
      });
    }
    await supabase.from('staff_notifications').insert({
      client_id: client.id,
      call_id: existingCall?.id ?? null,
      type: 'handoff',
      status: 'pending',
      message: `Human handoff requested: ${args.data.reason}`,
      recipient_email: settings?.notification_emails?.join(', ') ?? null,
      metadata: { phone: args.data.phone ?? req.body.call?.from_number },
    });
    if (settings?.notification_emails?.length) {
      await notificationsQueue.add('handoff', {
        clientId: client.id,
        type: 'handoff',
        recipients: settings.notification_emails,
        subject: `Live handoff requested — ${client.name}`,
        body: `A caller asked for a human.\nReason: ${args.data.reason}\nCallback: ${args.data.phone ?? req.body.call?.from_number ?? 'unknown'}`,
        callId: existingCall?.id,
      }, { jobId: existingCall ? buildIdempotencyKey('handoff', existingCall.id) : undefined });
    }
    return reply.send({ transferring: true, message: 'A team member has been alerted. Offer to take a callback number if no one is available.' });
  });
}
