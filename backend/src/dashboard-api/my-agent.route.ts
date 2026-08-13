import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission, assertClientAccess } from '../middleware/index.js';
import {
  clientService,
  agentSyncService,
  withAudit,
  agentDraftService,
  assertWithinPromptBoundary,
  describeBoundary,
  DraftError,
  PromptBoundaryError,
} from '../services/index.js';
import { toSettingsPatch } from '../services/agentDraft.service.js';
import { sanitizeAgentReadback } from './my-agent.sanitize.js';
import type { JwtPayload } from '../types/index.js';

/**
 * Client-facing agent customisation.
 *
 * This is deliberately NOT `/clients/:id/agent`, which is platform-only and can
 * change the template, the rendered prompt and the phone mapping — the things
 * that decide whether calls work at all.
 *
 * What a client may change here is everything that shapes how the agent *sounds
 * and behaves* without being able to break it:
 *
 *  - the greeting, which is theirs and is the first thing every caller hears,
 *  - names, voice, and call feel,
 *  - what it may offer: booking, transfers, callbacks, waitlist,
 *  - who gets notified, and how it says unusual words.
 *
 * The prompt itself is not exposed and cannot be written through this route.
 * Free-text prompt injection is the one edit that can silently make an agent
 * say something a business would not stand behind, so it stays with staff.
 *
 * Every accepted write queues a re-provision, so a saved change reaches live
 * calls without anyone remembering to publish.
 */

/** Voices offered in the console. A curated list beats a free-text Retell id. */
const VOICE_OPTIONS = [
  { id: '11labs-Adrian', label: 'Adrian', description: 'Warm, measured, male' },
  { id: '11labs-Amy', label: 'Amy', description: 'Bright, friendly, female' },
  { id: '11labs-Brian', label: 'Brian', description: 'Calm, professional, male' },
  { id: '11labs-Emily', label: 'Emily', description: 'Warm, upbeat, female' },
  { id: '11labs-Grace', label: 'Grace', description: 'Soft, reassuring, female' },
  { id: '11labs-Jenny', label: 'Jenny', description: 'Clear, neutral, female' },
  { id: '11labs-Marissa', label: 'Marissa', description: 'Confident, crisp, female' },
  { id: '11labs-Myra', label: 'Myra', description: 'Youthful, energetic, female' },
  { id: '11labs-Ryan', label: 'Ryan', description: 'Relaxed, conversational, male' },
  { id: '11labs-Zuri', label: 'Zuri', description: 'Rich, deliberate, female' },
] as const;

const TONE_OPTIONS = ['warm', 'professional', 'friendly', 'calm', 'energetic', 'formal'] as const;
const STYLE_OPTIONS = ['concise', 'conversational', 'detailed', 'reassuring'] as const;
const PERSONALITY_OPTIONS = ['helpful', 'efficient', 'patient', 'upbeat', 'empathetic'] as const;

const pronunciationSchema = z.object({
  word: z.string().min(1).max(100),
  alphabet: z.enum(['ipa', 'cmu']),
  phoneme: z.string().min(1).max(200),
});

const escalationSchema = z.object({
  trigger: z.string().min(1).max(200),
  action: z.enum(['email', 'sms', 'transfer']),
  target: z.string().min(1).max(200),
  priority: z.number().int().min(1).max(10).default(5),
});

const updateSchema = z.object({
  // Identity
  business_name: z.string().min(1).max(200).optional(),
  agent_name: z.string().min(1).max(100).optional(),

  // The opening line. {business} and {agent} are substituted at render time.
  opening_message: z.string().max(600).nullable().optional(),

  // Character — constrained lists, not free text, so they cannot smuggle in
  // prompt instructions through a field that looks like a preference.
  agent_personality: z.enum(PERSONALITY_OPTIONS).optional(),
  agent_tone: z.enum(TONE_OPTIONS).optional(),
  agent_response_style: z.enum(STYLE_OPTIONS).optional(),

  // Voice + call feel
  voice_id: z.enum(VOICE_OPTIONS.map((v) => v.id) as unknown as [string, ...string[]]).optional(),
  responsiveness: z.number().min(0.3).max(1).optional(),
  interruption_sensitivity: z.number().min(0.3).max(1).optional(),
  voice_temperature: z.number().min(0.2).max(1.2).optional(),

  // What the agent is allowed to do
  booking_enabled: z.boolean().optional(),
  transfer_enabled: z.boolean().optional(),
  transfer_number: z.string().max(30).nullable().optional(),
  callback_enabled: z.boolean().optional(),
  waitlist_enabled: z.boolean().optional(),
  take_messages: z.boolean().optional(),

  // Booking behaviour
  advance_booking_hours: z.number().int().min(0).max(720).optional(),
  max_advance_booking_days: z.number().int().min(1).max(365).optional(),
  buffer_minutes: z.number().int().min(0).max(120).optional(),
  cancellation_notice_hours: z.number().int().min(0).max(336).optional(),
  cancellation_policy: z.string().max(500).nullable().optional(),

  // Who hears about it
  notification_emails: z.array(z.string().email()).max(20).optional(),
  escalation_rules: z.array(escalationSchema).max(20).optional(),

  // How it says things
  pronunciation_dictionary: z.array(pronunciationSchema).max(100).optional(),
});

