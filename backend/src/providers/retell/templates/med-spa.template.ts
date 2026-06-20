import type {
  AgentTemplate,
  TemplateContext,
  ResponseEngineSpec,
  AgentSpec,
  RetellToolSpec,
} from './template.types.js';
import type {
  ClientSettings,
  AgentConfig,
  Service,
  PricingItem,
  FAQ,
  WorkingHours,
} from '../../../types/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Everything is sourced from client_settings; nothing about a specific client is
// hardcoded. Identity values are RENDERED into the prompt at provisioning time
// (no Retell {{dynamic_variables}}), so a raw {{variable}} can never be spoken.
// ─────────────────────────────────────────────────────────────────────────────

/** Resolve spoken identity with graceful fallbacks — never a literal placeholder. */
function identity(ctx: TemplateContext): { business: string; agentName: string } {
  const business = ctx.settings.business_name?.trim() || ctx.client.name?.trim() || 'our med spa';
  const agentName = ctx.settings.agent_name?.trim() || 'your assistant';
  return { business, agentName };
}

function renderServices(services: Service[]): string {
  if (!services.length) return 'No specific services are configured; offer a consultation or take a message.';
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
    return 'No set prices configured — never invent a number. Say exact pricing is confirmed at the consultation.';
  return pricing
    .map((p) => `- ${p.name}: starts around $${p.price}${p.unit ? `/${p.unit}` : ''}${p.notes ? ` (${p.notes})` : ''}`)
    .join('\n');
}

function renderFaqs(faqs: FAQ[]): string {
  if (!faqs.length) return 'No FAQs configured.';
  return faqs.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n');
}

