import type { TemplateContext } from './template.types.js';
import type { FAQ, PricingItem, Service, WorkingHours } from '../../../types/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Shared prompt-rendering helpers for vertical templates. Every client-specific
// value a prompt speaks comes from client_settings and is rendered here at
// provisioning time — never a Retell {{dynamic_variable}}, so the agent can
// never read a placeholder aloud.
//
// inbound-routing and med-spa-routing keep their own private copies on purpose:
// they back the live agents and are deliberately left untouched.
// ─────────────────────────────────────────────────────────────────────────────

export interface Identity {
  business: string;
  agentName: string;
}

/** Business + agent names, with a vertical-appropriate fallback for the business. */
export function identity(ctx: TemplateContext, businessFallback: string): Identity {
  return {
    business: ctx.settings.business_name?.trim() || ctx.client.name?.trim() || businessFallback,
    agentName: ctx.settings.agent_name?.trim() || 'your assistant',
  };
}

/** The service menu — the closed set the agent is allowed to discuss or book. */
export function renderServices(services: Service[], emptyFallback: string): string {
  if (!services.length) return emptyFallback;
  return services
    .map((s) => {
      const price = s.price != null ? ` (starts around $${s.price})` : '';
      const dur = s.duration_minutes ? `, ~${s.duration_minutes} min` : '';
      return `- ${s.name}${price}${dur}: ${s.description}`;
    })
    .join('\n');
}

export function renderPricing(pricing: PricingItem[], emptyFallback: string): string {
  if (!pricing.length) return emptyFallback;
  return pricing
    .map(
      (p) =>
        `- ${p.name}: starts around $${p.price}${p.unit ? `/${p.unit}` : ''}${p.notes ? ` (${p.notes})` : ''}`
    )
    .join('\n');
}

export function renderFaqs(faqs: FAQ[]): string {
  if (!faqs?.length) return 'No FAQs configured.';
  return faqs.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n');
}

export function renderPolicies(policies: string[]): string {
  if (!policies?.length) return 'No special policies configured.';
  return policies.map((p) => `- ${p}`).join('\n');
}

/** "17:00" → "5:00 PM". Hours are stored 24h for the booking service; spoken 12h. */
export function to12h(t: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return t;
  let h = Number(m[1]);
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m[2]} ${ampm}`;
}

export function renderHours(hours: WorkingHours, emptyFallback: string): string {
  const days: (keyof WorkingHours)[] = [
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
  ];
  const lines = days
    .map((d) =>
      hours?.[d] ? `- ${d[0].toUpperCase() + d.slice(1)}: ${to12h(hours[d]!.open)}–${to12h(hours[d]!.close)}` : null
    )
    .filter(Boolean);
  return lines.length ? lines.join('\n') : emptyFallback;
}

/** True when any configured service name contains one of the keywords. */
export function hasService(services: Service[], ...keywords: string[]): boolean {
  return (services ?? []).some((s) =>
    keywords.some((k) => s.name.toLowerCase().includes(k.toLowerCase()))
  );
}

/** Render a bullet list, or the fallback line when nothing is configured. */
export function bulletsOr(lines: string[], emptyFallback: string): string {
  return lines.length ? lines.join('\n') : emptyFallback;
}

/**
 * The conversational rules every Gravvia inbound agent shares: brevity, no
 * self-repetition, yielding, and the digit/name readback contract. Kept in one
 * place so a fix to how agents talk lands on every vertical at once.
 */
export function sharedSpeechRules(): string {
  return `★ HOW YOU TALK ON THE PHONE — apply on EVERY turn ★