// The flat-editor → settings-shape mapping that used to live here now sits in
// agentDraft.service.ts, so the immediate path and the reviewed path place a
// field in the same column. See `toSettingsPatch`.

export async function myAgentRoutes(app: FastifyInstance): Promise<void> {
  /** The tenant this request acts on. Staff must name one; clients cannot. */
  function scopeFor(user: JwtPayload, requested?: string): string | null {
    const clientId = user.clientId ?? requested ?? null;
    if (!clientId) return null;
    return assertClientAccess(user, clientId) ? clientId : null;
  }

  app.get<{ Querystring: { clientId?: string } }>('/my-agent', {
    preHandler: requirePermission('knowledge:read'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const clientId = scopeFor(user, request.query.clientId);
      if (!clientId) return reply.code(403).send({ error: 'Forbidden' });

      const client = await clientService.findById(clientId);
      if (!client) return reply.code(404).send({ error: 'Client not found' });
      const settings = await clientService.getSettings(clientId);

      const config = (settings?.agent_config ?? {}) as Record<string, unknown>;
      const booking = (settings?.booking_rules ?? {}) as Record<string, unknown>;

      // The editor must never be handed a value this route's own PATCH would
      // refuse. Without this, one stored value outside `updateSchema` — an
      // older template's voice, a placeholder in the notification list — makes
      // the whole record un-editable, because the form posts it back untouched
      // with every save. See my-agent.sanitize.ts.
      const safe = sanitizeAgentReadback(
        {
          voice_id: client.retell_voice_id,
          agent_tone: settings?.agent_tone,
          agent_response_style: settings?.agent_response_style,
          agent_personality: settings?.agent_personality,
          responsiveness: config.responsiveness,
          interruption_sensitivity: config.interruption_sensitivity,
          voice_temperature: config.voice_temperature,
          notification_emails: settings?.notification_emails,
          pronunciation_dictionary: config.pronunciation_dictionary,
        },
        {
          voices: VOICE_OPTIONS.map((v) => v.id),
          tones: TONE_OPTIONS,
          styles: STYLE_OPTIONS,
          personalities: PERSONALITY_OPTIONS,
        }
      );

      reply.send({
        // Options are served with the values so the UI never hardcodes a list
        // that can drift from what the API will accept.
        options: {
          voices: VOICE_OPTIONS,
          tones: TONE_OPTIONS,
          styles: STYLE_OPTIONS,
          personalities: PERSONALITY_OPTIONS,
        },
        agent: {
          business_name: settings?.business_name ?? client.name,
          agent_name: settings?.agent_name ?? '',
          opening_message: config.opening_message ?? null,
          agent_personality: safe.agent_personality,
          agent_tone: safe.agent_tone,
          agent_response_style: safe.agent_response_style,
          voice_id: safe.voice_id,
          responsiveness: safe.responsiveness,
          interruption_sensitivity: safe.interruption_sensitivity,
          voice_temperature: safe.voice_temperature,
          booking_enabled: settings?.booking_enabled ?? false,
          transfer_enabled: config.transfer_enabled ?? false,
          transfer_number: config.transfer_number ?? null,
          callback_enabled: config.callback_enabled ?? true,
          waitlist_enabled: config.waitlist_enabled ?? false,
          take_messages: config.take_messages ?? true,
          advance_booking_hours: booking.advance_booking_hours ?? null,
          max_advance_booking_days: booking.max_advance_booking_days ?? null,
          buffer_minutes: booking.buffer_minutes ?? null,
          cancellation_notice_hours: booking.cancellation_notice_hours ?? null,
          cancellation_policy: booking.cancellation_policy ?? null,
          notification_emails: safe.notification_emails,
          escalation_rules: settings?.escalation_rules ?? [],
          pronunciation_dictionary: safe.pronunciation_dictionary,
        },
        sync: {
          state: (client as unknown as { agent_sync_state?: string }).agent_sync_state ?? 'never',
          error: (client as unknown as { agent_sync_error?: string }).agent_sync_error ?? null,
          at: (client as unknown as { agent_synced_at?: string }).agent_synced_at ?? null,
        },
      });
    },
  });

  app.patch<{ Querystring: { clientId?: string } }>('/my-agent', {
    preHandler: requirePermission('knowledge:write'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const clientId = scopeFor(user, request.query.clientId);
      if (!clientId) return reply.code(403).send({ error: 'Forbidden' });

      const body = updateSchema.parse(request.body);

      const existing = await clientService.getSettings(clientId);
      if (!existing) return reply.code(404).send({ error: 'Settings not found' });

      const patch = toSettingsPatch(body as Record<string, unknown>);

      try {
        // Belt and braces. `updateSchema` has no prompt fields, so this cannot
        // fire today — it fires the day someone adds one without thinking about
        // who can reach this route.
        assertWithinPromptBoundary(user.role, patch);

        await withAudit({
          actor: { userId: user.sub, clientId, ipAddress: request.ip, userAgent: request.headers['user-agent'] },
          action: 'agent.customised',
          entityType: 'client_settings',
          entityId: clientId,
          before: () => agentDraftService.readConfig(clientId),
          mutate: async () => {
            await agentDraftService.applyConfigPatch(clientId, patch, existing);
            return agentDraftService.readConfig(clientId);
          },
        });
      } catch (err) {
        const failure = draftFailure(err);
        if (failure) return reply.code(failure.code).send(failure.body);
        throw err;
      }

      await agentSyncService.requestSync(clientId, { userId: user.sub });
      reply.send({ ok: true, syncState: 'pending' });
    },
  });

  /**
   * What the agent will actually open with, after substitution.
   *
   * Clients type `{business}` and cannot picture the result; showing the
   * rendered line is the difference between configuring a greeting and guessing
   * at one. Read-only, and it never exposes the prompt body.
   */
  app.get<{ Querystring: { clientId?: string } }>('/my-agent/greeting-preview', {
    preHandler: requirePermission('knowledge:read'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const clientId = scopeFor(user, request.query.clientId);
      if (!clientId) return reply.code(403).send({ error: 'Forbidden' });

      const client = await clientService.findById(clientId);
      const settings = await clientService.getSettings(clientId);
      if (!client) return reply.code(404).send({ error: 'Client not found' });

      const business = settings?.business_name?.trim() || client.name?.trim() || 'our office';
      const agentName = settings?.agent_name?.trim() || 'your assistant';
      const custom = (settings?.agent_config as Record<string, unknown> | null)?.opening_message as
        | string
        | undefined;

      const rendered = custom?.trim()
        ? custom.replace(/\{business\}/gi, business).replace(/\{agent\}/gi, agentName)
        : `Thank you for calling ${business}, this is ${agentName}. How can I help you today? And just so you know, this call is being recorded.`;

      reply.send({
        rendered,
        isCustom: !!custom?.trim(),
        // Surfaced so the UI can warn rather than silently drop a legal
        // requirement the default greeting was carrying.
        mentionsRecording: /record/i.test(rendered),
      });
    },
  });

  // ────────────────────────────────────────────────────────────────
  // Review before publish
  //
  // The routes above save and re-provision in one step, which is right for a
  // one-field change. These add the reviewed path: compose the edit, read what
  // it changes, then publish it deliberately.
  //
  // Gated on `agents:write` rather than `knowledge:write` — migration 022 made
  // that grant client-reachable precisely for agent configuration, and it is
  // held by client_owner and client_admin only. The prompt stays out of reach on
  // both paths regardless of grants; that boundary is in the service.
  // ────────────────────────────────────────────────────────────────

  /** Translate service-layer refusals into the right status code, once. */
  function draftFailure(err: unknown): { code: number; body: Record<string, unknown> } | null {
    if (err instanceof PromptBoundaryError) {
      return { code: 403, body: { error: err.message, fields: err.fields, boundary: describeBoundary() } };
    }
    if (err instanceof DraftError) {
      // 409 for staleness: the request was valid and the state moved. A 400
      // would tell the UI to fix the payload, which is not the problem.
      return { code: err.code === 'stale' ? 409 : err.code === 'not-found' ? 404 : 400, body: { error: err.message, code: err.code } };
    }
    return null;
  }

  /**
   * What is yours to change and what is ours, with the reason attached.
   *
   * Served rather than hardcoded in the dashboard so the explanation cannot
   * drift from what the service actually enforces.
   */
  app.get('/my-agent/boundary', {
    preHandler: requirePermission('knowledge:read'),
    handler: async (_request, reply) => reply.send(describeBoundary()),
  });

  app.get<{ Querystring: { clientId?: string } }>('/my-agent/draft', {
    preHandler: requirePermission('agents:read'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const clientId = scopeFor(user, request.query.clientId);
      if (!clientId) return reply.code(403).send({ error: 'Forbidden' });

      reply.send(await agentDraftService.getDraft(clientId));
    },
  });

  /** Save the pending edit. Replaces any draft already in flight for this tenant. */
  app.put<{ Querystring: { clientId?: string } }>('/my-agent/draft', {
    preHandler: requirePermission('agents:write'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const clientId = scopeFor(user, request.query.clientId);
      if (!clientId) return reply.code(403).send({ error: 'Forbidden' });

      // The body is the same editor shape the PATCH takes, so the UI holds one
      // form model whether it saves directly or stages a review.
      const patch = toSettingsPatch(updateSchema.parse(request.body) as Record<string, unknown>);

      let state: Awaited<ReturnType<typeof agentDraftService.saveDraft>> | undefined;

      try {
        // The audit records the draft rows, before and after — the patch itself
        // is not yet a change to the agent, and logging it as one would put
        // unpublished edits in the same trail as live ones.
        await withAudit<Record<string, unknown> | null>({
          actor: { userId: user.sub, clientId, ipAddress: request.ip, userAgent: request.headers['user-agent'] },
          action: 'agent.draft.saved',
          entityType: 'agent_config_drafts',
          entityId: clientId,
          before: async () =>
            ((await agentDraftService.getDraft(clientId)).draft as unknown as Record<string, unknown> | null),
          mutate: async () => {
            state = await agentDraftService.saveDraft({
              clientId,
              patch,
              actorId: user.sub,
              actorRole: user.role,
            });
            return state.draft as unknown as Record<string, unknown> | null;
          },
        });
        reply.send(state);
      } catch (err) {
        const failure = draftFailure(err);
        if (failure) return reply.code(failure.code).send(failure.body);
        throw err;
      }
    },
  });

  app.delete<{ Querystring: { clientId?: string } }>('/my-agent/draft', {
    preHandler: requirePermission('agents:write'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const clientId = scopeFor(user, request.query.clientId);
      if (!clientId) return reply.code(403).send({ error: 'Forbidden' });

      await withAudit({
        actor: { userId: user.sub, clientId, ipAddress: request.ip, userAgent: request.headers['user-agent'] },
        action: 'agent.draft.discarded',
        entityType: 'agent_config_drafts',
        entityId: clientId,
        before: async () => (await agentDraftService.getDraft(clientId)).draft,
        mutate: async () => {
          await agentDraftService.discardDraft(clientId);
          return null;
        },
      });

      reply.send({ ok: true });
    },
  });

  /**
   * What an unsaved edit would change, without staging it.
   *
   * The live-feedback call: the UI asks on every meaningful edit so the
   * consequence appears beside the field, not after the fact on a review screen.
   */
  app.post<{ Querystring: { clientId?: string } }>('/my-agent/draft/preview', {
    preHandler: requirePermission('agents:read'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const clientId = scopeFor(user, request.query.clientId);
      if (!clientId) return reply.code(403).send({ error: 'Forbidden' });

      const patch = toSettingsPatch(updateSchema.parse(request.body) as Record<string, unknown>);
      try {
        reply.send(await agentDraftService.previewDiff(clientId, patch));
      } catch (err) {
        const failure = draftFailure(err);
        if (failure) return reply.code(failure.code).send(failure.body);
        throw err;
      }
    },
  });

  /**
   * Apply the pending edit and queue the re-provision.
   *
   * Refuses a draft composed against settings that have since moved — see
   * `publishDraft`. The audit row carries the full before/after configuration
   * rather than the patch, because a patch on its own does not record what it
   * replaced.
   */
  app.post<{ Querystring: { clientId?: string } }>('/my-agent/draft/publish', {
    preHandler: requirePermission('agents:write'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const clientId = scopeFor(user, request.query.clientId);
      if (!clientId) return reply.code(403).send({ error: 'Forbidden' });

      let result: Awaited<ReturnType<typeof agentDraftService.publishDraft>> | undefined;

      try {
        await withAudit({
          actor: { userId: user.sub, clientId, ipAddress: request.ip, userAgent: request.headers['user-agent'] },
          action: 'agent.draft.published',
          entityType: 'client_settings',
          entityId: clientId,
          before: () => agentDraftService.readConfig(clientId),
          mutate: async () => {
            result = await agentDraftService.publishDraft({
              clientId,
              actorId: user.sub,
              actorRole: user.role,
            });
            return result.after;
          },
        });
      } catch (err) {
        const failure = draftFailure(err);
        if (failure) return reply.code(failure.code).send(failure.body);
        throw err;
      }

      reply.send({ ok: true, syncState: 'pending', applied: result?.applied });
    },
  });
}
