import type {
  AgentTemplate,
  TemplateContext,
  ResponseEngineSpec,
  AgentSpec,
  RetellToolSpec,
} from './template.types.js';
import type { ClientSettings, FAQ, PricingItem, Service, WorkingHours } from '../../../types/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Inbound ROUTING agent template (vertical-neutral). Unlike the single-prompt
// vertical templates, this agent classifies the caller's intent and hands
// control to the backend workflow engine via route_intent — the backend decides
// the workflow, tracks state, grants tool scopes, and returns conversational
// guidance. Everything client-specific is rendered from client_settings at
// provisioning time (no Retell {{dynamic_variables}}), same as med-spa.
// ─────────────────────────────────────────────────────────────────────────────

function identity(ctx: TemplateContext): { business: string; agentName: string } {
  const business = ctx.settings.business_name?.trim() || ctx.client.name?.trim() || 'our office';
  const agentName = ctx.settings.agent_name?.trim() || 'your assistant';
  return { business, agentName };
}

function renderServices(services: Service[]): string {
  if (!services.length) return 'No specific services are configured; offer to take a message or schedule a callback.';
  return services
    .map((s) => {
      const price = s.price != null ? ` (starts around $${s.price})` : '';
      const dur = s.duration_minutes ? `, ~${s.duration_minutes} min` : '';
      return `- ${s.name}${price}${dur}: ${s.description}`;
    })
    .join('\n');
}

function renderPricing(pricing: PricingItem[]): string {
  if (!pricing.length)
    return 'No set prices configured — never invent a number. Say exact pricing is confirmed by the team.';
  return pricing
    .map((p) => `- ${p.name}: starts around $${p.price}${p.unit ? `/${p.unit}` : ''}${p.notes ? ` (${p.notes})` : ''}`)
    .join('\n');
}

function renderFaqs(faqs: FAQ[]): string {
  if (!faqs.length) return 'No FAQs configured.';
  return faqs.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n');
}

function to12h(t: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return t;
  let h = Number(m[1]);
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m[2]} ${ampm}`;
}

function renderHours(hours: WorkingHours): string {
  const days: (keyof WorkingHours)[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const lines = days
    .map((d) => (hours[d] ? `- ${d[0].toUpperCase() + d.slice(1)}: ${to12h(hours[d]!.open)}–${to12h(hours[d]!.close)}` : null))
    .filter(Boolean);
  return lines.length ? lines.join('\n') : 'Hours are not configured; offer to take a message or schedule a callback.';
}

function buildSystemPrompt(ctx: TemplateContext): string {
  const { client, settings } = ctx;
  const { business, agentName } = identity(ctx);
  const tone = settings.agent_tone || 'friendly';
  const personality = settings.agent_personality || 'warm and professional';
  const policies = settings.business_policies?.length
    ? settings.business_policies.map((p) => `- ${p}`).join('\n')
    : 'No special policies configured.';
  const extra = settings.agent_prompt?.trim()
    ? `\n\nADDITIONAL CLIENT INSTRUCTIONS:\n${settings.agent_prompt.trim()}`
    : '';

  return `You are ${agentName}, the voice concierge for ${business}. Personality: ${personality}. Tone: ${tone}.

★ GUIDING PRINCIPLE — CUSTOMER EXPERIENCE FIRST ★
Make the caller feel genuinely cared for, never "processed." Be warm, natural, and unhurried. Acknowledge what they say and how they feel before moving on ("Of course—", "I understand—"). Never sound scripted or robotic. Every suggestion should feel like genuine help, never a hard sell.

★ HOW YOU TALK ON THE PHONE — apply on EVERY turn ★
- SHORT: Keep each reply to ONE or TWO short, natural sentences, then stop and let the caller talk. Never deliver a paragraph, a monologue, or a long list out loud. This is a live phone call — speak the way a real person does.
- DON'T REPEAT YOURSELF: Keep track of what you've already said, asked, and confirmed. Never restate your own earlier sentences and never re-ask a question that's already been answered. Always move the conversation forward. Only repeat something to confirm a detail back to the caller, or when they ask you to.
- YIELD INSTANTLY: The moment the caller starts speaking, stop talking and listen. Never talk over them; let them finish before you respond.
- CATCH EVERYTHING AT ONCE: If the caller gives several details in one turn (e.g., name + service + a preferred day), capture and acknowledge ALL of them, and confirm the full set back. Never ignore part of what they said, and never re-ask for something they already provided.

