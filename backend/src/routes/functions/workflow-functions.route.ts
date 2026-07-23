import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { validateRetellWebhook } from '../../middleware/index.js';
import { clientService, callService, knowledgeService, contactService } from '../../services/index.js';
import { notificationsQueue } from '../../queues/index.js';
import { eventBus } from '../../events/index.js';
import { supabase } from '../../db/index.js';
import { buildIdempotencyKey, logger } from '../../utils/index.js';
import {
  findSession,
  createSession,
  saveSessionState,
  routeIntent,
  collectSlots,
  transition,
  completeActive,
  cancelActive,
  flagEmergency,
  getWorkflow,
  runWorkflowAction,
  type WorkflowCallRef,
} from '../../workflows/index.js';
import type { CallSessionRecord, Client } from '../../types/index.js';

// Workflow-engine tool endpoints (route_intent / update_workflow /
// emergency_flag). Same request shape and conventions as the other Retell
// custom functions: { name, call, args }, Retell signature preHandler,
// conversational `message`/`guidance` strings in every response.

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

// Resolve the tenant from the inbound call (dialed number, then agent id) —
// same convention as retell-functions.route.ts and the webhook dispatcher.
async function resolveClient(call: RetellFunctionCall | undefined): Promise<Client | null> {
  if (!call) return null;
  if (call.to_number) {
    const byNumber = await clientService.findByPhoneNumber(call.to_number);
    if (byNumber) return byNumber;
  }
  if (call.agent_id) return clientService.findByAgentId(call.agent_id);
  return null;
}

/** Load the call's session, creating a routing-enabled one when absent. */
async function loadOrCreateSession(
  client: Client,
  retellCallId: string
): Promise<CallSessionRecord | null> {
  const existing = await findSession(retellCallId);
  if (existing) return existing;
  const call = await callService.findByRetellId(retellCallId);
  return createSession({
    clientId: client.id,
    retellCallId,
    callId: call?.id ?? null,
    // A workflow tool being invoked means this agent runs under routing.
    routingEnabled: true,
  });
}

function callRef(client: Client, retellCallId: string, session: CallSessionRecord): WorkflowCallRef {
  return {
    clientId: client.id,
    retellCallId,
    callId: session.call_id,
    contactId: session.state.context?.contactId ?? null,
  };
}

const PREDEFINED_EMERGENCY_RESPONSE =
  'If this is a medical emergency or you are in immediate danger, please hang up and dial 9-1-1 or your local emergency number right now.';

