import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { validateRetellWebhook } from '../../middleware/index.js';
import { enforceScope } from '../../workflows/index.js';
import { clientService, contactService, callService, knowledgeService, ticketService } from '../../services/index.js';
import { bookingService } from '../../booking/index.js';
import { notificationsQueue, crmSyncQueue } from '../../queues/index.js';
import { supabase } from '../../db/index.js';
import { buildIdempotencyKey, formatPhone, spellName } from '../../utils/index.js';
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

/**
 * Wrap a break-tagged readback value (from formatPhone/spellName) with an
 * instruction that forces the LLM to speak it VERBATIM. The <break> pause tags
 * only survive to the TTS if the model echoes the string exactly rather than
 * paraphrasing it — hence the explicit "say this back exactly" framing and the
 * reminder that the markers are silent and must never be spoken aloud.
 */
function verbatim(value: string): string {
  return `say this back to the caller EXACTLY as written, reproducing the "<break ... />" pause markers but NEVER speaking them aloud (they are silent pauses): "${value}"`;
}

export async function retellFunctionRoutes(app: FastifyInstance): Promise<void> {
  // Every function endpoint validates the Retell signature (API key based),
  // then enforces workflow capability scopes for routing-enabled calls —
  // legacy (non-routing) agents pass the scope guard untouched.
  const guarded = (tool: string) => ({ preHandler: [validateRetellWebhook, enforceScope(tool)] });

  // ── lookup_existing_client ────────────────────────────────────────────────
  app.post<{ Body: RetellFunctionBody }>('/functions/retell/lookup_existing_client', guarded('lookup_existing_client'), async (req, reply) => {
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
  app.post<{ Body: RetellFunctionBody }>('/functions/retell/check_availability', guarded('check_availability'), async (req, reply) => {
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

  // ── knowledge_search ──────────────────────────────────────────────────────
  app.post<{ Body: RetellFunctionBody }>('/functions/retell/knowledge_search', guarded('knowledge_search'), async (req, reply) => {
    const client = await resolveClient(req.body.call);
    if (!client) return reply.code(404).send({ message: 'Client not configured.' });
    const args = z
      .object({ query: z.string().min(1), topic: z.string().optional() })
      .safeParse(req.body.args ?? {});
    if (!args.success) return reply.send({ found: false, message: 'Provide the caller\'s question as the query.' });

    const settings = await clientService.getSettings(client.id);
    const result = await knowledgeService.search(client.id, args.data.query, settings);

    // The promotions topic lists every live offer, not just query matches —
    // the backend already enforced the date windows.
    const promotions =
      args.data.topic === 'promotions' || /promo|special|discount|offer|deal/i.test(args.data.query)
        ? result.activePromotions
        : result.promotions;

    const found = result.found || promotions.length > 0;
    return reply.send({
      found,
      faqs: result.faqs,
      services: result.services,
      pricing: result.pricing,
      promotions,
      message: found
        ? 'Answer ONLY from these results — read the relevant answer naturally, never as raw data. Prices are starting points.'
        : 'Nothing in the knowledge base matches. Say you are not sure, and offer a callback or to take a message — never guess.',
    });
  });

  // ── qualify_lead ──────────────────────────────────────────────────────────
  app.post<{ Body: RetellFunctionBody }>('/functions/retell/qualify_lead', guarded('qualify_lead'), async (req, reply) => {
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

    const existingCall = req.body.call?.call_id ? await callService.findByRetellId(req.body.call.call_id) : null;

    // Push the lead into the CRM pipeline (adapter.createLead → opportunity in
    // the configured pipeline/stage). Idempotent per call+contact.
    const { data: conn } = await supabase
      .from('crm_connections')
      .select('id')
      .eq('client_id', client.id)
      .eq('is_active', true)
      .maybeSingle();
    if (conn) {
      await crmSyncQueue.add(
        'lead-capture',
        {
          clientId: client.id,
          crmConnectionId: conn.id,
          entityType: 'lead',
          entityId: contact.id,
          operation: 'create',
          payload: {
            contactId: contact.id,
            title: `${name} — ${service_interest}`,
            source: 'inbound-voice',
          },
          idempotencyKey: buildIdempotencyKey('lead', existingCall?.id ?? contact.id),
        },
        { jobId: buildIdempotencyKey('crm-lead', existingCall?.id ?? contact.id) }
      );
    }

    // Alert staff about the fresh lead (idempotent per call).
    const settings = await clientService.getSettings(client.id);
    if (settings?.notification_emails?.length) {
      await notificationsQueue.add(
        'new-lead',
        {
          clientId: client.id,
          type: 'lead',
          recipients: settings.notification_emails,
          subject: `New lead — ${name} (${service_interest})`,
          body: `A new lead was captured on a call.\nName: ${name}\nPhone: ${phone}\nEmail: ${email ?? 'n/a'}\nInterested in: ${service_interest}`,
          callId: existingCall?.id,
        },
        existingCall ? { jobId: buildIdempotencyKey('new-lead', existingCall.id) } : undefined
      );
    }

    return reply.send({
      qualified: true,
      contact_id: contact.id,
      message: `Lead captured for ${name}. To confirm the phone, ${verbatim(formatPhone(phone))}. To confirm the name, ${verbatim(spellName(name))}. Then ask "Did I get that right?" and wait before offering to book.`,
    });
  });

  // ── forms_send ────────────────────────────────────────────────────────────
  // Send intake/consent forms. Voice-only launch: forms go by EMAIL when the
  // caller has one and the client configured a form link; otherwise staff get
  // a task to send them manually. (SMS delivery plugs in later.)
  app.post<{ Body: RetellFunctionBody }>('/functions/retell/forms_send', guarded('forms_send'), async (req, reply) => {
    const client = await resolveClient(req.body.call);
    if (!client) return reply.code(404).send({ sent: false, message: 'Client not configured.' });
    const args = z
      .object({
        caller_name: z.string().min(1),
        phone: z.string().min(3),
        email: z.string().email().optional(),
        form_type: z.string().optional(),
        service: z.string().optional(),
      })
      .safeParse(req.body.args ?? {});
    if (!args.success) return reply.send({ sent: false, message: 'Need the caller name and phone (and ideally an email) to send forms.' });

    const settings = await clientService.getSettings(client.id);
    const formUrl = settings?.agent_config?.intake_form_url;
    const existingCall = req.body.call?.call_id ? await callService.findByRetellId(req.body.call.call_id) : null;

    const [first, ...rest] = args.data.caller_name.trim().split(' ');
    await contactService.upsertByPhone(client.id, args.data.phone, {
      first_name: first ?? '',
      last_name: rest.join(' '),
      email: args.data.email ?? undefined,
      tags: ['intake', 'voice'],
    });

    if (args.data.email && formUrl) {
      await notificationsQueue.add(
        'forms-send',
        {
          clientId: client.id,
          type: 'lead',
          recipients: [args.data.email],
          subject: `${client.name} — your ${args.data.form_type ?? 'intake'} forms`,
          body: `Hi ${first},\n\nThanks for calling ${client.name}. Please complete your ${args.data.form_type ?? 'intake'} forms before your visit:\n\n${formUrl}\n\nSee you soon!`,
          callId: existingCall?.id,
        },
        existingCall ? { jobId: buildIdempotencyKey('forms', existingCall.id, args.data.email) } : undefined
      );
      return reply.send({
        sent: true,
        channel: 'email',
        message: `Forms emailed to ${args.data.email}. Ask them to complete the forms before their visit.`,
      });
    }

    // No email or no configured form link → staff task, so nothing is dropped.
    await supabase.from('staff_notifications').insert({
      client_id: client.id,
      call_id: existingCall?.id ?? null,
      type: 'lead',
      status: 'pending',
      message: `Send ${args.data.form_type ?? 'intake'} forms to ${args.data.caller_name} (${args.data.phone}${args.data.email ? `, ${args.data.email}` : ''})${args.data.service ? ` for ${args.data.service}` : ''}.`,
      recipient_email: settings?.notification_emails?.join(', ') ?? null,
      metadata: { kind: 'forms', phone: args.data.phone, email: args.data.email, form_type: args.data.form_type },
    });
    return reply.send({
      sent: false,
      channel: 'staff',
      message: 'Forms could not be sent directly; the team has a task to send them. Reassure the caller the forms are on their way.',
    });
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
        message: `Booked ${svcName} for ${args.data.contact_name} at ${startTime.toISOString()}. Confirm the name, date, and time, and to confirm the phone, ${verbatim(formatPhone(args.data.phone))}. Then close warmly.`,
      });
    } catch (err) {
      return reply.send({ booked: false, reason: 'unavailable', message: `That time isn't available (${(err as Error).message}). Offer another slot.` });
    }
  }

  app.post<{ Body: RetellFunctionBody }>('/functions/retell/book_appointment', guarded('book_appointment'), (req, reply) => handleBooking(req, reply, 'appointment'));
  app.post<{ Body: RetellFunctionBody }>('/functions/retell/book_consultation', guarded('book_consultation'), (req, reply) => handleBooking(req, reply, 'consultation'));

  // ── find_appointment ──────────────────────────────────────────────────────
  // Locate the caller's upcoming appointments so reschedule/cancel/inquiry
  // workflows can reference a concrete appointment id.
  app.post<{ Body: RetellFunctionBody }>('/functions/retell/find_appointment', guarded('find_appointment'), async (req, reply) => {
    const client = await resolveClient(req.body.call);
    if (!client) return reply.code(404).send({ found: false, message: 'Client not configured.' });
    const args = z.object({ phone: z.string().min(3) }).safeParse(req.body.args ?? {});
    if (!args.success) return reply.send({ found: false, message: 'Need the caller\'s phone number to look up appointments.' });

    const contact = await contactService.findByPhone(client.id, args.data.phone);
    if (!contact) return reply.send({ found: false, message: 'No record for this caller. Confirm the phone number digit by digit.' });

    const { data: appts } = await supabase
      .from('appointments')
      .select('id, title, start_time, status, service_type')
      .eq('client_id', client.id)
      .eq('contact_id', contact.id)
      .gte('start_time', new Date().toISOString())
      .not('status', 'in', '("cancelled","no_show","completed")')
      .order('start_time', { ascending: true })
      .limit(3);

    if (!appts?.length) {
      return reply.send({ found: false, message: 'No upcoming appointments for this caller. Offer to book one.' });
    }
    return reply.send({
      found: true,
      appointments: appts,
      message: `Found ${appts.length} upcoming appointment(s). Read back the date, time, and service naturally — never the internal id.`,
    });
  });

  // ── reschedule_appointment ────────────────────────────────────────────────
  app.post<{ Body: RetellFunctionBody }>('/functions/retell/reschedule_appointment', guarded('reschedule_appointment'), async (req, reply) => {
    const client = await resolveClient(req.body.call);
    if (!client) return reply.code(404).send({ rescheduled: false, message: 'Client not configured.' });
    const args = z
      .object({ appointment_id: z.string().uuid(), new_start_time: z.string().datetime(), reason: z.string().optional() })
      .safeParse(req.body.args ?? {});
    if (!args.success) return reply.send({ rescheduled: false, message: 'Need the appointment and a valid new start time (use find_appointment first).' });

    const existing = await bookingService.getAppointment(args.data.appointment_id);
    if (!existing || existing.client_id !== client.id) {
      return reply.send({ rescheduled: false, message: 'That appointment could not be found. Use find_appointment with the caller\'s phone.' });
    }
    const durationMs = new Date(existing.end_time).getTime() - new Date(existing.start_time).getTime();
    const newStart = new Date(args.data.new_start_time);
    try {
      const appt = await bookingService.rescheduleAppointment({
        appointmentId: existing.id,
        newStartTime: newStart,
        newEndTime: new Date(newStart.getTime() + durationMs),
        reason: args.data.reason,
      });
      return reply.send({
        rescheduled: true,
        appointment_id: appt.id,
        start_time: appt.start_time,
        message: `Rescheduled to ${appt.start_time}. Read back the new date and time and confirm before closing.`,
      });
    } catch (err) {
      return reply.send({ rescheduled: false, reason: 'unavailable', message: `That time isn't available (${(err as Error).message}). Offer another slot via check_availability.` });
    }
  });

  // ── cancel_appointment ────────────────────────────────────────────────────
  app.post<{ Body: RetellFunctionBody }>('/functions/retell/cancel_appointment', guarded('cancel_appointment'), async (req, reply) => {
    const client = await resolveClient(req.body.call);
    if (!client) return reply.code(404).send({ cancelled: false, message: 'Client not configured.' });
    const args = z
      .object({ appointment_id: z.string().uuid(), reason: z.string().optional() })
      .safeParse(req.body.args ?? {});
    if (!args.success) return reply.send({ cancelled: false, message: 'Need the appointment to cancel (use find_appointment first).' });

    const existing = await bookingService.getAppointment(args.data.appointment_id);
    if (!existing || existing.client_id !== client.id) {
      return reply.send({ cancelled: false, message: 'That appointment could not be found. Use find_appointment with the caller\'s phone.' });
    }

    // Cancellation policy (client-configured, never hardcoded): when the
    // cancellation falls inside the notice window, the policy line MUST be
    // read to the caller.
    const settings = await clientService.getSettings(client.id);
    const noticeHours = settings?.booking_rules?.cancellation_notice_hours;
    const policyText = settings?.booking_rules?.cancellation_policy;
    const hoursUntil = (new Date(existing.start_time).getTime() - Date.now()) / 3_600_000;
    const policyApplies = noticeHours != null && hoursUntil < noticeHours;

    const appt = await bookingService.cancelAppointment(existing.id, args.data.reason);
    return reply.send({
      cancelled: true,
      appointment_id: appt.id,
      policy_applies: policyApplies,
      message: policyApplies && policyText
        ? `Cancelled. IMPORTANT — this is inside the ${noticeHours}-hour notice window; tell the caller the policy exactly: "${policyText}"`
        : 'Cancelled. Confirm the cancellation warmly and offer to rebook when they are ready.',
    });
  });

  // ── waitlist_add ──────────────────────────────────────────────────────────
  app.post<{ Body: RetellFunctionBody }>('/functions/retell/waitlist_add', guarded('waitlist_add'), async (req, reply) => {
    const client = await resolveClient(req.body.call);
    if (!client) return reply.code(404).send({ added: false, message: 'Client not configured.' });
    const args = z
      .object({
        caller_name: z.string().min(1),
        phone: z.string().min(3),
        service: z.string().optional(),
        preferred_days: z.array(z.string()).optional(),
        preferred_times: z.string().optional(),
        notes: z.string().optional(),
      })
      .safeParse(req.body.args ?? {});
    if (!args.success) return reply.send({ added: false, message: 'Need the caller name and phone for the waitlist.' });

    const [first, ...rest] = args.data.caller_name.trim().split(' ');
    const contact = await contactService.upsertByPhone(client.id, args.data.phone, {
      first_name: first ?? '',
      last_name: rest.join(' '),
      tags: ['waitlist', 'voice'],
    });
    const existingCall = req.body.call?.call_id ? await callService.findByRetellId(req.body.call.call_id) : null;
    const entry = await bookingService.addToWaitlist({
      clientId: client.id,
      contactId: contact.id,
      callId: existingCall?.id,
      service: args.data.service,
      preferredDays: args.data.preferred_days,
      preferredTimes: args.data.preferred_times,
      notes: args.data.notes,
    });
    return reply.send({
      added: true,
      waitlist_id: entry.id,
      message: `Added to the waitlist${args.data.service ? ` for ${args.data.service}` : ''}. To confirm the number, ${verbatim(formatPhone(args.data.phone))}. Reassure them they'll be contacted when an opening appears.`,
    });
  });

  // ── schedule_callback ─────────────────────────────────────────────────────
  app.post<{ Body: RetellFunctionBody }>('/functions/retell/schedule_callback', guarded('schedule_callback'), async (req, reply) => {
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

    // Persist the contact + a trackable callback request for staff.
    const [cbFirst, ...cbRest] = args.data.caller_name.trim().split(' ');
    const cbContact = await contactService.upsertByPhone(client.id, args.data.phone, {
      first_name: cbFirst ?? '',
      last_name: cbRest.join(' '),
      tags: ['callback', 'voice'],
    });
    // Trackable callback record (status lifecycle) + the staff alert.
    await supabase.from('callback_requests').insert({
      client_id: client.id,
      contact_id: cbContact.id,
      call_id: existingCall?.id ?? null,
      caller_name: args.data.caller_name,
      phone: args.data.phone,
      preferred_time: args.data.preferred_time ?? null,
      reason: args.data.topic ?? null,
      status: 'pending',
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
      message: `Callback scheduled for ${args.data.caller_name}${args.data.preferred_time ? ` around ${args.data.preferred_time}` : ''}. To confirm the number, ${verbatim(formatPhone(args.data.phone))}. Then reassure them a team member will follow up.`,
    });
  });

  // ── leave_staff_message ───────────────────────────────────────────────────
  app.post<{ Body: RetellFunctionBody }>('/functions/retell/leave_staff_message', guarded('leave_staff_message'), async (req, reply) => {
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
    return reply.send({
      saved: true,
      message: `Message saved for ${args.data.caller_name}. To confirm their number, ${verbatim(formatPhone(args.data.phone))}. Then reassure them someone will follow up.`,
    });
  });

  // ── request_human_handoff ─────────────────────────────────────────────────
  app.post<{ Body: RetellFunctionBody }>('/functions/retell/request_human_handoff', guarded('request_human_handoff'), async (req, reply) => {
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
    const callbackPhone = args.data.phone ?? req.body.call?.from_number;
    return reply.send({
      transferring: true,
      message: `A team member has been alerted. ${callbackPhone ? `To confirm the callback number, ${verbatim(formatPhone(callbackPhone))}.` : 'Offer to take a callback number if no one is available.'}`,
    });
  });

  // ── membership_lookup (identity required) ─────────────────────────────────
  // Degrades gracefully: no dedicated membership backend exists, so this reads
  // the membership program config + the contact's synced membership fields, and
  // routes specifics (exact balances, freezes) to staff. Identity is enforced
  // by the scope guard (requiresVerifiedIdentity) before this handler runs.
  app.post<{ Body: RetellFunctionBody }>('/functions/retell/membership_lookup', guarded('membership_lookup'), async (req, reply) => {
    const client = await resolveClient(req.body.call);
    if (!client) return reply.code(404).send({ found: false, message: 'Client not configured.' });
    const args = z.object({ phone: z.string().min(3), question: z.string().optional() }).safeParse(req.body.args ?? {});
    if (!args.success) return reply.send({ found: false, message: 'Need the caller\'s phone number to look up membership.' });

    const settings = await clientService.getSettings(client.id);
    const program = settings?.agent_config?.membership_program;
    const contact = await contactService.findByPhone(client.id, args.data.phone);
    const membershipFields = contact?.custom_fields
      ? Object.fromEntries(
          Object.entries(contact.custom_fields as Record<string, unknown>).filter(([k]) =>
            /member|plan|tier|loyalty/i.test(k)
          )
        )
      : {};
    const isMember = (contact?.tags ?? []).some((t) => /member/i.test(t)) || Object.keys(membershipFields).length > 0;

    return reply.send({
      found: Boolean(program) || isMember,
      program: program ?? null,
      is_member: isMember,
      membership_details: membershipFields,
      message: program
        ? `Membership program: ${program.name}${program.description ? ` — ${program.description}` : ''}. ${isMember ? 'This caller appears to be a member; share general benefits.' : 'Explain the program and how to join.'} For exact balances, freezes, upgrades, or cancellations, take the request and tell them the team will follow up — do NOT quote specific account figures you cannot verify.`
        : 'No membership program is configured. Offer to take the question for the team.',
    });
  });

  // ── payment_lookup (identity required) ────────────────────────────────────
  // No payments/billing backend exists (audit conflict #11). Explain financing/
  // deposit options from policy and create a staff request for anything
  // account-specific (outstanding balances). Never invent a figure.
  app.post<{ Body: RetellFunctionBody }>('/functions/retell/payment_lookup', guarded('payment_lookup'), async (req, reply) => {
    const client = await resolveClient(req.body.call);
    if (!client) return reply.code(404).send({ message: 'Client not configured.' });
    const args = z.object({ phone: z.string().min(3), topic: z.string().optional() }).safeParse(req.body.args ?? {});
    if (!args.success) return reply.send({ message: 'Need the caller\'s phone number.' });

    const settings = await clientService.getSettings(client.id);
    const existingCall = req.body.call?.call_id ? await callService.findByRetellId(req.body.call.call_id) : null;
    const policies = settings?.business_policies ?? [];
    const paymentPolicies = policies.filter((p) => /payment|financ|deposit|balance|refund|pay/i.test(p));

    // Account-specific balance questions become a staff task (never answered).
    if (args.data.topic && /balance|owe|owing|outstanding|refund/i.test(args.data.topic)) {
      await supabase.from('staff_notifications').insert({
        client_id: client.id,
        call_id: existingCall?.id ?? null,
        type: 'escalation',
        status: 'pending',
        message: `Billing/balance question from a verified caller (${args.data.phone}): ${args.data.topic}`,
        recipient_email: settings?.notification_emails?.join(', ') ?? null,
        metadata: { kind: 'payment_request', phone: args.data.phone, topic: args.data.topic },
      });
      return reply.send({
        deferred: true,
        message: 'Explain that account-specific balances are handled by the billing team, that you\'ve passed the request along, and that they\'ll follow up. Never state a balance figure.',
      });
    }

    return reply.send({
      deferred: false,
      payment_policies: paymentPolicies,
      message: paymentPolicies.length
        ? 'Share the relevant payment/financing/deposit policy from the results. For anything specific to their account, offer to have the billing team follow up.'
        : 'No payment policies are configured — explain that the billing team can walk them through options, and offer to have someone follow up.',
    });
  });

  // ── documentation_request (identity required) ─────────────────────────────
  // Receipts, invoices, medical records, consent forms. Request-only: PHI /
  // medical records are NEVER read over the phone — a staff task is created.
  app.post<{ Body: RetellFunctionBody }>('/functions/retell/documentation_request', guarded('documentation_request'), async (req, reply) => {
    const client = await resolveClient(req.body.call);
    if (!client) return reply.code(404).send({ requested: false, message: 'Client not configured.' });
    const args = z
      .object({ phone: z.string().min(3), document_type: z.string().min(1), details: z.string().optional() })
      .safeParse(req.body.args ?? {});
    if (!args.success) return reply.send({ requested: false, message: 'Need the caller\'s phone and which document they want.' });

    const settings = await clientService.getSettings(client.id);
    const contact = await contactService.findByPhone(client.id, args.data.phone);
    const existingCall = req.body.call?.call_id ? await callService.findByRetellId(req.body.call.call_id) : null;
    const isMedical = /medical|record|phi|chart|health/i.test(args.data.document_type);

    await supabase.from('staff_notifications').insert({
      client_id: client.id,
      call_id: existingCall?.id ?? null,
      type: 'escalation',
      status: 'pending',
      message: `Document request from ${contact?.first_name ?? 'caller'} (${args.data.phone}): ${args.data.document_type}${args.data.details ? ` — ${args.data.details}` : ''}${isMedical ? ' [MEDICAL RECORD — verify identity per policy before release]' : ''}`,
      recipient_email: settings?.notification_emails?.join(', ') ?? null,
      metadata: { kind: 'document_request', phone: args.data.phone, document_type: args.data.document_type, medical: isMedical },
    });

    return reply.send({
      requested: true,
      medical: isMedical,
      message: isMedical
        ? 'Confirm the request is logged and explain that medical records are released securely by the team following their privacy process — NEVER read any medical record content aloud.'
        : 'Confirm the document request is logged and the team will send it to their email or address on file.',
    });
  });

  // ── create_complaint ──────────────────────────────────────────────────────
  app.post<{ Body: RetellFunctionBody }>('/functions/retell/create_complaint', guarded('create_complaint'), async (req, reply) => {
    const client = await resolveClient(req.body.call);
    if (!client) return reply.code(404).send({ created: false, message: 'Client not configured.' });
    const args = z
      .object({
        caller_name: z.string().min(1),
        phone: z.string().min(3),
        issue: z.string().min(1),
        urgency: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
      })
      .safeParse(req.body.args ?? {});
    if (!args.success) return reply.send({ created: false, message: 'Need the caller name, phone, and a description of the issue.' });

    const settings = await clientService.getSettings(client.id);
    const existingCall = req.body.call?.call_id ? await callService.findByRetellId(req.body.call.call_id) : null;
    const [first, ...rest] = args.data.caller_name.trim().split(' ');
    const contact = await contactService.upsertByPhone(client.id, args.data.phone, {
      first_name: first ?? '',
      last_name: rest.join(' '),
      tags: ['complaint', 'voice'],
    });

    const ticket = await ticketService.createFromCaller({
      clientId: client.id,
      contactId: contact.id,
      callId: existingCall?.id,
      subject: `Caller complaint — ${args.data.caller_name}`,
      description: args.data.issue,
      priority: args.data.urgency ?? 'high',
    });

    if (existingCall) {
      await callService.upsertConversation({
        call_id: existingCall.id,
        client_id: client.id,
        contact_id: existingCall.contact_id,
        metadata: { complaint: true, ticket_id: ticket.id },
      });
    }
    if (settings?.notification_emails?.length) {
      await notificationsQueue.add(
        'complaint',
        {
          clientId: client.id,
          type: 'escalation',
          recipients: settings.notification_emails,
          subject: `Complaint logged — ${args.data.caller_name} (${args.data.urgency ?? 'high'})`,
          body: `A caller raised a complaint.\nName: ${args.data.caller_name}\nPhone: ${args.data.phone}\nIssue: ${args.data.issue}`,
          callId: existingCall?.id,
        },
        existingCall ? { jobId: buildIdempotencyKey('complaint', existingCall.id) } : undefined
      );
    }

    return reply.send({
      created: true,
      ticket_id: ticket.id,
      message: `Sincerely apologize for the experience, tell ${args.data.caller_name} the issue has been logged and escalated to a manager, and that someone will follow up. Do not be defensive.`,
    });
  });
}
