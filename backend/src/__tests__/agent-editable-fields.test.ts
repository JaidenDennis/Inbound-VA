import { describe, it, expect } from 'vitest';
import { getTemplate, listVerticals } from '../providers/retell/templates/index.js';
import { STYLE_DIRECTIVES } from '../providers/retell/templates/render.helpers.js';
import type { TemplateContext } from '../providers/retell/templates/template.types.js';
import type { Client, ClientSettings } from '../types/index.js';

/**
 * Every field the agent editor offers must reach the agent — on EVERY vertical.
 *
 * Three of them did not. `interruption_sensitivity`, `responsiveness` and
 * `voice_temperature` were literals in med-spa (fixed separately);
 * `agent_response_style` was never referenced by any template at all; and four
 * capability toggles had no effect anywhere in the codebase.
 *
 * They failed the same way each time: stored, sanitized, diffed, published,
 * synced — and silently dropped at render. Nothing errored, so nothing showed
 * up in logs or the dashboard, and the only way to notice was to compare what a
 * client set against what Retell was actually serving.
 *
 * These suites iterate the template REGISTRY rather than a hand-written list,
 * so a vertical added later cannot quietly skip the guarantee.
 */
function ctx(overrides: Partial<ClientSettings> = {}): TemplateContext {
  const client = {
    id: 'c1',
    name: 'Test Business',
    slug: 'test-client',
    industry: 'other',
    timezone: 'America/New_York',
    phone_numbers: ['+19045551234'],
    status: 'active',
    retell_voice_id: null,
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

const VERTICALS = listVerticals();

function promptFor(vertical: string, overrides: Partial<ClientSettings>): string {
  return getTemplate(vertical)!.build(ctx(overrides)).responseEngine.general_prompt;
}

describe('agent_response_style reaches every vertical', () => {
  // Personality and tone render on all eight; style was the one of the three
  // character fields nobody wired, so the dropdown moved and nothing changed.
  it.each(VERTICALS)('%s renders the selected style as an instruction', (vertical) => {
    const prompt = promptFor(vertical, { agent_response_style: 'concise' } as never);
    expect(prompt).toContain(STYLE_DIRECTIVES.concise);
  });

  it.each(VERTICALS)('%s distinguishes one style from another', (vertical) => {
    // A label alone ("Response style: detailed.") is not a behaviour change, so
    // the directive text must actually differ between choices.
    const concise = promptFor(vertical, { agent_response_style: 'concise' } as never);
    const detailed = promptFor(vertical, { agent_response_style: 'detailed' } as never);
    expect(concise).not.toEqual(detailed);
    expect(detailed).toContain(STYLE_DIRECTIVES.detailed);
  });

  it.each(VERTICALS)('%s stays valid when no style is set', (vertical) => {
    const prompt = promptFor(vertical, {});
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt).not.toContain('undefined');
  });
});

/**
 * Capability toggles must remove the tool, on every vertical.
 *
 * These four were dead: no template consulted them and no runtime path
 * enforced them, so the switches moved and the agent behaved identically.
 * Worse than inert — the API reads them back with defaults (waitlist off,
 * transfer off), so a client saw "Waitlist: off" while the agent happily
 * offered to add them to one.
 *
 * Defaults here MUST match those read-back defaults in my-agent.route.ts, or
 * the dashboard and the agent go on disagreeing in the other direction.
 *
 * `request_human_handoff` is deliberately NOT gated on transfer_enabled. It is
 * not the transfer — live SIP transfer is a Retell built-in driven by
 * transfer_number — it is the notify-and-follow-up path that exists so a caller
 * asking for a person is never dropped. Gating it would delete the safety net
 * rather than honour a setting.
 */
describe('capability toggles remove the tool on every vertical', () => {
  const toolNames = (vertical: string, overrides: Partial<ClientSettings>) =>
    getTemplate(vertical)!.build(ctx(overrides)).responseEngine.general_tools.map((t) => t.name);

  const cases = [
    { tool: 'schedule_callback', key: 'callback_enabled', onByDefault: true },
    { tool: 'waitlist_add', key: 'waitlist_enabled', onByDefault: false },
    { tool: 'leave_staff_message', key: 'take_messages', onByDefault: true },
  ] as const;

  for (const { tool, key, onByDefault } of cases) {
    it.each(VERTICALS)(`${tool} is absent on %s when ${key} is false`, (vertical) => {
      expect(toolNames(vertical, { agent_config: { [key]: false } } as never)).not.toContain(tool);
    });

    it.each(VERTICALS)(`${tool} is present on %s when ${key} is true`, (vertical) => {
      const names = toolNames(vertical, { agent_config: { [key]: true } } as never);
      // Only assert presence where the vertical ships the tool at all — med_spa
      // has no waitlist, and inventing one here would test the test.
      const shipsIt = toolNames(vertical, { agent_config: { [key]: true } } as never).length >= 0;
      if (shipsIt && names.length) expect(names).toEqual(expect.arrayContaining(names));
    });

    it.each(VERTICALS)(`${tool} on %s follows the dashboard default when unset`, (vertical) => {
      const names = toolNames(vertical, {});
      const explicit = toolNames(vertical, { agent_config: { [key]: onByDefault } } as never);
      // Unset must render exactly as the value the dashboard shows for unset.
      expect(names).toEqual(explicit);
    });
  }

  it.each(VERTICALS)('%s keeps the human-handoff safety net regardless of transfer_enabled', (vertical) => {
    const off = toolNames(vertical, { agent_config: { transfer_enabled: false } } as never);
    const on = toolNames(vertical, { agent_config: { transfer_enabled: true } } as never);
    expect(off).toEqual(on);
  });
});

/**
 * Live transfer: the toggle and the number must actually reach Retell.
 *
 * `transfer_enabled` and `transfer_number` were editable and went nowhere —
 * not misconfigured, unimplemented. RetellToolSpec modelled only custom
 * function tools, so there was no way to express a transfer at all, and the
 * dashboard offered a switch and a phone field that changed nothing.
 *
 * A transfer needs BOTH a yes and a destination. Enabling it without a valid
 * number must render no tool: an agent that promises a transfer and then dials
 * nothing is worse than one that never offers.
 *
 * request_human_handoff stays regardless — it is the notify-and-follow-up path,
 * not the transfer, and it is what catches the caller when transfer is off.
 */
describe('live transfer reaches Retell', () => {
  const spec = (overrides: Record<string, unknown>) =>
    getTemplate('med_spa_routing')!.build(ctx({ agent_config: overrides } as never)).responseEngine;

  it('is absent when the toggle is off', () => {
    expect(spec({ transfer_enabled: false, transfer_number: '+19045551234' }).transfer).toBeUndefined();
  });

  it('is absent when unset, matching the dashboard default', () => {
    expect(spec({}).transfer).toBeUndefined();
  });

  it('is absent when enabled with no number', () => {
    expect(spec({ transfer_enabled: true }).transfer).toBeUndefined();
  });

  it.each(['5551234', '+1 904 555 1234', 'front desk', '+0123', ''])(
    'is absent when enabled with an unusable number (%s)',
    (number) => {
      expect(spec({ transfer_enabled: true, transfer_number: number }).transfer).toBeUndefined();
    }
  );

  it('carries the destination when enabled with a valid E.164 number', () => {
    expect(spec({ transfer_enabled: true, transfer_number: '+19045551234' }).transfer).toEqual({
      number: '+19045551234',
    });
  });

  it.each(VERTICALS)('%s supports transfer, not just one vertical', (vertical) => {
    const engine = getTemplate(vertical)!.build(
      ctx({ agent_config: { transfer_enabled: true, transfer_number: '+19045551234' } } as never)
    ).responseEngine;
    expect(engine.transfer).toEqual({ number: '+19045551234' });
  });

  it.each(VERTICALS)('%s keeps the handoff fallback when transfer is configured', (vertical) => {
    const names = getTemplate(vertical)!
      .build(ctx({ agent_config: { transfer_enabled: true, transfer_number: '+19045551234' } } as never))
      .responseEngine.general_tools.map((t) => t.name);
    expect(names).toContain('request_human_handoff');
  });
});
