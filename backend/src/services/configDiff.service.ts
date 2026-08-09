/**
 * What a pending configuration change actually does.
 *
 * The problem this solves is not "show a JSON diff". It is that a client edits
 * `buffer_minutes` from 0 to 30 and has no way to know they have just narrowed
 * every bookable slot on their calendar. The field name does not say that; the
 * consequence does, and the consequence is what someone reviews before they
 * press publish.
 *
 * So a diff here is two things: the literal field changes, and the downstream
 * behaviour each one lands on. The second is the point.
 *
 * NO-OP EDITS ARE NOT CHANGES. The editor submits its whole form, so most keys
 * arrive identical to what is stored. Reporting those would bury the two fields
 * that moved in forty that did not, and a review nobody can read is a review
 * nobody performs.
 */

/** Behaviour areas a change can land on. Ordered by how much they matter. */
export const IMPACT_AREAS = {
  booking: 'Booking availability',
  escalation: 'Escalation and notifications',
  knowledge: 'What the agent can answer',
  capability: 'What the agent offers callers',
  voice: 'How the agent sounds',
  crm: 'CRM sync',
} as const;

export type ImpactArea = keyof typeof IMPACT_AREAS;

export type DiffKind = 'added' | 'removed' | 'changed';

export interface DiffEntry {
  /** Dotted path, e.g. `booking_rules.buffer_minutes`. */
  path: string;
  label: string;
  kind: DiffKind;
  before: unknown;
  after: unknown;
  /**
   * Plain-language consequence, when the field has one worth stating. Absent
   * rather than invented for fields whose effect the label already carries.
   */
  consequence?: string;
  area?: ImpactArea;
}

export interface ConfigDiff {
  entries: DiffEntry[];
  /** Distinct behaviour areas touched, for the summary line above the list. */
  areas: Array<{ area: ImpactArea; label: string; fields: string[] }>;
  hasChanges: boolean;
}

/**
 * Field metadata: label, the behaviour it drives, and what changing it does.
 *
 * Keyed by dotted path. A path with no entry still appears in the diff — it just
 * appears without a consequence rather than being dropped, because an unlabelled
 * change is still a change the reviewer should see.
 */
const FIELD_META: Record<
  string,
  { label: string; area: ImpactArea; consequence?: string }
> = {
  business_name: { label: 'Business name', area: 'voice', consequence: 'Changes what the agent calls your business on every call.' },
  agent_name: { label: 'Agent name', area: 'voice', consequence: 'Changes the name the agent introduces itself with.' },
  agent_personality: { label: 'Personality', area: 'voice' },
  agent_tone: { label: 'Tone', area: 'voice' },
  agent_response_style: { label: 'Response style', area: 'voice' },
  voice_id: { label: 'Voice', area: 'voice', consequence: 'Callers will hear a different voice.' },

  'agent_config.opening_message': {
    label: 'Greeting',
    area: 'voice',
    consequence: 'This is the first line of every call. Check it still mentions call recording if you rely on that disclosure.',
  },
  'agent_config.responsiveness': { label: 'Responsiveness', area: 'voice' },
  'agent_config.interruption_sensitivity': { label: 'Interruption sensitivity', area: 'voice' },
  'agent_config.voice_temperature': { label: 'Voice variation', area: 'voice' },
  'agent_config.pronunciation_dictionary': {
    label: 'Pronunciations',
    area: 'voice',
    consequence: 'Changes how the agent says specific words and names.',
  },

  booking_enabled: {
    label: 'Booking',
    area: 'booking',
    consequence: 'Turning this off means the agent stops offering appointments and takes a message instead.',
  },
  'booking_rules.advance_booking_hours': {
    label: 'Minimum notice',
    area: 'booking',
    consequence: 'Callers cannot book any slot sooner than this. Raising it removes same-day availability.',
  },
  'booking_rules.max_advance_booking_days': {
    label: 'Booking horizon',
    area: 'booking',
    consequence: 'How far ahead callers may book. Lowering it hides slots you currently offer.',
  },
  'booking_rules.buffer_minutes': {
    label: 'Buffer between appointments',
    area: 'booking',
    consequence: 'Padding around every appointment. Raising it reduces how many slots fit in a day.',
  },
  'booking_rules.cancellation_notice_hours': { label: 'Cancellation notice', area: 'booking' },
  'booking_rules.cancellation_policy': {
    label: 'Cancellation policy',
    area: 'booking',
    consequence: 'The agent reads this out when callers ask about cancelling.',
  },
  'booking_rules.working_hours': {
    label: 'Opening hours',
    area: 'booking',
    consequence: 'Decides which slots exist at all, and when a caller is told you are closed.',
  },

  notification_emails: {
    label: 'Notification recipients',
    area: 'escalation',
    consequence: 'Who receives lead and booking notifications. An empty list means nobody is told.',
  },
  escalation_rules: {
    label: 'Escalation rules',
    area: 'escalation',
    consequence: 'Decides when a call is handed to a human and who it reaches.',
  },
  'agent_config.transfer_enabled': {
    label: 'Live transfer',
    area: 'capability',
    consequence: 'Whether the agent can put a caller through to a person.',
  },
  'agent_config.transfer_number': {
    label: 'Transfer number',
    area: 'escalation',
    consequence: 'Where transferred calls ring. A wrong number here drops callers silently.',
  },
  'agent_config.callback_enabled': { label: 'Callback requests', area: 'capability' },
  'agent_config.waitlist_enabled': { label: 'Waitlist', area: 'capability' },
  'agent_config.take_messages': { label: 'Message taking', area: 'capability' },

  faqs: { label: 'FAQs', area: 'knowledge', consequence: 'Changes what the agent can answer without escalating.' },
  services: { label: 'Services', area: 'knowledge', consequence: 'Changes what the agent can describe and book.' },
  pricing: { label: 'Pricing', area: 'knowledge', consequence: 'Changes the prices the agent quotes to callers.' },
  business_policies: { label: 'Policies', area: 'knowledge' },

  crm_type: { label: 'Active CRM', area: 'crm', consequence: 'Where contacts and bookings are pushed.' },
};

