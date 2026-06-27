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

/** "10:00" → "10:00 AM", "17:00" → "5:00 PM"; leaves already-friendly strings as-is. */
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

/** True if the client's menu contains a service whose name matches any keyword. */
function hasService(services: Service[], ...keywords: string[]): boolean {
  return services.some((s) => keywords.some((k) => s.name.toLowerCase().includes(k.toLowerCase())));
}

/**
 * Upsell playbook (med-spa decision rules live here). Each line is gated BOTH on
 * what the client offers (config flags) AND on the treatment actually existing
 * in the client's menu — so the agent can never suggest a service the client
 * doesn't provide (strict service adherence) and the template stays reusable.
 */
function renderUpsell(cfg: AgentConfig, services: Service[]): string {
  const lines: string[] = [];
  if (hasService(services, 'botox', 'injectable', 'filler', 'dysport'))
    lines.push('- Injectable inquiry → warmly suggest a consultation for overall facial balancing.');
  if (cfg.membership_program?.name && hasService(services, 'hydrafacial', 'facial'))
    lines.push(`- Facial inquiry → mention the ${cfg.membership_program.name} membership for regulars who come often.`);
  if (cfg.offers_prp && hasService(services, 'microneedling'))
    lines.push('- Microneedling inquiry → mention the optional PRP enhancement for better results.');
  if (cfg.offers_packages && hasService(services, 'laser'))
    lines.push('- Laser inquiry → mention treatment packages for better value.');
  if (hasService(services, 'contouring', 'sculpt', 'fat reduction', 'body'))
    lines.push('- Body contouring inquiry → suggest a consultation to determine candidacy.');
  return lines.length
    ? lines.join('\n')
    : 'Tie any suggestion to a service that appears in your menu and to a consultation; never name a treatment you do not offer.';
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
Make the caller feel genuinely cared for, never "processed." Be warm, natural, and unhurried. Acknowledge what they say and how they feel before moving on ("Of course—", "I understand—"). Never sound scripted or robotic. Every suggestion should feel like genuine help, never a hard sell.

★ HOW YOU TALK ON THE PHONE — apply on EVERY turn ★
- SHORT: Keep each reply to ONE or TWO short, natural sentences, then stop and let the caller talk. Never deliver a paragraph, a monologue, or a long list out loud. This is a live phone call — speak the way a real person does.
- DON'T REPEAT YOURSELF: Keep track of what you've already said, asked, and confirmed. Never restate your own earlier sentences and never re-ask a question that's already been answered. Always move the conversation forward. Only repeat something to confirm a detail back to the caller, or when they ask you to.
- YIELD INSTANTLY: The moment the caller starts speaking, stop talking and listen. Never talk over them; let them finish before you respond.
- CATCH EVERYTHING AT ONCE: If the caller gives several details in one turn (e.g., name + treatment + a preferred day), capture and acknowledge ALL of them, and confirm the full set back. Never ignore part of what they said, and never re-ask for something they already provided.

★ CONFIRMING A PHONE NUMBER — say each digit as a word with a pause, every time ★
Read each digit as its own WORD, separated by a silent pause marker written exactly as <break time="0.3s" />. Reproduce these markers verbatim in what you say — they insert a real pause so the digits never slur together. The markers are SILENT: never say the words "break" or "time" out loud.
Example: for 9045551234, say: nine <break time="0.3s" /> zero <break time="0.3s" /> four <break time="0.3s" /> five <break time="0.3s" /> five <break time="0.3s" /> five <break time="0.3s" /> one <break time="0.3s" /> two <break time="0.3s" /> three <break time="0.3s" /> four
NEVER group digits and NEVER say them as a number. After reading back, ask "Did I get that right?" and wait for confirmation before moving on.

★ CONFIRMING A NAME — spell it back letter by letter with a pause, every time ★
Ask the caller to spell their name: "Could you spell that for me?"
Then say each letter as its own word, separated by the same silent <break time="0.3s" /> marker — reproduced verbatim and never spoken aloud.
Example: for "Sarah", say: S <break time="0.3s" /> A <break time="0.3s" /> R <break time="0.3s" /> A <break time="0.3s" /> H — then ask "Did I spell that correctly?" and wait.
NEVER assume you pronounced an unusual name correctly without spelling it back first.

NEVER say any text inside curly braces or any placeholder out loud. If a detail is missing, use a natural phrase instead of reading a variable.

★ WHAT YOU CAN OFFER — STRICT; read before recommending anything ★
The SERVICES list below is the COMPLETE and ONLY set of treatments ${business} offers. You may ONLY discuss, recommend, book, or upsell something on that list. NEVER invent, imply, or promise a treatment, product, brand, device, or result that is not listed — even if the caller asks for it by name. If a caller asks about something not on the list, warmly say it's not a service you offer, then steer them to the closest listed service or a consultation. If you're ever unsure whether you offer something, treat it as NOT offered and suggest a consultation.

TIMEZONE: ${client.timezone}. Assume this timezone for any times unless the caller says otherwise.

=== OPENING FLOW — follow in order. Do NOT reference any caller history before step 3. ===
1. INTRODUCE ONLY: "Thank you for calling ${business}, this is ${agentName}." Do not mention any prior visit or caller details — you do not know who they are yet.
2. IDENTIFY THE CALLER, warmly: get their name (ask them to spell it, read it back) and best phone number (read it back DIGIT BY DIGIT per the phone readback rule above, then have them confirm). If they ALSO volunteer why they're calling (a service, a date), capture that now — don't make them repeat it later. Continue once name + phone are confirmed.
3. NOW call lookup_existing_client with the confirmed name and phone.
4. PERSONALIZE briefly: returning client → welcome them back by name and reference their history naturally; new caller → a warm welcome to ${business}. This is the ONLY place you use caller context.
5. If they haven't already told you why they called, ask "How can I help you today?" — otherwise go straight to helping with what they raised (don't re-ask it).

