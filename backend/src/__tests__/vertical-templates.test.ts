import { describe, it, expect } from 'vitest';
import { dentalRoutingTemplate } from '../providers/retell/templates/dental-routing.template.js';
import { orthodonticRoutingTemplate } from '../providers/retell/templates/orthodontic-routing.template.js';
import { lawFirmRoutingTemplate } from '../providers/retell/templates/law-firm-routing.template.js';
import { restaurantRoutingTemplate } from '../providers/retell/templates/restaurant-routing.template.js';
import { apartmentRoutingTemplate } from '../providers/retell/templates/apartment-routing.template.js';
import { inboundRoutingTemplate } from '../providers/retell/templates/inbound-routing.template.js';
import { getTemplate, listVerticals, resolveVertical } from '../providers/retell/templates/index.js';
import type { AgentTemplate, TemplateContext } from '../providers/retell/templates/template.types.js';
import type { AgentConfig, Client, ClientSettings } from '../types/index.js';

// One context factory for all four verticals; each suite overrides only what it
// needs. Mirrors the shape provisioningService.renderClient() passes in.
function ctx(
  overrides: Partial<ClientSettings> = {},
  clientOverrides: Partial<Client> = {}
): TemplateContext {
  const client = {
    id: 'c1',
    name: 'Fallback Business Name',
    slug: 'test-client',
    industry: 'other',
    timezone: 'America/New_York',
    phone_numbers: ['+19045551234'],
    status: 'active',
    retell_voice_id: null,
    ...clientOverrides,
  } as unknown as Client;

  const settings = {
    client_id: 'c1',
    business_name: 'Test Business',
    agent_name: 'Riley',
    agent_personality: 'warm',
    agent_tone: 'friendly',
    agent_prompt: '',
    agent_config: {},
    faqs: [{ question: 'Where are you?', answer: 'Downtown.' }],
    services: [{ name: 'Consultation', description: 'an intro visit', duration_minutes: 30, price: 0 }],
    pricing: [{ name: 'Consultation', price: 0 }],
    business_policies: ['Arrive 10 minutes early.'],
    booking_enabled: true,
    booking_rules: {
      working_hours: { monday: { open: '09:00', close: '17:00' } },
      lead_qualification_fields: [],
    },
    notification_emails: [],
    ...overrides,
  } as unknown as ClientSettings;

  return { client, settings, functionBaseUrl: 'https://x.test/functions/retell', defaultVoiceId: '11labs-Adrian' };
}

const ALL: Array<{ name: string; vertical: string; template: AgentTemplate }> = [
  { name: 'dental', vertical: 'dental_routing', template: dentalRoutingTemplate },
  { name: 'orthodontic', vertical: 'orthodontic_routing', template: orthodonticRoutingTemplate },
  { name: 'law firm', vertical: 'law_firm_routing', template: lawFirmRoutingTemplate },
  { name: 'restaurant', vertical: 'restaurant_routing', template: restaurantRoutingTemplate },
  { name: 'apartment', vertical: 'apartment_routing', template: apartmentRoutingTemplate },
];