/** Values compared whole rather than walked into. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // Structural equality is enough here: these are JSONB values, so they are
  // already plain data with a stable key order coming out of Postgres.
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

function labelFor(path: string): string {
  const meta = FIELD_META[path];
  if (meta) return meta.label;
  // Fall back to a readable version of the leaf key rather than the raw path:
  // an unmapped field is rare, and "Max party size" beats "agent_config.max_party_size".
  const leaf = path.split('.').pop() ?? path;
  return leaf.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/**
 * Walk a sparse patch against current state.
 *
 * Recurses into nested objects so `agent_config` and `booking_rules` report the
 * individual key that moved rather than a wall of JSONB. Arrays are compared
 * whole — element-level diffs of an FAQ list are noise, and "12 → 13 entries"
 * is what a reviewer actually needs.
 */
function walk(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
  prefix: string,
  out: DiffEntry[]
): void {
  for (const [key, next] of Object.entries(patch)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const prev = current?.[key];

    if (isPlainObject(next) && isPlainObject(prev)) {
      walk(prev, next, path, out);
      continue;
    }

    if (equal(prev, next)) continue;

    // `added` and `removed` are about presence, not truthiness: setting a
    // buffer to 0 is a change, not a removal, and the reviewer needs to see the
    // number. Only genuinely absent values count either way.
    const kind: DiffKind = isEmpty(prev) && !isEmpty(next)
      ? 'added'
      : !isEmpty(prev) && isEmpty(next)
        ? 'removed'
        : 'changed';

    const meta = FIELD_META[path];
    out.push({
      path,
      label: labelFor(path),
      kind,
      before: prev ?? null,
      after: next ?? null,
      ...(meta?.consequence ? { consequence: meta.consequence } : {}),
      ...(meta?.area ? { area: meta.area } : {}),
    });
  }
}

/**
 * Diff a pending patch against the settings it would be applied to.
 *
 * `patch` is sparse — only the keys the editor submitted. Keys it does not
 * mention are untouched and do not appear.
 */
export function diffConfig(
  current: Record<string, unknown> | null,
  patch: Record<string, unknown>
): ConfigDiff {
  const entries: DiffEntry[] = [];
  walk(current ?? {}, patch, '', entries);

  // Group by behaviour area for the summary line. Unmapped fields carry no area
  // and are listed in the entries without inflating the summary with a bucket
  // nobody can act on.
  const byArea = new Map<ImpactArea, string[]>();
  for (const entry of entries) {
    if (!entry.area) continue;
    byArea.set(entry.area, [...(byArea.get(entry.area) ?? []), entry.label]);
  }

  const order = Object.keys(IMPACT_AREAS) as ImpactArea[];
  const areas = order
    .filter((area) => byArea.has(area))
    .map((area) => ({ area, label: IMPACT_AREAS[area], fields: byArea.get(area) ?? [] }));

  return { entries, areas, hasChanges: entries.length > 0 };
}
