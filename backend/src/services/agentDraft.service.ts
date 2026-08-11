import { createHash } from 'node:crypto';
import { supabase } from '../db/index.js';
import { clientService } from './client.service.js';
import { agentSyncService } from './agentSync.service.js';
import { assertWithinPromptBoundary } from './promptBoundary.service.js';
import { diffConfig, type ConfigDiff } from './configDiff.service.js';
import type { ClientSettings, UserRole } from '../types/index.js';

/**
 * Pending configuration, held back until someone has read what it changes.
 *
 * Before this existed, `PATCH /my-agent` wrote settings and queued a
 * re-provision in the same request — saving WAS publishing. There was no state
 * to review, so "diff before publish" had nothing to diff. A draft is that
 * missing state.
 *
 * The direct path still works and is still immediate. This is the reviewed path,
 * not a replacement: a client changing one notification email should not have to
 * walk a two-step publish flow, and a client rewriting their booking rules
 * should.
 */

/**
 * Fields a draft may carry.
 *
 * This is the client-editable projection of configuration, and it is also what
 * the staleness fingerprint covers — the two must be the same set. If they were
 * not, either a draft could carry a field whose concurrent change went unnoticed,
 * or an unrelated staff edit would invalidate a client's pending review for no
 * reason.
 *
 * `voice_id` is included even though it lives on `clients.retell_voice_id` rather
 * than `client_settings`. From the editor's point of view it is one more agent
 * setting, and splitting the draft across two shapes to mirror the storage layout
 * would leak schema into the review screen.
 *
 * `business_policies` is deliberately NOT here. Since migration 032 it is a
 * rendered column: `client_policies` holds the titled entries and
 * `renderPolicies()` rebuilds the array from them (knowledge.route.ts's
 * /knowledge/policies). While it was draftable, publishing a draft rewrote the
 * agent's policy text behind the Policies tab's back, and the tab's next save
 * silently reverted the published version. Policies are edited on their own tab
 * and reach the agent through that one writer.
 */
const DRAFTABLE_FIELDS = [
  'business_name',
  'agent_name',
  'agent_personality',
  'agent_tone',
  'agent_response_style',
  'agent_config',
  'booking_enabled',
  'booking_rules',
  'notification_emails',
  'escalation_rules',
  'faqs',
  'services',
  'pricing',
  'voice_id',
] as const;

/**
 * The editor speaks flat; storage does not.
 *
 * `opening_message` and `buffer_minutes` are top-level fields on the settings
 * screen and nested inside `agent_config` / `booking_rules` in the database. The
 * mapping between the two shapes lived inline in the PATCH handler and is needed
 * by the draft path too, so it lives here — one definition, so the immediate
 * path and the reviewed path cannot disagree about where a field goes.
 */
export const EDITOR_CONFIG_KEYS = [
  'opening_message',
  'responsiveness',
  'interruption_sensitivity',
  'voice_temperature',
  'transfer_enabled',
  'transfer_number',
  'callback_enabled',
  'waitlist_enabled',
  'take_messages',
  'pronunciation_dictionary',
] as const;

export const EDITOR_BOOKING_KEYS = [
  'advance_booking_hours',
  'max_advance_booking_days',
  'buffer_minutes',
  'cancellation_notice_hours',
  'cancellation_policy',
] as const;

/** Convert an editor payload into a sparse, settings-shaped patch. */
export function toSettingsPatch(flat: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  const config: Record<string, unknown> = {};
  for (const key of EDITOR_CONFIG_KEYS) {
    if (flat[key] !== undefined) config[key] = flat[key];
  }
  if (Object.keys(config).length > 0) patch.agent_config = config;

  const booking: Record<string, unknown> = {};
  for (const key of EDITOR_BOOKING_KEYS) {
    if (flat[key] !== undefined) booking[key] = flat[key];
  }
  if (Object.keys(booking).length > 0) patch.booking_rules = booking;

  const nested = new Set<string>([...EDITOR_CONFIG_KEYS, ...EDITOR_BOOKING_KEYS]);
  for (const [key, value] of Object.entries(flat)) {
    if (value === undefined || nested.has(key)) continue;
    patch[key] = value;
  }

  return patch;
}

export class DraftError extends Error {
  constructor(
    message: string,
    readonly code: 'not-found' | 'stale' | 'empty' | 'unknown-field'
  ) {
    super(message);
    this.name = 'DraftError';
  }
}