// ─────────────────────────────────────────────────────────────────────────────
// Contract every vertical template must satisfy. These are the invariants that,
// if broken, make an agent read a variable name aloud or lose its tool set.
// ─────────────────────────────────────────────────────────────────────────────
describe.each(ALL)('$name routing template — shared contract', ({ vertical, template }) => {
  const built = template.build(ctx());
  const prompt = built.responseEngine.general_prompt;

  it('declares the expected vertical and is in the registry', () => {
    expect(template.vertical).toBe(vertical);
    expect(getTemplate(vertical)).toBe(template);
    expect(listVerticals()).toContain(vertical);
  });

  it('renders identity with no raw {{placeholders}}', () => {
    expect(prompt).toContain('Test Business');
    expect(prompt).toContain('Riley');
    expect(prompt).not.toMatch(/\{\{/);
  });

  it('falls back to the client name, then a vertical default, for the business', () => {
    const noBusiness = template.build(ctx({ business_name: null })).responseEngine.general_prompt;
    expect(noBusiness).toContain('Fallback Business Name');

    const nothing = template.build(
      ctx({ business_name: null }, { name: '' })
    ).responseEngine.general_prompt;
    expect(nothing).toMatch(/our (dental office|orthodontic practice|law firm|restaurant|apartment community)/);
  });

  it('inherits the full tool set and begin message from the routing backbone', () => {
    const base = inboundRoutingTemplate.build(ctx());
    expect(built.responseEngine.general_tools).toEqual(base.responseEngine.general_tools);
    expect(built.responseEngine.begin_message).toBe(base.responseEngine.begin_message);
    const toolNames = built.responseEngine.general_tools.map((t) => t.name);
    expect(toolNames).toEqual(expect.arrayContaining(['route_intent', 'update_workflow', 'emergency_flag']));
  });

  it('pins the text model and labels the agent with the vertical', () => {
    expect(built.responseEngine.model).toBe('gpt-4.1');
    expect(built.agent.agent_name).toContain('Test Business');
    expect(built.agent.agent_name).toContain('Riley');
    expect(built.agent.agent_name).toContain('Routing');
  });

  it('stays inside Retell\'s agent-setting bounds', () => {
    // Retell rejects the agent outright below the silence floor: "End call
    // after silence ms must be larger or equal to 10,000 (10 second)."
    expect(built.agent.end_call_after_silence_ms).toBeGreaterThanOrEqual(10000);
    expect(built.agent.responsiveness).toBeGreaterThanOrEqual(0);
    expect(built.agent.responsiveness).toBeLessThanOrEqual(1);
    expect(built.agent.interruption_sensitivity).toBeGreaterThanOrEqual(0);
    expect(built.agent.interruption_sensitivity).toBeLessThanOrEqual(1);
    expect(built.agent.voice_temperature).toBeGreaterThanOrEqual(0);
    expect(built.agent.voice_temperature).toBeLessThanOrEqual(2);
  });

  it('carries the shared speech rules (brevity, no self-repeat, digit readback)', () => {
    expect(prompt).toMatch(/ONE or TWO short/);
    expect(prompt).toMatch(/DON'T REPEAT YOURSELF/);
    expect(prompt).toMatch(/nine zero four, five five five, one two three four/);
  });

  it('carries the backend routing contract and the emergency hard rule', () => {
    expect(prompt).toMatch(/route_intent/);
    expect(prompt).toMatch(/update_workflow/);
    expect(prompt).toContain('dial 9-1-1');
    expect(prompt).toMatch(/emergency_flag/);
  });

  it('renders the client catalog rather than describing it abstractly', () => {
    expect(prompt).toContain('Consultation');
    expect(prompt).toContain('Arrive 10 minutes early.');
    expect(prompt).toContain('Where are you?');
    expect(prompt).toContain('Monday: 9:00 AM–5:00 PM'); // 24h storage rendered as 12h
  });

  it('appends client free-text instructions when set', () => {
    const withExtra = template.build(ctx({ agent_prompt: 'Mention the winter promo.' }))
      .responseEngine.general_prompt;
    expect(withExtra).toContain('ADDITIONAL CLIENT INSTRUCTIONS:');
    expect(withExtra).toContain('Mention the winter promo.');
    expect(prompt).not.toContain('ADDITIONAL CLIENT INSTRUCTIONS:');
  });

  it('degrades safely when nothing is configured', () => {
    const bare = template.build(
      ctx({ services: [], pricing: [], faqs: [], business_policies: [], booking_rules: {} as never })
    ).responseEngine.general_prompt;
    expect(bare).not.toMatch(/\{\{/);
    expect(bare).not.toContain('undefined');
    expect(bare).toMatch(/never invent|No specific|not configured|No FAQs|No published fees|No prices/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Vertical-specific rules — the reason these templates exist at all.
// ─────────────────────────────────────────────────────────────────────────────
describe('dental template specifics', () => {
  const cfg = (agent_config: AgentConfig) => dentalRoutingTemplate.build(ctx({ agent_config })).responseEngine.general_prompt;

  it('triages dental pain without giving clinical or medication advice', () => {
    const p = cfg({});
    expect(p).toMatch(/NEVER diagnose/);
    expect(p).toMatch(/over-the-counter pain relievers|antibiotics/);
    expect(p).toMatch(/knocked-out permanent tooth/i);
  });

  it('lists accepted plans but forbids quoting coverage', () => {
    const p = cfg({ insurance_accepted: ['Delta Dental', 'Cigna'] });
    expect(p).toContain('Delta Dental, Cigna');
    expect(p).toMatch(/NEVER quote what it covers/);
  });

  it('refuses to guess about insurance when no plans are configured', () => {
    const p = cfg({});
    expect(p).toMatch(/Never guess whether a plan is accepted/);
    expect(p).not.toContain('Delta Dental');
  });

  it('mentions a new-patient offer only when one is configured', () => {
    expect(cfg({})).toMatch(/No new-patient offer is configured/);
    const p = cfg({ new_patient_special: { name: 'New Patient Exam', price: 99 } });
    expect(p).toContain('New Patient Exam');
    expect(p).toContain('$99');
  });

  it('offers same-day emergency slots only when the practice holds them', () => {
    expect(cfg({ emergency_same_day: true })).toMatch(/same-day emergency slots are held/i);
    expect(cfg({})).not.toMatch(/same-day emergency slots are held/i);
  });
});

describe('orthodontic template specifics', () => {
  const cfg = (agent_config: AgentConfig, s: Partial<ClientSettings> = {}) =>
    orthodonticRoutingTemplate.build(ctx({ agent_config, ...s })).responseEngine.general_prompt;

  it('distinguishes the parent caller from the child patient', () => {
    const p = cfg({});
    expect(p).toMatch(/for themselves or for their child/i);
    expect(p).toMatch(/Never assume the caller is the patient/);
  });

  it('lists treatment options but forbids prescribing one', () => {
    const p = cfg({ treatment_types: ['metal braces', 'clear aligners'] });
    expect(p).toContain('metal braces, clear aligners');
    expect(p).toMatch(/NEVER tell a caller which option they need/);
    expect(p).toMatch(/never estimate a treatment length/i);
  });

  it('treats a broken bracket as routine, not an emergency, and forbids self-repair coaching', () => {
    const p = cfg({});
    expect(p).toMatch(/NOT emergencies/);
    expect(p).toMatch(/NEVER coach them through fixing, cutting, clipping, or removing/);
    expect(p).toMatch(/LOST OR BROKEN RETAINER/);
  });

  it('surfaces financing without quoting a monthly figure', () => {
    const p = cfg({ financing_available: true });
    expect(p).toMatch(/Monthly payment plans are available/);
    expect(p).toMatch(/never quote a specific monthly figure/);
  });

  it('says the consultation is complimentary only when configured', () => {
    expect(cfg({ free_consultation: true })).toMatch(/complimentary/);
    expect(cfg({})).not.toMatch(/initial consultation is complimentary — say so/);
  });
});

describe('law firm template specifics', () => {
  const cfg = (agent_config: AgentConfig) => lawFirmRoutingTemplate.build(ctx({ agent_config })).responseEngine.general_prompt;

  it('states the no-legal-advice rule as overriding everything', () => {
    const p = cfg({});
    expect(p).toMatch(/YOU ARE NOT A LAWYER AND YOU NEVER GIVE LEGAL ADVICE/);
    expect(p).toMatch(/overrides every other instruction/);
    expect(p).toMatch(/whether they "have a case,"/);
    expect(p).toMatch(/No attorney–client relationship exists from this call/);
  });

  it('forbids estimating deadlines and escalates time-sensitive matters instead', () => {
    const p = cfg({});
    expect(p).toMatch(/statute of limitations/);
    expect(p).toMatch(/served with papers/);
    expect(p).toMatch(/request_human_handoff/);
    expect(p).toMatch(/Never tell them whether the deadline is real/);
  });

  it('runs a conflicts disclaimer and protects confidentiality', () => {
    const p = cfg({});
    expect(p).toMatch(/conflicts check/);
    expect(p).toMatch(/Never confirm to a caller whether the firm represents someone else/);
    expect(p).toMatch(/opposing counsel/);
  });

  it('declines matters outside the configured practice areas with a bar referral', () => {
    const p = cfg({ practice_areas: ['personal injury', 'family law'] });
    expect(p).toContain('personal injury, family law');
    expect(p).toMatch(/bar association/);
    expect(p).toMatch(/Do NOT stretch a matter to fit the list/);
  });

  it('refuses to name practice areas when none are configured', () => {
    expect(cfg({})).toMatch(/Do not tell a caller what kind of matter the firm handles/);
  });

  it('never quotes fees, including a contingency percentage', () => {
    const p = cfg({ contingency_fee: true });
    expect(p).toMatch(/no fee unless we recover/);
    expect(p).toMatch(/never quote a percentage/);
    expect(p).toMatch(/NEVER quote an hourly rate, a flat fee, a retainer amount/);
  });
});

describe('restaurant template specifics', () => {
  const cfg = (agent_config: AgentConfig) => restaurantRoutingTemplate.build(ctx({ agent_config })).responseEngine.general_prompt;

  it('speaks reservation language, never appointment language', () => {
    const p = cfg({});
    expect(p).toMatch(/ALWAYS say "reservation," "table," and "seating time" out loud/);
    expect(p).toMatch(/Never say "appointment."/);
  });

  it('flags allergies but never clears them', () => {
    const p = cfg({});
    expect(p).toMatch(/ALLERGIES AND DIETARY RESTRICTIONS — FLAG, NEVER CLEAR/);
    expect(p).toMatch(/NEVER say a dish is safe/);
    expect(p).toMatch(/Only the chef clears an allergy, in person/);
  });

  it('enforces the configured party-size ceiling', () => {
    const p = cfg({ max_party_size: 12 });
    expect(p).toMatch(/You may book parties up to 12/);
    expect(p).toMatch(/For a party LARGER than 12, do NOT book it/);
  });

  it('defaults the party-size ceiling to 8 when unset', () => {
    expect(cfg({})).toMatch(/You may book parties up to 8/);
  });

  it('states each offering as available or explicitly not offered', () => {
    const on = cfg({ reservations_enabled: true, takeout_enabled: true, delivery_enabled: true, private_events: true });
    expect(on).toMatch(/Takeout\/pickup: available/);
    expect(on).toMatch(/Delivery: available/);
    expect(on).toMatch(/Private events and buyouts: offered/);

    const off = cfg({ reservations_enabled: false, takeout_enabled: false, delivery_enabled: false });
    expect(off).toMatch(/Reservations: NOT taken/);
    expect(off).toMatch(/Takeout\/pickup: NOT offered/);
    expect(off).toMatch(/Delivery: NOT offered directly/);
    expect(off).not.toMatch(/Private events and buyouts: offered/);
  });

  it('never invents a menu item and routes complaints to a human without comping', () => {
    const p = cfg({});
    expect(p).toMatch(/never describe a dish from imagination/);
    expect(p).toMatch(/never offer a refund, a comp, a voucher, or a discount yourself/);
  });

  it('paces faster than the clinic verticals', () => {
    const { agent } = restaurantRoutingTemplate.build(ctx());
    const base = inboundRoutingTemplate.build(ctx()).agent;
    expect(agent.responsiveness).toBeGreaterThan(base.responsiveness!);
  });

  it('keeps the silence timeout at or above Retell\'s 10,000 ms floor', () => {
    // Retell rejects the agent outright below this: "End call after silence ms
    // must be larger or equal to 10,000 (10 second)."
    const { agent } = restaurantRoutingTemplate.build(ctx());
    expect(agent.end_call_after_silence_ms).toBeGreaterThanOrEqual(10000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('vertical resolution from industry', () => {
  it('maps each new industry to its dedicated playbook', () => {
    expect(resolveVertical('dental')).toBe('dental_routing');
    expect(resolveVertical('orthodontic')).toBe('orthodontic_routing');
    expect(resolveVertical('legal')).toBe('law_firm_routing');
    expect(resolveVertical('restaurant')).toBe('restaurant_routing');
  });

  it('leaves pre-existing industry resolution untouched', () => {
    // Additive by design: no already-provisioned client changes template on its
    // next re-provision just because new verticals were registered.
    expect(resolveVertical('beauty')).toBe('med_spa');
    expect(resolveVertical('medical')).toBe('med_spa');
    expect(resolveVertical('other')).toBe('med_spa');
  });

  it('resolves every industry to a registered template', () => {
    const industries = ['dental', 'orthodontic', 'medical', 'legal', 'real_estate', 'fitness', 'beauty', 'auto', 'restaurant', 'other'];
    for (const industry of industries) {
      expect(getTemplate(resolveVertical(industry))).not.toBeNull();
    }
  });
});
