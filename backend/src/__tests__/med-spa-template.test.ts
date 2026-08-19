import { describe, it, expect } from 'vitest';
import { medSpaTemplate } from '../providers/retell/templates/med-spa.template.js';
import type { TemplateContext } from '../providers/retell/templates/template.types.js';
import type { Client, ClientSettings } from '../types/index.js';

function ctx(overrides: Partial<ClientSettings> = {}): TemplateContext {
  const client = {
    id: 'c1',
    name: 'Bare Beauty Medspa',
    slug: 'bare-beauty-medspa',
    industry: 'beauty',
    timezone: 'America/New_York',
    phone_numbers: ['+19047605971'],
    status: 'active',
    retell_voice_id: null,
  } as unknown as Client;

  const settings = {
    client_id: 'c1',
    business_name: 'Bare Beauty Medspa',
    agent_name: 'Emily',
    agent_personality: 'warm and caring',
    agent_tone: 'friendly',
    agent_config: {
      membership_program: { name: 'Bare Glow Membership' },
      offers_packages: true,
      offers_prp: true,
      free_consultation: true,
    },
    faqs: [],
    services: [
      { name: 'Botox', description: 'wrinkle-relaxing injectable', duration_minutes: 30, price: 300 },
      { name: 'Hydrafacial', description: 'deep-cleansing facial', duration_minutes: 50, price: 200 },
      { name: 'Microneedling', description: 'collagen-induction therapy', duration_minutes: 60, price: 350 },
    ],
    pricing: [],
    business_policies: [],
    booking_enabled: true,
    booking_rules: { working_hours: {}, lead_qualification_fields: ['skin_concern'] },
    notification_emails: [],
    ...overrides,
  } as unknown as ClientSettings;

  return { client, settings, functionBaseUrl: 'https://x.test/functions/retell', defaultVoiceId: '11labs-Adrian' };
}

describe('med-spa template refinements', () => {
  const { responseEngine, agent } = medSpaTemplate.build(ctx());
  const prompt = responseEngine.general_prompt;

  it('renders identity without any raw {{placeholders}}', () => {
    expect(prompt).toContain('Bare Beauty Medspa');
    expect(prompt).toContain('Emily');
    expect(prompt).not.toMatch(/\{\{/);
    expect(responseEngine.begin_message).toBe('Thank you for calling Bare Beauty Medspa, this is Emily.');
  });

  it('instructs brevity (short, 1-2 sentence replies)', () => {
    expect(prompt).toMatch(/ONE or TWO short/i);
    expect(prompt).toMatch(/never deliver a paragraph|monologue/i);
  });

  it('instructs not to repeat itself', () => {
    expect(prompt).toMatch(/DON'T REPEAT YOURSELF/i);
    expect(prompt).toMatch(/never re-ask/i);
  });

  it('instructs to yield instantly on interruption', () => {
    expect(prompt).toMatch(/YIELD INSTANTLY/i);
  });

  it('instructs to capture multi-part input in one turn', () => {
    expect(prompt).toMatch(/CATCH EVERYTHING AT ONCE/i);
  });

  it('enforces strict service adherence', () => {
    expect(prompt).toMatch(/COMPLETE and ONLY set/i);
    expect(prompt).toMatch(/NEVER invent/i);
  });

  it('keeps consultation push but warns against re-pitching', () => {
    expect(prompt).toMatch(/most valuable outcome/i);
    expect(prompt).toMatch(/do not re-pitch|back-to-back turns/i);
  });

  it('sets a high interruption sensitivity for barge-in', () => {
    expect(agent.interruption_sensitivity).toBeGreaterThanOrEqual(0.9);
  });

  it('only upsells services that exist in the menu (config-driven, no fabrication)', () => {
    // PRP add-on is gated on Microneedling existing — present here.
    expect(prompt).toMatch(/Microneedling inquiry/i);
    // Laser packages should NOT appear: no laser service in this menu.
    expect(prompt).not.toMatch(/Laser inquiry/i);
  });
});

/**
 * The three client-tunable knobs must actually reach the agent.
 *
 * `voiceTuning()` exists so a client can change how eagerly the agent replies,
 * how readily it yields the floor, and how much the voice varies — clamped to
 * ranges that still produce a usable call. Every other template gets this by
 * delegating to inboundRoutingTemplate, which calls it. This one built its
 * AgentSpec from literals and never called it, so the values a client saved
 * were written to the database, shown back to them in the dashboard, published,
 * synced — and then discarded at render time.
 *
 * Found when Bare Beauty set interruption sensitivity to 0.3 (the floor: they
 * wanted the agent to stop yielding so easily), published, and watched Retell
 * keep reporting 0.95. The sync was working; the renderer was overwriting them.
 */
describe('med-spa template — client voice tuning', () => {
  const tune = (agent_config: Record<string, unknown>) =>
    medSpaTemplate.build(ctx({ agent_config } as never)).agent;

  it('honours a client\u2019s interruption sensitivity', () => {
    expect(tune({ interruption_sensitivity: 0.3 }).interruption_sensitivity).toBe(0.3);
  });

  it('honours responsiveness and voice temperature too', () => {
    const agent = tune({ responsiveness: 0.4, voice_temperature: 1.2 });
    expect(agent.responsiveness).toBe(0.4);
    expect(agent.voice_temperature).toBe(1.2);
  });

  it('falls through to the template\u2019s own values when unset', () => {
    // The guarantee that makes this safe to change: an agent nobody has tuned
    // must render exactly as it did before.
    const agent = tune({});
    expect(agent.interruption_sensitivity).toBe(0.95);
    expect(agent.responsiveness).toBe(0.85);
    expect(agent.voice_temperature).toBe(0.6);
  });

  it('clamps a value that would make the call unusable', () => {
    // 0 interruption sensitivity means the agent talks over everyone.
    expect(tune({ interruption_sensitivity: 0 }).interruption_sensitivity).toBe(0.3);
    expect(tune({ interruption_sensitivity: 5 }).interruption_sensitivity).toBe(1);
  });

  it('ignores a non-numeric value rather than rendering NaN', () => {
    expect(tune({ interruption_sensitivity: 'very' }).interruption_sensitivity).toBe(0.95);
  });
});