export interface DraftRow {
  settings_patch: Record<string, unknown>;
  base_fingerprint: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DraftState {
  draft: DraftRow | null;
  diff: ConfigDiff;
  /** False when the settings moved underneath the draft. Publish will refuse. */
  fresh: boolean;
}

/** Deterministic JSON: sorted keys, so key order out of Postgres cannot move the hash. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

/**
 * The current state of everything a draft can touch, as one digest.
 *
 * Scoped to `DRAFTABLE_FIELDS` rather than the whole settings row on purpose:
 * hashing `updated_at` or the prompt body would mark every pending review stale
 * the moment staff touched anything at all, and a staleness warning that fires
 * constantly is one people learn to click through.
 */
export function fingerprintSettings(
  settings: Partial<ClientSettings> | null,
  voiceId?: string | null
): string {
  const projection: Record<string, unknown> = {};
  for (const field of DRAFTABLE_FIELDS) {
    if (field === 'voice_id') continue;
    projection[field] = (settings as Record<string, unknown> | null)?.[field] ?? null;
  }
  projection.voice_id = voiceId ?? null;
  return createHash('sha256').update(canonical(projection)).digest('hex').slice(0, 32);
}

/** Current settings plus voice, in the single shape the editor and diff use. */
async function currentConfig(clientId: string): Promise<{
  flat: Record<string, unknown>;
  fingerprint: string;
  settings: ClientSettings | null;
}> {
  const [settings, client] = await Promise.all([
    clientService.getSettings(clientId),
    clientService.findById(clientId),
  ]);

  const flat: Record<string, unknown> = {};
  for (const field of DRAFTABLE_FIELDS) {
    if (field === 'voice_id') continue;
    flat[field] = (settings as unknown as Record<string, unknown> | null)?.[field] ?? null;
  }
  flat.voice_id = client?.retell_voice_id ?? null;

  return { flat, fingerprint: fingerprintSettings(settings, client?.retell_voice_id), settings };
}

/**
 * The published configuration, in the editor's shape.
 *
 * Exported for the audit wrapper: a config change is only meaningful as
 * before/after, and the route needs to read "before" without reaching into
 * storage layout the service already owns.
 */
export async function readConfig(clientId: string): Promise<Record<string, unknown>> {
  return (await currentConfig(clientId)).flat;
}

/** Reject keys outside the draftable set rather than storing what publish would ignore. */
function assertDraftable(patch: Record<string, unknown>): void {
  const unknown = Object.keys(patch).filter(
    (key) => !(DRAFTABLE_FIELDS as readonly string[]).includes(key)
  );
  if (unknown.length > 0) {
    throw new DraftError(
      `Not editable here: ${unknown.join(', ')}`,
      'unknown-field'
    );
  }
}

/**
 * Merge a sparse patch into existing state.
 *
 * Objects merge key by key so a patch touching one entry in `agent_config` does
 * not delete the vertical offering flags sitting beside it. Arrays replace
 * wholesale — an FAQ list is edited as a list, and merging two arrays positionally
 * produces something nobody asked for.
 */
function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const existing = out[key];
    const bothObjects =
      typeof value === 'object' && value !== null && !Array.isArray(value) &&
      typeof existing === 'object' && existing !== null && !Array.isArray(existing);
    out[key] = bothObjects
      ? deepMerge(existing as Record<string, unknown>, value as Record<string, unknown>)
      : value;
  }
  return out;
}

/** The pending draft with its diff, or an empty diff when there is none. */
export async function getDraft(clientId: string): Promise<DraftState> {
  const { data } = await supabase
    .from('agent_config_drafts')
    .select('settings_patch, base_fingerprint, created_by, updated_by, created_at, updated_at')
    .eq('client_id', clientId)
    .maybeSingle();

  const { flat, fingerprint } = await currentConfig(clientId);
  const draft = (data as DraftRow | null) ?? null;

  return {
    draft,
    diff: draft ? diffConfig(flat, draft.settings_patch) : { entries: [], areas: [], hasChanges: false },
    fresh: !draft || draft.base_fingerprint === fingerprint,
  };
}

interface SaveDraftInput {
  clientId: string;
  patch: Record<string, unknown>;
  actorId: string;
  actorRole: UserRole;
}

/**
 * Create or replace the pending edit.
 *
 * Replaces rather than accumulates: a draft is the current proposal, and merging
 * successive saves would make "discard" ambiguous about what it discards. The
 * fingerprint is re-taken on every save, so an editor who reloads after someone
 * else publishes is composing against what is actually stored.
 */
export async function saveDraft(input: SaveDraftInput): Promise<DraftState> {
  const { clientId, patch, actorId, actorRole } = input;

  assertDraftable(patch);
  assertWithinPromptBoundary(actorRole, patch);

  const { fingerprint } = await currentConfig(clientId);

  const { error } = await supabase.from('agent_config_drafts').upsert(
    {
      client_id: clientId,
      settings_patch: patch,
      base_fingerprint: fingerprint,
      created_by: actorId,
      updated_by: actorId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'client_id' }
  );
  if (error) throw new Error(`Failed to save draft: ${error.message}`);

  return getDraft(clientId);
}