★ CONFIRMING A PHONE NUMBER — say each digit as a word separated by a dash, every time ★
Read each digit as its own WORD, with a dash "-" between every digit. The dash is a SILENT pause that keeps the digits from running together — keep every dash, and NEVER say the word "dash" out loud.
Example: for 9045551234, say exactly: nine - zero - four - five - five - five - one - two - three - four
NEVER group digits and NEVER say them as a number (not "nine oh four…", not "nine billion…"). After reading back, ask "Did I get that right?" and wait for confirmation before moving on.
When a tool or the backend hands you a readback string with dashes, speak it EXACTLY as given — keep every dash, do not rewrite it.

★ CONFIRMING A NAME — spell it back letter by letter separated by a dash, every time ★
Ask the caller to spell their name: "Could you spell that for me?"
Then say each letter as its own word with a dash "-" between every letter — keep every dash, never say the word "dash".
Example: for "Sarah", say exactly: S - A - R - A - H — then ask "Did I spell that correctly?" and wait.
NEVER assume you pronounced an unusual name correctly without spelling it back first.

NEVER say any text inside curly braces or any placeholder out loud. If a detail is missing, use a natural phrase instead of reading a variable.

TIMEZONE: ${client.timezone}. Assume this timezone for any times unless the caller says otherwise.

=== OPENING — your greeting already introduced you, invited them, and disclosed recording ===
Your first line greeted the caller by ${business}'s name, introduced you as ${agentName}, asked how you can help, and let them know the call is being recorded — do NOT repeat any of that. Simply listen to what they need and help.
When a task needs to know who they are (booking, an account question, looking up their history), warmly collect their name (ask them to spell it, read it back per the name rule) and best phone number (read it back DIGIT BY DIGIT per the phone rule, then have them confirm), THEN call lookup_existing_client and personalize naturally. Never reference any caller history before you have looked them up.

=== SAFETY — EMERGENCY HARD RULE; check FIRST, every turn; overrides everything ===
If the caller describes a medical emergency, a threat, or immediate danger, IMMEDIATELY say exactly: "If this is a medical emergency or you are in immediate danger, please hang up and dial 9-1-1 or your local emergency number right now." Then call the emergency_flag tool with a short description. Do NOT route, troubleshoot, or attempt normal support.

=== HOW YOU HELP — quietly routed by the backend (the caller never hears this) ===
Once you understand what the caller needs, the backend guides you step by step — the caller should experience a single warm, seamless conversation, never a menu or a hand-off.
1. CLASSIFY: as soon as you understand the need, call route_intent with a short intent label (e.g. book_appointment, reschedule_appointment, cancel_appointment, faq, pricing, promotions, lead_qualification, callback_request, complaint, staff_transfer, membership, payment_questions, end_call).
2. FOLLOW THE CONTRACT: route_intent returns the current step, which details are still missing, and guidance. Collect the missing details conversationally and naturally — confirm names and phone numbers per the readback rules above — then report them with update_workflow (slots). When the backend hands you a "readback" string, speak it verbatim to confirm.
3. ADVANCE with update_workflow (transition_to) when the guidance says to move on. THE BACKEND PERFORMS THE ACTION FOR YOU — for booking, waitlisting, and lead capture you do NOT call a separate tool; when you transition to the step the guidance names (e.g. "execute"), the backend does it and returns the confirmation for you to speak warmly. Never call book_appointment/book_consultation/qualify_lead/waitlist_add yourself.
4. TOPIC SWITCH: if the caller changes subject, call route_intent again with the new intent — the backend pauses the current task and brings it back automatically. Never abandon a task silently.
5. STAY IN YOUR LANE: only use tools the backend granted. If a tool answers "denied", call route_intent with the caller's current intent and continue from its guidance.
6. NEVER invent facts, services, prices, or availability. For factual questions (hours, prices, policies, offers), call knowledge_search and answer ONLY from its results. If you truly can't help, offer a callback (schedule_callback) or take a message (leave_staff_message) — never blame "the system."

=== WHAT YOU CAN OFFER — STRICT ===
The SERVICES list below is the COMPLETE and ONLY set of services ${business} offers. Only discuss, recommend, or book something on that list. If a caller asks about something not listed, warmly say it's not something you offer and steer them to the closest listed service or offer to take a message. If unsure, treat it as NOT offered.

=== CLOSING — end gracefully, never abruptly ===
When the caller is done, call route_intent with intent "end_call". Recap anything accomplished (booked, message taken, callback scheduled) plus any prep or policy note, then ask "Is there anything else I can help you with today?" — PAUSE and let them answer. Only when they confirm they're all set, give a warm, unhurried goodbye, then END THE CALL with the end_call tool. Never hang up mid-sentence or while the caller is still talking.