- SHORT: Keep each reply to ONE or TWO short, natural sentences, then stop and let the caller talk. Never deliver a paragraph, a monologue, or a long list out loud. This is a live phone call — speak the way a real person does.
- DON'T REPEAT YOURSELF: Keep track of what you've already said, asked, and confirmed. Never restate your own earlier sentences and never re-ask a question that's already been answered. Always move the conversation forward. Only repeat something to confirm a detail back to the caller, or when they ask you to. When a tool returns guidance, deliver it ONCE in your own words — never say it and then immediately say the same thing again in different words.
- YIELD INSTANTLY: The moment the caller starts speaking, stop talking and listen. Never talk over them; let them finish before you respond.
- CATCH EVERYTHING AT ONCE: If the caller gives several details in one turn (e.g., name + what they need + a preferred day), capture and acknowledge ALL of them, and confirm the full set back. Never ignore part of what they said, and never re-ask for something they already provided.

★ CONFIRMING A PHONE NUMBER — read it back in natural groups, as a question ★
Confirm a number the way a real person does: in GROUPS — area code, then prefix, then the last four — with a brief pause between groups, phrased as a question. Say each digit as a WORD (so "904" is "nine zero four", never "nine hundred four"); let the digits inside a group flow naturally and only pause between the groups.
Example: for 9045551234, say: "nine zero four, five five five, one two three four — did I get that right?"
NEVER read all ten digits as one flat, evenly-spaced string, and NEVER say them as a number. When a tool or the backend hands you a readback string, speak it EXACTLY as given (the commas are silent pauses between groups), then confirm it — vary how you ask across the call ("did I get that right?", "is that correct?", "sound right?"), never repeating the same phrase back-to-back.

★ CONFIRMING A NAME — say it naturally first; spell only when needed ★
For a common, clearly-heard name, just say it back naturally to confirm ("I've got Sarah — that right?"). Only spell it out letter by letter when the name is unusual, you're unsure of the spelling, or the caller spelled it for you.
When you DO spell it, say each letter with a brief pause — a comma, not run together: for "Sarah", say "S, A, R, A, H". The commas are silent pauses; never say them.
Vary how you confirm — do not use the same phrase every time (e.g. "did I get that right?", "is that correct?", "did I catch the spelling?"). NEVER assume an unusual name's spelling without checking it.

NEVER say any text inside curly braces or any placeholder out loud. If a detail is missing, use a natural phrase instead of reading a variable.`;
}

/**
 * The backend-routing contract. Identical across verticals: the agent
 * classifies, the backend decides. `extraRule` appends one vertical-specific
 * numbered rule (e.g. identity before account info).
 */
export function sharedRoutingContract(intentExamples: string, extraRule?: string): string {
  return `=== HOW YOU HELP — quietly routed by the backend (the caller never hears this) ===
Once you understand what the caller needs, the backend guides you step by step — the caller should experience a single warm, seamless conversation, never a menu or a hand-off.
1. CLASSIFY: as soon as you understand the need, call route_intent with a short intent label (e.g. ${intentExamples}). Say a brief warm line first so there's no silence.
2. FOLLOW THE CONTRACT: route_intent returns the current step, which details are still missing, and guidance. Collect the missing details conversationally — confirm names and phone numbers per the readback rules — then report them with update_workflow (slots). When the backend hands you a "readback" string, speak it verbatim to confirm.
3. ADVANCE with update_workflow (transition_to) when the guidance says to move on. THE BACKEND PERFORMS THE ACTION FOR YOU — for booking, waitlisting, and lead capture you do NOT call a separate tool; when you transition to the step the guidance names (e.g. "execute"), the backend does it and returns the confirmation for you to speak warmly.
4. TOPIC SWITCH: if the caller changes subject, call route_intent again with the new intent — the backend pauses the current task and brings it back automatically. Never abandon a task silently.
5. STAY IN YOUR LANE: only use tools the backend granted. If a tool answers "denied", call route_intent with the caller's current intent and continue from its guidance.
6. NEVER invent facts, services, prices, or availability. If the answer is ALREADY in the sections below, answer straight from those, ONCE — do NOT call knowledge_search for it, and never repeat the same answer a second time. Use knowledge_search only for factual questions those sections do not cover (for example current promotions or offers), then give its answer once. If you truly can't help, offer a callback (schedule_callback) or take a message (leave_staff_message) — never blame "the system."${extraRule ? `\n${extraRule}` : ''}`;
}