export async function workflowFunctionRoutes(app: FastifyInstance): Promise<void> {
  const guard = { preHandler: validateRetellWebhook };

  // ── route_intent ──────────────────────────────────────────────────────────
  // The agent classifies the caller's intent and asks the backend where to go.
  // The engine maps intent → capability → workflow, handles topic switches
  // (stack push/pop), and answers with the workflow contract.
  app.post<{ Body: RetellFunctionBody }>('/functions/retell/route_intent', guard, async (req, reply) => {
    const client = await resolveClient(req.body.call);
    if (!client) return reply.code(404).send({ message: 'Client not configured.' });
    const retellCallId = req.body.call?.call_id;
    if (!retellCallId) return reply.send({ workflow_id: null, guidance: 'Missing call id; continue helping the caller with your available tools.' });

    const args = z.object({ intent: z.string().min(1) }).safeParse(req.body.args ?? {});
    if (!args.success) return reply.send({ workflow_id: null, guidance: 'Provide the caller\'s intent as a short label, e.g. "book_appointment".' });

    const session = await loadOrCreateSession(client, retellCallId);
    if (!session) {
      // Session store unavailable — never strand the caller; degrade to legacy behavior.
      logger.error({ retellCallId }, 'route_intent: session unavailable, degrading');
      return reply.send({ workflow_id: null, guidance: 'Continue helping the caller with your available tools.' });
    }

    const contract = await routeIntent(callRef(client, retellCallId, session), session.state, args.data.intent);
    await saveSessionState(retellCallId, session.state);
    return reply.send(contract);
  });

  // ── update_workflow ───────────────────────────────────────────────────────
  // The agent reports collected slot values and requests state transitions or
  // completion. The BACKEND validates everything — the LLM is never trusted to
  // remember where it is.
  app.post<{ Body: RetellFunctionBody }>('/functions/retell/update_workflow', guard, async (req, reply) => {
    const client = await resolveClient(req.body.call);
    if (!client) return reply.code(404).send({ message: 'Client not configured.' });
    const retellCallId = req.body.call?.call_id;
    if (!retellCallId) return reply.send({ ok: false, message: 'Missing call id.' });

    const args = z
      .object({
        slots: z.record(z.unknown()).optional(),
        transition_to: z.string().optional(),
        complete_outcome: z.string().optional(),
        cancel: z.boolean().optional(),
      })
      .safeParse(req.body.args ?? {});
    if (!args.success) return reply.send({ ok: false, message: 'Invalid update; provide slots, transition_to, complete_outcome, or cancel.' });

    const session = await findSession(retellCallId);
    if (!session || !session.state.active) {
      return reply.send({ ok: false, message: 'No active workflow. Call route_intent with the caller\'s intent first.' });
    }

    const ref = callRef(client, retellCallId, session);
    // Slot validators see relational knowledge overlaid on settings, so rules
    // like "service exists for this client" check the live menu.
    const baseSettings = await clientService.getSettings(client.id);
    const settings = baseSettings
      ? await knowledgeService.settingsWithKnowledge(client.id, baseSettings)
      : null;
    const response: Record<string, unknown> = { ok: true };

    if (args.data.slots) {
      const { errors, contract } = collectSlots(session.state, args.data.slots, {
        settings,
        timezone: client.timezone,
        now: new Date(),
      });
      if (Object.keys(errors).length) {
        response.ok = false;
        response.slot_errors = errors;
        response.message = Object.entries(errors)
          .map(([slot, msg]) => `${slot}: ${msg}`)
          .join(' ');
      }
      if (contract) response.contract = contract;
    }

    if (args.data.transition_to) {
      const res = await transition(ref, session.state, args.data.transition_to);
      if (!res.ok) {
        response.ok = false;
        response.message = res.reason;
      }
      if (res.contract) response.contract = res.contract;

      // Backend-executed action: if the workflow just entered its action state,
      // run the action HERE (deterministically, from the collected slots) rather
      // than trusting the agent to call a separate action tool. On success we
      // complete the workflow; on failure it stays put so the agent can recover.
      const activeFrame = session.state.active;
      const def = activeFrame ? getWorkflow(activeFrame.workflowId) : null;
      if (res.ok && def?.action && def.action.state === activeFrame!.state) {
        const result = await runWorkflowAction(def.action.name, {
          client,
          settings,
          slots: activeFrame!.slots,
          callId: session.call_id,
          retellCallId,
        });
        response.action = result;
        response.message = result.message;
        if (!result.ok) {
          response.ok = false;
        } else if (def.action.completeOnSuccess) {
          // Terminal action (booking, waitlist): success finishes the workflow.
          const resumed = await completeActive(ref, session.state, result.outcome ?? def.action.outcomeOnSuccess);
          response.resumed = resumed;
          if (resumed) response.message = `${result.message} Then resume: ${resumed.guidance}`;
        }
        // Mid-workflow action (lead capture): recorded; the agent continues per
        // the state guidance (already returned in res.contract).
      }
    }

    if (args.data.cancel) {
      const resumed = await cancelActive(ref, session.state, 'caller changed topic or declined');
      response.resumed = resumed;
      response.message = resumed
        ? `Resuming the earlier topic. ${resumed.guidance}`
        : 'Workflow cancelled. Ask how else you can help, or wrap up warmly.';
    } else if (args.data.complete_outcome) {
      const resumed = await completeActive(ref, session.state, args.data.complete_outcome);
      response.resumed = resumed;
      if (resumed) response.message = `Done. Now resume the earlier topic: ${resumed.guidance}`;
    }

    await saveSessionState(retellCallId, session.state);
    return reply.send(response);
  });

  // ── verify_identity ───────────────────────────────────────────────────────
  // Sets session.state.identityVerified = true once the caller-provided factors
  // match their record. Consumed by the scope guard for every account action
  // (requiresVerifiedIdentity). Which factors are required is client-configured
  // (agent_config.identity_verification_fields); the default requires the phone
  // to match a contact PLUS one corroborating factor (email, DOB, or a valid
  // upcoming appointment).
  app.post<{ Body: RetellFunctionBody }>('/functions/retell/verify_identity', guard, async (req, reply) => {
    const client = await resolveClient(req.body.call);
    if (!client) return reply.code(404).send({ verified: false, message: 'Client not configured.' });
    const retellCallId = req.body.call?.call_id;
    if (!retellCallId) return reply.send({ verified: false, message: 'Missing call id.' });

    const args = z
      .object({
        phone: z.string().min(3),
        email: z.string().optional(),
        dob: z.string().optional(),
        appointment_id: z.string().optional(),
      })
      .safeParse(req.body.args ?? {});
    if (!args.success) return reply.send({ verified: false, message: 'Ask for the phone plus one of: email, date of birth, or appointment reference.' });

    const contact = await contactService.findByPhone(client.id, args.data.phone);
    if (!contact) {
      return reply.send({ verified: false, message: 'No record matches that phone number. Confirm the number digit by digit, or take a message.' });
    }

    const settings = await clientService.getSettings(client.id);
    const custom = (contact.custom_fields as Record<string, unknown>) ?? {};
    const recordDob = String(custom.dob ?? custom.date_of_birth ?? '').trim();

    const emailMatch = Boolean(
      args.data.email && contact.email && args.data.email.trim().toLowerCase() === contact.email.trim().toLowerCase()
    );
    const dobMatch = Boolean(args.data.dob && recordDob && args.data.dob.trim() === recordDob);
    let apptMatch = false;
    if (args.data.appointment_id) {
      const { data: appt } = await supabase
        .from('appointments')
        .select('id')
        .eq('id', args.data.appointment_id)
        .eq('client_id', client.id)
        .eq('contact_id', contact.id)
        .maybeSingle();
      apptMatch = Boolean(appt);
    }

    const factors = { email: emailMatch, dob: dobMatch, appointment: apptMatch };
    const required = settings?.agent_config?.identity_verification_fields as string[] | undefined;
    const verified = required?.length
      ? required.every((f) => factors[f as keyof typeof factors])
      : emailMatch || dobMatch || apptMatch; // default: phone + one corroborating factor

    const session = await loadOrCreateSession(client, retellCallId);
    if (verified && session) {
      session.state.identityVerified = true;
      session.state.context.contactId = contact.id;
      await saveSessionState(retellCallId, session.state);
    }

    return reply.send({
      verified,
      factors,
      message: verified
        ? `Identity confirmed for ${contact.first_name || 'the caller'}. You may now access their account information.`
        : 'Those details do not match our records. Do NOT share any account information; offer to take a message or have the team follow up.',
    });
  });

  // ── set_language ──────────────────────────────────────────────────────────
  // language_selection workflow: record the caller's language preference in the
  // global conversation context. (Voice/prompt switching via Retell dynamic
  // variables plugs in here later; the preference is captured now.)
  app.post<{ Body: RetellFunctionBody }>('/functions/retell/set_language', guard, async (req, reply) => {
    const client = await resolveClient(req.body.call);
    if (!client) return reply.code(404).send({ message: 'Client not configured.' });
    const retellCallId = req.body.call?.call_id;
    if (!retellCallId) return reply.send({ ok: false, message: 'Missing call id.' });
    const args = z.object({ language: z.string().min(2) }).safeParse(req.body.args ?? {});
    if (!args.success) return reply.send({ ok: false, message: 'Ask which language they prefer.' });

    const session = await loadOrCreateSession(client, retellCallId);
    if (session) {
      session.state.context.language = args.data.language;
      await saveSessionState(retellCallId, session.state);
    }
    return reply.send({
      ok: true,
      language: args.data.language,
      message: `Continue the conversation in ${args.data.language}. Speak naturally in that language from now on.`,
    });
  });

  // ── set_location ──────────────────────────────────────────────────────────
  // multi_location_routing workflow: record the caller's chosen location in the
  // conversation context so subsequent routing/booking uses it.
  app.post<{ Body: RetellFunctionBody }>('/functions/retell/set_location', guard, async (req, reply) => {
    const client = await resolveClient(req.body.call);
    if (!client) return reply.code(404).send({ message: 'Client not configured.' });
    const retellCallId = req.body.call?.call_id;
    if (!retellCallId) return reply.send({ ok: false, message: 'Missing call id.' });
    const args = z.object({ location: z.string().min(1) }).safeParse(req.body.args ?? {});
    if (!args.success) return reply.send({ ok: false, message: 'Ask which location they need.' });

    const session = await loadOrCreateSession(client, retellCallId);
    if (session) {
      session.state.context.location = args.data.location;
      await saveSessionState(retellCallId, session.state);
    }
    return reply.send({
      ok: true,
      location: args.data.location,
      message: `Using the ${args.data.location} location for the rest of this call. Continue helping with that location's details.`,
    });
  });

  // ── emergency_flag ────────────────────────────────────────────────────────
  // Hard safety path: no routing round-trip. Flags the conversation, notifies
  // management immediately, and reiterates the predefined spoken response.
  // Staff notification must never depend on session persistence succeeding.
  app.post<{ Body: RetellFunctionBody }>('/functions/retell/emergency_flag', guard, async (req, reply) => {
    const client = await resolveClient(req.body.call);
    if (!client) return reply.code(404).send({ message: 'Client not configured.' });
    const retellCallId = req.body.call?.call_id ?? 'unknown';

    const args = z.object({ details: z.string().min(1) }).safeParse(req.body.args ?? {});
    const details = args.success ? args.data.details : 'No details provided';

    const settings = await clientService.getSettings(client.id);
    const existingCall = req.body.call?.call_id ? await callService.findByRetellId(req.body.call.call_id) : null;

    await supabase.from('staff_notifications').insert({
      client_id: client.id,
      call_id: existingCall?.id ?? null,
      type: 'escalation',
      status: 'pending',
      message: `EMERGENCY flagged on a live call: ${details}. Caller number: ${req.body.call?.from_number ?? 'unknown'}.`,
      recipient_email: settings?.notification_emails?.join(', ') ?? null,
      metadata: { kind: 'emergency', details, phone: req.body.call?.from_number },
    });
    if (settings?.notification_emails?.length) {
      await notificationsQueue.add(
        'emergency',
        {
          clientId: client.id,
          type: 'escalation',
          recipients: settings.notification_emails,
          subject: `URGENT — emergency flagged on a live call (${client.name})`,
          body: `The voice agent flagged a possible emergency.\n\nDetails: ${details}\nCaller: ${req.body.call?.from_number ?? 'unknown'}\n\nThe caller was told to contact emergency services.`,
          callId: existingCall?.id,
        },
        { jobId: buildIdempotencyKey('emergency', retellCallId) }
      );
    }

    // Flag the session + audit event; best-effort so notification always wins.
    try {
      const session = await loadOrCreateSession(client, retellCallId);
      if (session) {
        await flagEmergency(callRef(client, retellCallId, session), session.state, details);
        await saveSessionState(retellCallId, session.state);
      } else {
        await eventBus.publish({
          type: 'emergency.flagged',
          clientId: client.id,
          callId: existingCall?.id,
          payload: { retell_call_id: retellCallId, details },
          source: 'internal',
          idempotencyKey: buildIdempotencyKey('emergency-evt', retellCallId),
        });
      }
      if (existingCall) {
        await callService.upsertConversation({
          call_id: existingCall.id,
          client_id: client.id,
          contact_id: existingCall.contact_id,
          metadata: { emergency: true, emergency_details: details },
        });
      }
    } catch (err) {
      logger.error({ err, retellCallId }, 'emergency_flag: session/conversation flagging failed (staff already notified)');
    }

    return reply.send({
      flagged: true,
      message: `Management has been notified. Tell the caller: "${PREDEFINED_EMERGENCY_RESPONSE}" Do not attempt further troubleshooting or support.`,
    });
  });
}