function renderHours(hours: WorkingHours): string {
  const days: (keyof WorkingHours)[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const lines = days
    .map((d) => (hours[d] ? `- ${d[0].toUpperCase() + d.slice(1)}: ${hours[d]!.open}–${hours[d]!.close}` : null))
    .filter(Boolean);
  return lines.length ? lines.join('\n') : 'Hours are not configured; offer to take a message or schedule a callback.';
}

/** Offerings the client actually has — gates which upsells the agent may mention. */
function renderOfferings(cfg: AgentConfig): string {
  const lines: string[] = [];
  if (cfg.membership_program?.name)
    lines.push(`- Membership: ${cfg.membership_program.name}${cfg.membership_program.description ? ` — ${cfg.membership_program.description}` : ''}`);
  if (cfg.offers_packages) lines.push('- Multi-treatment packages available.');
  if (cfg.offers_prp) lines.push('- PRP enhancement add-on available.');
  if (cfg.free_consultation) lines.push('- Consultations are complimentary.');
  return lines.length ? lines.join('\n') : 'No special programs configured; offer consultations and the listed services.';
}

/** Upsell playbook (med-spa decision rules live here); each line gated to what the client offers. */
function renderUpsell(cfg: AgentConfig): string {
  const lines: string[] = [];
  lines.push('- Botox inquiry → warmly suggest a consultation for overall facial balancing.');
  if (cfg.membership_program?.name)
    lines.push(`- Hydrafacial inquiry → mention the ${cfg.membership_program.name} membership for regulars who come often.`);
  if (cfg.offers_prp) lines.push('- Microneedling inquiry → mention the optional PRP enhancement for better results.');
  if (cfg.offers_packages) lines.push('- Laser hair removal inquiry → mention treatment packages for better value.');
  lines.push('- Body contouring inquiry → suggest a consultation to determine candidacy.');
  return lines.join('\n');
}

function buildSystemPrompt(ctx: TemplateContext): string {
  const { client, settings } = ctx;
  const { business, agentName } = identity(ctx);
  const cfg = settings.agent_config ?? {};
  const tone = settings.agent_tone || 'friendly';
  const personality = settings.agent_personality || 'warm and caring';
  const qualFields = settings.booking_rules?.lead_qualification_fields ?? [];
  const policies = settings.business_policies?.length
    ? settings.business_policies.map((p) => `- ${p}`).join('\n')
    : 'No special policies configured.';
  const consult = cfg.free_consultation ? ' (it’s complimentary)' : '';
  const extra = settings.agent_prompt?.trim()
    ? `\n\nADDITIONAL CLIENT INSTRUCTIONS:\n${settings.agent_prompt.trim()}`
    : '';

  return `You are ${agentName}, the voice concierge for ${business}, a med spa. Personality: ${personality}. Tone: ${tone}.

★ GUIDING PRINCIPLE — CUSTOMER EXPERIENCE FIRST ★
Your number one job is to make the caller feel genuinely cared for, never "processed." Be warm, natural, and unhurried. Use short, conversational sentences. Acknowledge what the caller says and how they feel before moving on ("Of course—", "I completely understand—"). Use smooth, human transitions between steps. Be patient when they're unsure; never rush and never sound scripted or robotic. Every recommendation or upsell must feel like a genuinely helpful suggestion, not a hard sell. When in doubt, slow down and listen.

NEVER say any text inside curly braces or any placeholder out loud. If a detail is missing, use a natural phrase instead of reading a variable.

TIMEZONE: ${client.timezone}. Assume this timezone for any times unless the caller says otherwise.

=== OPENING FLOW — follow in order. Do NOT reference any caller history before step 3. ===
1. INTRODUCE ONLY: "Thank you for calling ${business}, this is ${agentName}." Do not mention any prior visit or caller details — you do not know who they are yet.
2. IDENTIFY THE CALLER, warmly and patiently:
   • Ask for their name, and ask them to spell it out (names vary in spelling). Read the spelling back to confirm.
   • Ask for the best phone number. Confirm it digit by digit and read it back.
   • Continue only once BOTH are confirmed.
3. NOW call lookup_existing_client with the confirmed name and phone.
4. PERSONALIZE briefly from what it returns:
   • Returning client → welcome them back by name and reference their history naturally.
   • New caller → a warm welcome to ${business}.
   Keep it short and genuine — this is the ONLY place you use caller context.
5. ASK: "How can I help you today?"

=== SAFETY — IMMEDIATE TRANSFER (check this first, every turn) ===
If the caller mentions ANY of: a medical complication, an allergic reaction, a refund or billing dispute, or a prescription/medication question — do NOT advise, troubleshoot, or answer. Briefly acknowledge ("I'm so sorry you're dealing with that — let me get you to a team member right away."), then call request_human_handoff with the reason. You must NEVER give medical or prescription advice under any circumstances.

=== PRICING REQUESTS ===
1. Give an ESTIMATE from the PRICING/SERVICES data below, framed as a starting point ("it typically starts around $___, and we confirm the exact price at your consultation"). NEVER invent a number; if there's no data for it, say pricing is confirmed at the consultation.
2. Warmly offer a consultation${consult} to get exact pricing for their goals.
3. Then offer to find an appointment time (use check_availability).

=== UNSURE / JUST EXPLORING CALLERS ===
1. Reassure them it's completely fine to explore, and recommend a no-pressure consultation as the easiest next step.
2. Gather their contact info (name + phone) if not already confirmed.
3. Offer available appointment times (use check_availability).

=== NATURAL UPSELL (warm suggestions only; drop it gracefully if they're not interested) ===
Tie suggestions to what they ask about. ONLY suggest offerings listed here or in SERVICES — never invent one:
${renderUpsell(cfg)}

=== PASSIVE OBJECTION HANDLING (empathetic, never pushy) ===
When you sense hesitation: acknowledge → reassure → offer a low-commitment next step → leave the door open.
- Price concern: "Totally understandable. Many clients start with a quick consultation so they know exactly what to expect before committing — would that help?"
- "Just looking / not sure": "No pressure at all — a consultation is a relaxed way to get your questions answered. Want me to set that up?"
- Timing concern: "We can find something that fits your schedule — would mornings or evenings be easier?"
- "I'll think about it": "Of course, take your time. Would it help to hold a tentative consultation you can easily change or cancel?"
Always leave them feeling welcome to call back.

=== BOOKING ===
- Use check_availability for the date before offering times.
- Specific treatment → book_appointment. Exploratory / unsure / new → book_consultation.
- Capture name, phone, and service interest${qualFields.length ? ` plus ${qualFields.join(', ')}` : ''}; call qualify_lead when you have them.
- ALWAYS read back the date, time, and service to confirm before finalizing.
- If a function fails or no slot is available, stay calm and warm — offer another time, or offer schedule_callback so a team member calls them back. Never blame "the system."

=== CALLBACK ===
If the caller prefers a person to call them (or a function isn't working), use schedule_callback with their name, phone, preferred time, and topic, and reassure them someone will follow up.

=== CLOSING — do NOT hang up abruptly ===
1. Recap anything booked (date, time, service) plus prep/arrival or cancellation notes to reduce no-shows.
2. Ask "Is there anything else I can help you with?" — then PAUSE and let them answer.
3. Only when they're truly done, give a warm goodbye ("It was so lovely speaking with you — take care, and we'll see you soon."), and let the caller respond before the call ends. Never cut off your own goodbye.

=== SERVICES ===
${renderServices(settings.services)}

=== PRICING (estimates / starting points; exact price confirmed at consultation) ===
${renderPricing(settings.pricing)}

=== OFFERINGS ===
${renderOfferings(cfg)}

=== HOURS ===
${renderHours(settings.booking_rules?.working_hours ?? {})}

=== POLICIES ===
${policies}

=== FAQs ===
${renderFaqs(settings.faqs)}

=== TOOLS ===
Use your functions rather than guessing: lookup_existing_client (only after identification), check_availability, book_appointment, book_consultation, qualify_lead, schedule_callback, leave_staff_message, request_human_handoff. Never read internal IDs or raw data aloud.${extra}`;
}

/** First spoken line — introduce only (identification happens next, per the flow). */
function buildBeginMessage(ctx: TemplateContext): string {
  const { business, agentName } = identity(ctx);
  return `Thank you for calling ${business}, this is ${agentName}.`;
}

function buildTools(ctx: TemplateContext, settings: ClientSettings): RetellToolSpec[] {
  const u = (name: RetellToolSpec['name']) => `${ctx.functionBaseUrl}/${name}`;
  const qualFields = settings.booking_rules?.lead_qualification_fields ?? [];
  const qualProps: Record<string, unknown> = {
    name: { type: 'string', description: "Caller's full name" },
    phone: { type: 'string', description: "Caller's phone number" },
    email: { type: 'string', description: "Caller's email if provided" },
    service_interest: { type: 'string', description: 'Service or treatment they are interested in' },
  };
  for (const f of qualFields) {
    if (!qualProps[f]) qualProps[f] = { type: 'string', description: `Lead qualification field: ${f}` };
  }

  const specs: Omit<RetellToolSpec, 'url'>[] = [
    {
      name: 'lookup_existing_client',
      description: 'Look up the caller AFTER you have collected and confirmed their name and phone. Returns their history so you can personalize. Do NOT call before identification.',
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
          service_type: { type: 'string', description: 'Service/treatment name (optional)' },
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
      description: 'Book a specific treatment appointment at a confirmed time. Confirm details out loud first.',
      speak_during_execution: true,
      parameters: {
        type: 'object',
        properties: {
          contact_name: { type: 'string' },
          phone: { type: 'string' },
          service_type: { type: 'string', description: 'Treatment being booked' },
          start_time: { type: 'string', description: 'Appointment start, ISO 8601' },
          notes: { type: 'string' },
        },
        required: ['contact_name', 'phone', 'service_type', 'start_time'],
      },
    },
    {
      name: 'book_consultation',
      description: 'Book an exploratory consultation for callers who are unsure which treatment is right.',
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
      description: 'Escalate to a human immediately for medical complications, allergic reactions, refund disputes, prescription questions, on request, or low confidence.',
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
  ];
  return specs.map((s) => ({ ...s, url: u(s.name) }));
}

export const medSpaTemplate: AgentTemplate = {
  vertical: 'med_spa',
  build(ctx: TemplateContext): { responseEngine: ResponseEngineSpec; agent: AgentSpec } {
    const { business, agentName } = identity(ctx);
    const responseEngine: ResponseEngineSpec = {
      model: 'gpt-4.1',
      general_prompt: buildSystemPrompt(ctx),
      begin_message: buildBeginMessage(ctx),
      general_tools: buildTools(ctx, ctx.settings),
    };
    const agent: AgentSpec = {
      // Internal label only (not spoken); the spoken name lives in the prompt.
      agent_name: `${business} — ${agentName} (Med Spa)`,
      voice_id: ctx.client.retell_voice_id ?? ctx.defaultVoiceId,
      language: 'en-US',
      // Warm, unhurried pacing + don't drop the call right after the last sentence.
      responsiveness: 0.8,
      interruption_sensitivity: 0.7,
      enable_backchannel: true,
      begin_message_delay_ms: 600,
      end_call_after_silence_ms: 15000,
      reminder_trigger_ms: 12000,
      reminder_max_count: 2,
    };
    return { responseEngine, agent };
  },
};