=== SERVICES (the ONLY services you may discuss or book) ===
${renderServices(settings.services)}

=== PRICING (starting points; exact price confirmed by the team; never invent a number) ===
${renderPricing(settings.pricing)}

=== HOURS ===
${renderHours(settings.booking_rules?.working_hours ?? {})}

=== POLICIES ===
${policies}

=== FAQs ===
${renderFaqs(settings.faqs)}

=== TOOLS ===
Use your tools rather than guessing. route_intent (classify/switch topic), update_workflow (report details, advance, finish), emergency_flag (emergencies ONLY), knowledge_search (hours, prices, policies, offers), lookup_existing_client (only after identification), check_availability, find_appointment, reschedule_appointment, cancel_appointment, verify_identity (before any account info), membership_lookup, payment_lookup, documentation_request, create_complaint, set_language, set_location, schedule_callback, leave_staff_message, request_human_handoff. Never read internal IDs or raw data aloud.${extra}`;
}

function buildBeginMessage(ctx: TemplateContext): string {
  const { business, agentName } = identity(ctx);
  // Introduce, invite, and disclose recording — all spoken in the first turn
  // before the caller replies, so the recording disclosure is always heard.
  return `Thank you for calling ${business}, this is ${agentName}. How can I help you today? And just so you know, this call is being recorded.`;
}

function buildTools(ctx: TemplateContext, settings: ClientSettings): RetellToolSpec[] {
  const u = (name: RetellToolSpec['name']) => `${ctx.functionBaseUrl}/${name}`;
  const qualFields = settings.booking_rules?.lead_qualification_fields ?? [];
  const qualProps: Record<string, unknown> = {
    name: { type: 'string', description: "Caller's full name" },
    phone: { type: 'string', description: "Caller's phone number" },
    email: { type: 'string', description: "Caller's email if provided" },
    service_interest: { type: 'string', description: 'Service they are interested in' },
  };
  for (const f of qualFields) {
    if (!qualProps[f]) qualProps[f] = { type: 'string', description: `Lead qualification field: ${f}` };
  }

  const specs: Omit<RetellToolSpec, 'url'>[] = [
    {
      name: 'route_intent',
      description:
        "Tell the backend what the caller wants. Call as soon as you understand their intent, and again whenever the topic changes. Returns the workflow to follow: its current step, missing details, and guidance.",
      speak_during_execution: false,
      parameters: {
        type: 'object',
        properties: {
          intent: {
            type: 'string',
            description:
              'Short snake_case intent label, e.g. book_appointment, reschedule_appointment, cancel_appointment, faq, pricing, promotions, lead_qualification, callback_request, complaint, staff_transfer, membership, payment_questions, end_call',
          },
        },
        required: ['intent'],
      },
    },
    {
      name: 'update_workflow',
      description:
        'Report progress on the active workflow: send collected details (slots), request the next step (transition_to), finish it (complete_outcome), or abandon it (cancel). The backend validates everything and answers with what to do next.',
      speak_during_execution: false,
      parameters: {
        type: 'object',
        properties: {
          slots: { type: 'object', description: 'Collected detail values keyed by slot name' },
          transition_to: { type: 'string', description: 'State to move to, when the guidance says so' },
          complete_outcome: { type: 'string', description: 'Outcome label when the workflow goal is done' },
          cancel: { type: 'boolean', description: 'True to abandon the active workflow' },
        },
      },
    },
    {
      name: 'emergency_flag',
      description:
        'EMERGENCIES ONLY: medical emergency, threat, or immediate danger. Notifies management instantly. Deliver the emergency-services response FIRST, then call this.',
      speak_during_execution: true,
      parameters: {
        type: 'object',
        properties: { details: { type: 'string', description: 'Short description of the emergency' } },
        required: ['details'],
      },
    },
    {
      name: 'knowledge_search',
      description:
        "Search this business's knowledge base (FAQs, services, pricing, active promotions) for the caller's factual question. Answer only from the results.",
      speak_during_execution: false,
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: "The caller's question in their own words" },
          topic: { type: 'string', description: 'Optional topic hint: promotions | pricing | faq' },
        },
        required: ['query'],
      },
    },
    {
      name: 'lookup_existing_client',
      description: 'Look up the caller AFTER collecting and confirming their name and phone. Returns their history so you can personalize.',
      speak_during_execution: false,
      parameters: {
        type: 'object',
        properties: {
          phone: { type: 'string', description: "Caller's confirmed phone number" },
          name: { type: 'string', description: "Caller's confirmed name" },
        },
        required: ['phone'],
      },
    },
    {
      name: 'check_availability',
      description: 'Check open appointment slots for a given date (and optional service). Call before offering times.',
      speak_during_execution: true,
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Date to check, YYYY-MM-DD' },
          service_type: { type: 'string', description: 'Service name (optional)' },
        },
        required: ['date'],
      },
    },
    {
      name: 'qualify_lead',
      description: 'Record a qualified lead once you have their name, contact, and service interest.',
      speak_during_execution: false,
      parameters: { type: 'object', properties: qualProps, required: ['name', 'phone', 'service_interest'] },
    },
    {
      name: 'book_appointment',
      description: 'Book a specific service appointment at a confirmed time. Confirm details out loud first.',
      speak_during_execution: true,
      parameters: {
        type: 'object',
        properties: {
          contact_name: { type: 'string' },
          phone: { type: 'string' },
          service_type: { type: 'string', description: 'Service being booked' },
          start_time: { type: 'string', description: 'Appointment start, ISO 8601' },
          notes: { type: 'string' },
        },
        required: ['contact_name', 'phone', 'service_type', 'start_time'],
      },
    },
    {
      name: 'book_consultation',
      description: 'Book an exploratory consultation for callers who are unsure what they need.',
      speak_during_execution: true,
      parameters: {
        type: 'object',
        properties: {
          contact_name: { type: 'string' },
          phone: { type: 'string' },
          service_interest: { type: 'string' },
          start_time: { type: 'string', description: 'Consultation start, ISO 8601' },
          notes: { type: 'string' },
        },
        required: ['contact_name', 'phone', 'start_time'],
      },
    },
    {
      name: 'find_appointment',
      description: "Look up the caller's upcoming appointments by their confirmed phone number (for reschedule, cancel, or inquiry).",
      speak_during_execution: false,
      parameters: {
        type: 'object',
        properties: { phone: { type: 'string', description: "Caller's confirmed phone number" } },
        required: ['phone'],
      },
    },
    {
      name: 'reschedule_appointment',
      description: 'Move an existing appointment to a new confirmed time. Use find_appointment first; confirm the new time out loud.',
      speak_during_execution: true,
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string', description: 'Appointment id from find_appointment' },
          new_start_time: { type: 'string', description: 'New start, ISO 8601' },
          reason: { type: 'string' },
        },
        required: ['appointment_id', 'new_start_time'],
      },
    },
    {
      name: 'cancel_appointment',
      description: 'Cancel an existing appointment. Use find_appointment first. If the response includes a cancellation policy, read it to the caller exactly.',
      speak_during_execution: true,
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string', description: 'Appointment id from find_appointment' },
          reason: { type: 'string' },
        },
        required: ['appointment_id'],
      },
    },
    {
      name: 'waitlist_add',
      description: 'Add the caller to the waitlist when no suitable time is available, with their preferred days/times.',
      speak_during_execution: false,
      parameters: {
        type: 'object',
        properties: {
          caller_name: { type: 'string' },
          phone: { type: 'string' },
          service: { type: 'string' },
          preferred_days: { type: 'array', items: { type: 'string' }, description: 'Days that work, lowercase names' },
          preferred_times: { type: 'string', description: '"mornings", "after 5pm", …' },
          notes: { type: 'string' },
        },
        required: ['caller_name', 'phone'],
      },
    },
    {
      name: 'forms_send',
      description: 'Send the caller their intake/consent forms (by email at launch). Collect their email first when possible.',
      speak_during_execution: false,
      parameters: {
        type: 'object',
        properties: {
          caller_name: { type: 'string' },
          phone: { type: 'string' },
          email: { type: 'string', description: "Caller's email address" },
          form_type: { type: 'string', description: 'intake | consent | other' },
          service: { type: 'string', description: 'The service the forms are for' },
        },
        required: ['caller_name', 'phone'],
      },
    },
    {
      name: 'schedule_callback',
      description: 'Schedule a callback from a staff member when the caller prefers a person to call them, or when another function is unavailable.',
      speak_during_execution: false,
      parameters: {
        type: 'object',
        properties: {
          caller_name: { type: 'string' },
          phone: { type: 'string' },
          preferred_time: { type: 'string', description: 'Preferred callback time, if given' },
          topic: { type: 'string', description: 'What the callback is about' },
        },
        required: ['caller_name', 'phone'],
      },
    },
    {
      name: 'leave_staff_message',
      description: 'Capture a message for staff when the caller wants to leave a note for the team.',
      speak_during_execution: false,
      parameters: {
        type: 'object',
        properties: {
          caller_name: { type: 'string' },
          phone: { type: 'string' },
          message: { type: 'string' },
          urgency: { type: 'string', description: 'low | normal | high' },
        },
        required: ['caller_name', 'phone', 'message'],
      },
    },
    {
      name: 'request_human_handoff',
      description: 'Escalate to a human for complaints, disputes, medical questions, on request, or low confidence.',
      speak_during_execution: true,
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Why a human is needed' },
          phone: { type: 'string' },
        },
        required: ['reason'],
      },
    },
    {
      name: 'verify_identity',
      description: "Verify the caller before exposing account information. Collect their phone plus one factor (email, date of birth, or an appointment reference).",
      speak_during_execution: false,
      parameters: {
        type: 'object',
        properties: {
          phone: { type: 'string', description: "Caller's phone number" },
          email: { type: 'string', description: 'Email on file, if given' },
          dob: { type: 'string', description: 'Date of birth, if given' },
          appointment_id: { type: 'string', description: 'Appointment reference, if given' },
        },
        required: ['phone'],
      },
    },
    {
      name: 'membership_lookup',
      description: 'Look up membership/loyalty details for a VERIFIED caller. Share general benefits; specifics go to staff.',
      speak_during_execution: false,
      parameters: {
        type: 'object',
        properties: {
          phone: { type: 'string' },
          question: { type: 'string', description: 'What they want to know' },
        },
        required: ['phone'],
      },
    },
    {
      name: 'payment_lookup',
      description: 'Explain payment/financing/deposit options for a VERIFIED caller; account-specific balances are routed to billing staff.',
      speak_during_execution: false,
      parameters: {
        type: 'object',
        properties: {
          phone: { type: 'string' },
          topic: { type: 'string', description: 'financing | deposit | balance | refund' },
        },
        required: ['phone'],
      },
    },
    {
      name: 'documentation_request',
      description: 'Log a document request (receipt, invoice, records, consent form) for a VERIFIED caller. Medical records are request-only, never read aloud.',
      speak_during_execution: false,
      parameters: {
        type: 'object',
        properties: {
          phone: { type: 'string' },
          document_type: { type: 'string', description: 'receipt | invoice | medical records | consent form' },
          details: { type: 'string' },
        },
        required: ['phone', 'document_type'],
      },
    },
    {
      name: 'create_complaint',
      description: 'Log a caller complaint as a ticket and escalate to a manager. Empathize; never be defensive.',
      speak_during_execution: false,
      parameters: {
        type: 'object',
        properties: {
          caller_name: { type: 'string' },
          phone: { type: 'string' },
          issue: { type: 'string', description: 'What went wrong' },
          urgency: { type: 'string', description: 'low | normal | high | urgent' },
        },
        required: ['caller_name', 'phone', 'issue'],
      },
    },
    {
      name: 'set_language',
      description: 'Record the caller\'s preferred language and continue speaking in it.',
      speak_during_execution: false,
      parameters: {
        type: 'object',
        properties: { language: { type: 'string', description: 'e.g. English, Spanish' } },
        required: ['language'],
      },
    },
    {
      name: 'set_location',
      description: 'Record which location the caller wants so later routing and booking use it.',
      speak_during_execution: false,
      parameters: {
        type: 'object',
        properties: { location: { type: 'string', description: 'Location name or area' } },
        required: ['location'],
      },
    },
  ];
  return specs.map((s) => ({ ...s, url: u(s.name) }));
}

export const inboundRoutingTemplate: AgentTemplate = {
  vertical: 'inbound_routing',
  build(ctx: TemplateContext): { responseEngine: ResponseEngineSpec; agent: AgentSpec } {
    const { business, agentName } = identity(ctx);
    const responseEngine: ResponseEngineSpec = {
      model: 'gpt-4.1',
      general_prompt: buildSystemPrompt(ctx),
      begin_message: buildBeginMessage(ctx),
      general_tools: buildTools(ctx, ctx.settings),
    };
    const agent: AgentSpec = {
      agent_name: `${business} — ${agentName} (Inbound Routing)`,
      voice_id: ctx.client.retell_voice_id ?? ctx.defaultVoiceId,
      language: 'en-US',
      pronunciation_dictionary: ctx.settings.agent_config?.pronunciation_dictionary,
      // Same pacing/hangup posture as the med-spa template (see its comments).
      responsiveness: 0.85,
      interruption_sensitivity: 0.95,
      enable_backchannel: true,
      begin_message_delay_ms: 600,
      end_call_after_silence_ms: 10000,
      reminder_trigger_ms: 5000,
      reminder_max_count: 1,
    };
    return { responseEngine, agent };
  },
};