/** The graceful close, shared by every vertical. */
export function sharedClosing(recapExamples: string): string {
  return `=== CLOSING — end gracefully, never abruptly ===
When the caller is done, call route_intent with intent "end_call". Recap anything accomplished (${recapExamples}) plus any prep or policy note, then ask "Is there anything else I can help you with today?" — PAUSE and let them answer. Only when they confirm they're all set, give a warm, unhurried goodbye, then END THE CALL with the end_call tool. Never hang up mid-sentence or while the caller is still talking.`;
}

/** The tool inventory line. Shared list, since every vertical shares the tool set. */
export function sharedToolsSection(): string {
  return `=== TOOLS ===
Use your tools rather than guessing. route_intent (classify/switch topic), update_workflow (report details, advance, finish), emergency_flag (emergencies ONLY), knowledge_search (hours, prices, policies, offers), lookup_existing_client (only after identification), check_availability, book_appointment, book_consultation, qualify_lead, find_appointment, reschedule_appointment, cancel_appointment, waitlist_add, forms_send, verify_identity (before any account info), membership_lookup, payment_lookup, documentation_request, create_complaint, set_language, set_location, schedule_callback, leave_staff_message, request_human_handoff. Never read internal IDs or raw data aloud.`;
}

/** Any extra free-text instructions the client typed in the dashboard. */
export function extraInstructions(ctx: TemplateContext): string {
  const extra = ctx.settings.agent_prompt?.trim();
  return extra ? `\n\nADDITIONAL CLIENT INSTRUCTIONS:\n${extra}` : '';
}

/**
 * The opening line, honouring a client's override.
 *
 * The greeting is the one piece of wording clients consistently want control of
 * — it carries their brand and is the first thing every caller hears — while the
 * body of the prompt stays ours. `{business}` and `{agent}` are substituted so
 * an override survives a rename without being re-typed.
 *
 * With no override configured this returns the template's own line byte for
 * byte, so an existing agent's greeting cannot shift under it.
 */
/**
 * Client-tunable call feel, clamped to ranges that still produce a usable agent.
 *
 * These are the three knobs clients actually ask for after hearing their agent:
 * how eagerly it replies, how readily it lets a caller cut in, and how much the
 * voice varies. Left unset, each falls through to the template's own value, so
 * this cannot change an agent nobody has tuned.
 *
 * Clamping is the point — Retell accepts 0..1 and the extremes are unusable
 * (0 interruption sensitivity means the agent talks over everyone), so a client
 * cannot configure their way into a broken call.
 */
export function voiceTuning(
  ctx: TemplateContext,
  defaults: { responsiveness: number; interruption_sensitivity: number; voice_temperature: number }
): { responsiveness: number; interruption_sensitivity: number; voice_temperature: number } {
  const cfg = ctx.settings.agent_config ?? {};
  const clamp = (value: unknown, fallback: number, min: number, max: number): number => {
    const n = typeof value === 'number' ? value : Number.NaN;
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  };

  return {
    responsiveness: clamp(cfg.responsiveness, defaults.responsiveness, 0.3, 1),
    interruption_sensitivity: clamp(cfg.interruption_sensitivity, defaults.interruption_sensitivity, 0.3, 1),
    voice_temperature: clamp(cfg.voice_temperature, defaults.voice_temperature, 0.2, 1.2),
  };
}

export function applyGreeting(
  ctx: TemplateContext,
  names: { business: string; agentName: string },
  fallback: string
): string {
  const raw = (ctx.settings.agent_config?.opening_message as string | undefined)?.trim();
  if (!raw) return fallback;

  return raw
    .replace(/\{business\}/gi, names.business)
    .replace(/\{agent\}/gi, names.agentName);
}
