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

describe('apartment template specifics', () => {
  const cfg = (agent_config: AgentConfig) =>
    apartmentRoutingTemplate.build(ctx({ agent_config })).responseEngine.general_prompt;

  it('states Fair Housing as overriding every other instruction', () => {
    const p = cfg({});
    expect(p).toMatch(/FAIR HOUSING — THIS OVERRIDES/);
    expect(p).toMatch(/overrides hospitality, sales, and every other instruction/i);
  });

  it('refuses to steer on neighborhood, schools, safety, or who lives here', () => {
    const p = cfg({});
    expect(p).toMatch(/You never steer\./);
    expect(p).toMatch(/What kind of people live here\?/);
    expect(p).toMatch(/How are the schools\?/);
    expect(p).toMatch(/never characterize the neighborhood/i);
  });

  it('forbids recording or acting on protected characteristics', () => {
    const p = cfg({});
    expect(p).toMatch(/familial status/);
    expect(p).toMatch(/source of income/);
    expect(p).toMatch(/do NOT write it into a slot, a note, or a message/);
  });

  it('exempts assistance animals from every pet term', () => {
    const p = cfg({ pets_allowed: false });
    expect(p).toMatch(/A service animal or assistance animal is NOT a pet/);
    expect(p).toMatch(/never apply pet rent, a pet fee, a breed restriction, or a weight limit/i);
    expect(p).toMatch(/never demand documentation/i);
  });

  it('never pre-approves or pre-denies an applicant', () => {
    const p = cfg({});
    expect(p).toMatch(/NEVER tell a caller whether they will be approved or denied/);
    expect(p).toMatch(/read the published criteria exactly as written/i);
  });

  it('runs the emergency script before anything else and never troubleshoots', () => {
    const p = cfg({});
    expect(p).toMatch(/MAINTENANCE EMERGENCY — CHECK FIRST, EVERY TURN/);
    expect(p).toContain('hang up and dial 9-1-1');
    expect(p).toMatch(/leave the building first and call the gas company from outside/);
    expect(p).toMatch(/emergency_flag/);
    expect(p).toMatch(/Never troubleshoot a maintenance emergency and never log it as a routine work order/);
  });

  it('covers medical emergencies in the one spoken life-safety line, not just gas and fire', () => {
    const p = cfg({});
    // The line is triggered by "a medical emergency" as well as gas/fire, so the
    // words the agent actually says must cover a collapsed spouse — not recite
    // gas-leak evacuation steps at them.
    const spoken = /Say exactly: "([^"]+)"/.exec(p);
    expect(spoken).not.toBeNull();
    const line = spoken![1];
    expect(line).toMatch(/hurt or having a medical emergency/i);
    expect(line).toMatch(/fire/);
    expect(line).toMatch(/hang up and dial 9-1-1 right now/);
    // The gas instruction stays conditional so it is not read to a caller whose
    // emergency has nothing to do with gas.
    expect(line).toMatch(/if you smell gas, leave the building first/);
    expect(p.match(/dial 9-1-1/g)).toHaveLength(1);
  });

  it('lists the habitability emergencies that are not 9-1-1 calls', () => {
    const p = cfg({});
    expect(p).toMatch(/active flooding or a burst pipe/);
    expect(p).toMatch(/sewage backup/);
    expect(p).toMatch(/no heat/);
    expect(p).toMatch(/elevator entrapment/);
    expect(p).toMatch(/broken exterior door or lock/);
  });

  it('sends habitability calls to emergency_flag but suppresses the 9-1-1 guidance it returns', () => {
    const p = cfg({ emergency_maintenance_line: '904-555-0111' });
    // emergency_flag's own tool description says "EMERGENCIES ONLY: medical
    // emergency, threat, or immediate danger", so the prompt has to say out loud
    // that it is still the right tool here.
    expect(p).toMatch(/It is the right tool for these even though its description talks about immediate danger/);
    // …and the endpoint answers with a canned "hang up and dial 9-1-1" line that
    // must never reach a burst-pipe caller.
    expect(p).toMatch(/emergency_flag answers with guidance that tells you to send the caller to emergency services/);
    expect(p).toMatch(/you must NOT speak it, NOT paraphrase it, and NOT mention emergency services at all/);
    expect(p).toMatch(/INSTEAD give the 24-hour emergency maintenance line/);
    expect(p).toContain('904-555-0111');
  });

  it('forbids reading configured text that characterizes the area, residents, schools, or safety', () => {
    const p = cfg({});
    expect(p).toMatch(/Being configured does not make a line safe to say/);
    expect(p).toMatch(
      /characterizes the area, the neighborhood, the residents, the schools, the safety, or who would fit in here/
    );
    expect(p).toMatch(/do NOT read it aloud, do not summarize it, and do not agree with the caller about it, EVEN THOUGH it is configured/);
  });

  it('answers the assistance-animal question outright and records nothing about the disability', () => {
    const p = cfg({ pets_allowed: false });
    expect(p).toMatch(/ANSWER this question directly — do not deflect it and do not take a message instead of answering/);
    expect(p).toMatch(
      /assistance animals are not pets and are never subject to pet rent, pet fees, breed restrictions, or weight limits/
    );
    // Jointly satisfiable with rule 2: answering requires writing nothing down.
    expect(p).toMatch(/never write the animal, the disability, or the reason into a slot, a note, or a message/);
    expect(p).toMatch(/answering the policy question requires recording nothing at all/);
    // Only the accommodation REQUEST is routed, via the existing escalation section.
    expect(p).toMatch(/reasonable-accommodation or modification REQUEST goes to a person/);
    expect(p).toMatch(/ESCALATE TO A HUMAN below already covers that/);
    // The no-pets OFFERINGS line used to send the whole question away, which is
    // the same stonewall by another route.
    expect(p).not.toMatch(/route any assistance-animal question to the office/);
  });

  it('collects a full work order and promises nothing', () => {
    const p = cfg({});
    expect(p).toMatch(/MAINTENANCE REQUESTS/);
    expect(p).toMatch(/permission to enter/i);
    expect(p).toMatch(/pets in the unit/i);
    expect(p).toMatch(/leave_staff_message/);
    expect(p).toMatch(/Never promise a repair time, a technician's name, or that a charge will be waived/);
  });

  it('carries exactly one life-safety script, ahead of every other rule', () => {
    const p = cfg({});
    expect(p).not.toMatch(/SAFETY — EMERGENCY HARD RULE/);
    expect(p.match(/dial 9-1-1/g)).toHaveLength(1);
    expect(p.indexOf('MAINTENANCE EMERGENCY — CHECK FIRST')).toBeLessThan(
      p.indexOf('FAIR HOUSING — THIS OVERRIDES')
    );
  });

  it('frames every rent as perishable and refuses to hold a unit', () => {
    const p = cfg({});
    expect(p).toMatch(/as of today, and subject to availability and change/);
    expect(p).toMatch(/never hold or reserve a unit/i);
    expect(p).toMatch(/never quote a specific unit number as available/i);
  });

  it('never takes money over the phone', () => {
    const p = cfg({});
    expect(p).toMatch(/NEVER take a card number, a bank account number, or a payment of any kind over the phone/);
  });

  it('states configured fees exactly and refuses to invent them', () => {
    const p = cfg({ application_fee: 60, admin_fee: 200, income_requirement_multiple: 3 });
    expect(p).toMatch(/Application fee: \$60 per adult applicant/);
    expect(p).toMatch(/Administrative fee: \$200/);
    expect(p).toMatch(/at least 3 times the monthly rent/);
    expect(cfg({})).toMatch(/No published fees are configured/);
  });

  it('gates tours, application, portal, and emergency line on configuration', () => {
    const on = cfg({
      tours_enabled: true,
      self_guided_tours: true,
      online_application_url: 'https://apply.example.com',
      resident_portal_url: 'https://portal.example.com',
      emergency_maintenance_line: '904-555-0111',
    });
    expect(on).toMatch(/Tours: booked over the phone/);
    expect(on).toMatch(/Self-guided tours are also available/);
    expect(on).toContain('https://apply.example.com');
    expect(on).toContain('https://portal.example.com');
    expect(on).toContain('904-555-0111');

    const off = cfg({});
    expect(off).toMatch(/Tours: NOT booked over the phone/);
    expect(off).toMatch(/no online application is configured/i);
    expect(off).toMatch(/no resident portal is configured/i);
    expect(off).toMatch(/no 24-hour emergency line is configured/i);

    // self_guided_tours is nested under tours_enabled: with phone tours off, the
    // self-guided line must stay out even when the flag itself is on. Asserting
    // this on an empty config would pass with the nesting removed entirely.
    const selfGuidedOnly = cfg({ tours_enabled: false, self_guided_tours: true });
    expect(selfGuidedOnly).toMatch(/Tours: NOT booked over the phone/);
    expect(selfGuidedOnly).not.toMatch(/Self-guided tours are also available/);
  });

  it('states the pet policy without ever letting it touch assistance animals', () => {
    expect(cfg({ pets_allowed: true })).toMatch(/Pets: welcome, subject to the pet policy/);
    const noPets = cfg({ pets_allowed: false });
    expect(noPets).toMatch(/Pets: this community does not accept pets/);
    expect(noPets).toMatch(/Assistance animals are NOT pets and are never refused on that basis/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('vertical resolution from industry', () => {
  it('maps each new industry to its dedicated playbook', () => {
    expect(resolveVertical('dental')).toBe('dental_routing');
    expect(resolveVertical('orthodontic')).toBe('orthodontic_routing');
    expect(resolveVertical('legal')).toBe('law_firm_routing');
    expect(resolveVertical('restaurant')).toBe('restaurant_routing');
    expect(resolveVertical('real_estate')).toBe('apartment_routing');
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