export async function discardDraft(clientId: string): Promise<DraftRow | null> {
  const { data } = await supabase
    .from('agent_config_drafts')
    .select('settings_patch, base_fingerprint, created_by, updated_by, created_at, updated_at')
    .eq('client_id', clientId)
    .maybeSingle();

  const { error } = await supabase.from('agent_config_drafts').delete().eq('client_id', clientId);
  if (error) throw new Error(`Failed to discard draft: ${error.message}`);

  return (data as DraftRow | null) ?? null;
}

/**
 * Write a settings-shaped patch to storage.
 *
 * The single write path for agent configuration, used by both the immediate
 * PATCH and the reviewed publish. Two write paths would eventually merge JSONB
 * differently, and the failure mode of that is a client's vertical offering
 * flags disappearing on a route nobody thought was related.
 *
 * `settings` is passed in when the caller already loaded it, purely to avoid a
 * second read on the publish path.
 */
export async function applyConfigPatch(
  clientId: string,
  patch: Record<string, unknown>,
  settings?: ClientSettings | null
): Promise<void> {
  const { voice_id: voiceId, ...settingsPatch } = patch;
  const current = settings !== undefined ? settings : await clientService.getSettings(clientId);

  if (Object.keys(settingsPatch).length > 0) {
    // Merge against stored settings rather than sending the patch raw: the JSONB
    // columns carry keys this editor never shows (vertical offering flags,
    // qualification rules) and a column-level write would drop them.
    const merged: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(settingsPatch)) {
      const existing = (current as unknown as Record<string, unknown> | null)?.[key];
      merged[key] =
        typeof value === 'object' && value !== null && !Array.isArray(value) &&
        typeof existing === 'object' && existing !== null && !Array.isArray(existing)
          ? deepMerge(existing as Record<string, unknown>, value as Record<string, unknown>)
          : value;
    }
    await clientService.updateSettings(
      clientId,
      merged as Parameters<typeof clientService.updateSettings>[1]
    );
  }

  // Voice lives on `clients`, not `client_settings`.
  if (voiceId !== undefined) {
    await clientService.update(clientId, { retell_voice_id: voiceId } as never);
  }
}

export interface PublishResult {
  applied: ConfigDiff;
  syncState: 'pending';
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

interface PublishInput {
  clientId: string;
  actorId: string;
  actorRole: UserRole;
}

/**
 * Apply the pending edit and queue a re-provision.
 *
 * The staleness check is the reason this is not just "write the patch". A draft
 * is a patch, and a patch only means what it meant against the settings it was
 * composed on. If those moved — a staff edit, a version restore, the other admin
 * publishing first — then the diff the reviewer approved is not the change this
 * would make. Refusing and asking for a re-review is the only honest outcome;
 * applying it anyway silently reverts whatever landed in between.
 */
export async function publishDraft(input: PublishInput): Promise<PublishResult> {
  const { clientId, actorId, actorRole } = input;

  const { data } = await supabase
    .from('agent_config_drafts')
    .select('settings_patch, base_fingerprint')
    .eq('client_id', clientId)
    .maybeSingle();

  const draft = data as { settings_patch: Record<string, unknown>; base_fingerprint: string | null } | null;
  if (!draft) throw new DraftError('There is no pending change to publish.', 'not-found');

  const patch = draft.settings_patch ?? {};
  assertDraftable(patch);
  assertWithinPromptBoundary(actorRole, patch);

  const { flat, fingerprint, settings } = await currentConfig(clientId);

  if (draft.base_fingerprint !== fingerprint) {
    throw new DraftError(
      'This agent has changed since these edits were prepared, so publishing them now ' +
        'would undo whatever changed in between. Review the pending change again before publishing.',
      'stale'
    );
  }

  const diff = diffConfig(flat, patch);
  if (!diff.hasChanges) {
    throw new DraftError('This draft no longer changes anything.', 'empty');
  }

  await applyConfigPatch(clientId, patch, settings);

  await supabase.from('agent_config_drafts').delete().eq('client_id', clientId);
  await agentSyncService.requestSync(clientId, { userId: actorId });

  return {
    applied: diff,
    syncState: 'pending',
    // Returned so the route's audit wrapper records the real before/after rather
    // than the patch, which on its own does not say what it replaced.
    before: flat,
    after: deepMerge(flat, patch),
  };
}

/** Diff an unsaved edit without storing it — the "what would this do?" call. */
export async function previewDiff(
  clientId: string,
  patch: Record<string, unknown>
): Promise<ConfigDiff> {
  assertDraftable(patch);
  const { flat } = await currentConfig(clientId);
  return diffConfig(flat, patch);
}

export const agentDraftService = {
  getDraft,
  saveDraft,
  discardDraft,
  publishDraft,
  previewDiff,
  readConfig,
  applyConfigPatch,
  toSettingsPatch,
  fingerprintSettings,
  DRAFTABLE_FIELDS,
};