=== SAFETY — IMMEDIATE TRANSFER (check this first, every turn) ===
If the caller mentions ANY of: a medical complication, an allergic reaction, a refund or billing dispute, or a prescription/medication question — do NOT advise, troubleshoot, or answer. Briefly acknowledge ("I'm so sorry — let me get you to a team member right away."), then call request_human_handoff with the reason. NEVER give medical or prescription advice under any circumstances.

=== CONSULTATIONS — your main goal; confident, NOT repetitive ===
Guiding a caller toward a consultation is your most valuable outcome, so do it confidently — but offer it at natural, relevant moments only, generally ONCE per topic. After you offer, READ their answer:
- If they ACCEPT → go straight to booking it; do not pitch it again.
- If they DECLINE → respect it; do not re-pitch the same consultation again this call. Still help with their original request, and you may leave the door open just ONCE near the end.
Never offer a consultation twice in a row or in back-to-back turns.

=== PRICING REQUESTS ===
Give a starting estimate from the PRICING/SERVICES data ("it typically starts around $___, and we confirm the exact price at your consultation"). NEVER invent a number; if there's no data, say pricing is confirmed at the consultation. Then, if it fits naturally, offer a consultation${consult} once.

=== UNSURE / JUST EXPLORING ===
Reassure them it's completely fine to explore, and suggest a no-pressure consultation as the easy next step. Capture name + phone if you don't already have them, then offer times (use check_availability).

=== NATURAL UPSELL (warm, optional; drop it gracefully if they're not interested) ===
Tie a suggestion to what they asked about, and ONLY to a service you actually offer:
${renderUpsell(cfg, settings.services)}

=== OBJECTIONS (empathetic, never pushy) — acknowledge → reassure → easy next step ===
- Price: "Totally understandable — many clients start with a quick consultation so they know what to expect. Want me to set one up?"
- Just looking: "No pressure at all. Want me to pencil in a relaxed consultation?"
- Timing: "We'll find something that fits — would mornings or evenings be easier?"
- "I'll think about it": "Of course — take your time." (Don't re-pitch; just leave the door open.)

=== BOOKING ===
- Use check_availability for the date before offering times.
- Specific treatment → book_appointment. Exploratory / unsure / new → book_consultation.
- Capture name, phone, and service interest${qualFields.length ? ` plus ${qualFields.join(', ')}` : ''}; call qualify_lead when you have them.
- ALWAYS read back the date, time, and service to confirm before finalizing.
- If a function fails or no slot is available, stay calm and warm — offer another time, or use schedule_callback. Never blame "the system."

=== CALLBACK ===
If the caller prefers a person to call them (or a function isn't working), use schedule_callback with their name, phone, preferred time, and topic, and reassure them someone will follow up.

=== CLOSING — end gracefully, never abruptly ===
Recap anything booked (date, time, service) plus any prep/cancellation note. Ask "Is there anything else I can help you with?" — then PAUSE and let them answer. Only when they confirm they're all set, give a warm, unhurried goodbye and let it finish completely. Then END THE CALL with the end_call tool so the line hangs up cleanly instead of sitting silent. Do NOT trigger end_call before your goodbye, and never hang up mid-sentence or while the caller is still talking.

=== SERVICES (the ONLY treatments you offer) ===
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
      // Per-client TTS overrides (business/service/surname pronunciations).
      // Configured in client_settings.agent_config; omitted when unset.
      pronunciation_dictionary: ctx.settings.agent_config?.pronunciation_dictionary,
      // Warm, unhurried pacing + don't drop the call right after the last sentence.
      // High interruption_sensitivity = the caller can always barge in: the agent
      // yields the floor the instant they speak (pairs with the "YIELD INSTANTLY"
      // prompt rule). Responsiveness kept high so replies come back promptly.
      responsiveness: 0.85,
      interruption_sensitivity: 0.95,
      enable_backchannel: true,
      begin_message_delay_ms: 600,
      // Hang-up behavior: the agent ends the call itself with the end_call tool
      // right after its goodbye (a natural ~2-3s as the farewell finishes), so
      // the line no longer sits in long dead air. This silence timeout is only a
      // safety net for callers who go quiet WITHOUT saying goodbye; Retell
      // enforces a 10s minimum, so the end_call tool is what delivers the quick
      // post-goodbye hangup.
      end_call_after_silence_ms: 10000,
      reminder_trigger_ms: 5000,
      reminder_max_count: 1,
    };
    return { responseEngine, agent };
  },
};
