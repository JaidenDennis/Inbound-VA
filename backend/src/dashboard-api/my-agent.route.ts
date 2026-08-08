import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../db/index.js';
import { requirePermission, assertClientAccess } from '../middleware/index.js';
import { clientService, agentSyncService, writeAuditLog } from '../services/index.js';
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

/** Keys that live inside client_settings.agent_config rather than a column. */
const AGENT_CONFIG_KEYS = [
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

/** Keys that belong inside booking_rules. */
const BOOKING_RULE_KEYS = [
  'advance_booking_hours',
  'max_advance_booking_days',
  'buffer_minutes',
  'cancellation_notice_hours',
  'cancellation_policy',
] as const;

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
          agent_personality: settings?.agent_personality ?? '',
          agent_tone: settings?.agent_tone ?? '',
          agent_response_style: settings?.agent_response_style ?? '',
          voice_id: client.retell_voice_id ?? '',
          responsiveness: config.responsiveness ?? null,
          interruption_sensitivity: config.interruption_sensitivity ?? null,
          voice_temperature: config.voice_temperature ?? null,
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
          notification_emails: settings?.notification_emails ?? [],
          escalation_rules: settings?.escalation_rules ?? [],
          pronunciation_dictionary: config.pronunciation_dictionary ?? [],
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

      // Merge into the existing JSONB rather than replacing it: agent_config and
      // booking_rules both carry keys this editor knows nothing about (vertical
      // offering flags, qualification fields), and a replace would delete them.
      const nextConfig: Record<string, unknown> = {
        ...((existing.agent_config as unknown as Record<string, unknown>) ?? {}),
      };
      for (const key of AGENT_CONFIG_KEYS) {
        if (body[key] !== undefined) nextConfig[key] = body[key];
      }

      const nextBooking: Record<string, unknown> = {
        ...((existing.booking_rules as unknown as Record<string, unknown>) ?? {}),
      };
      for (const key of BOOKING_RULE_KEYS) {
        if (body[key] !== undefined) nextBooking[key] = body[key];
      }

      const settingsPatch: Record<string, unknown> = { agent_config: nextConfig, booking_rules: nextBooking };
      if (body.business_name !== undefined) settingsPatch.business_name = body.business_name;
      if (body.agent_name !== undefined) settingsPatch.agent_name = body.agent_name;
      if (body.agent_personality !== undefined) settingsPatch.agent_personality = body.agent_personality;
      if (body.agent_tone !== undefined) settingsPatch.agent_tone = body.agent_tone;
      if (body.agent_response_style !== undefined) settingsPatch.agent_response_style = body.agent_response_style;
      if (body.booking_enabled !== undefined) settingsPatch.booking_enabled = body.booking_enabled;
      if (body.notification_emails !== undefined) settingsPatch.notification_emails = body.notification_emails;
      if (body.escalation_rules !== undefined) settingsPatch.escalation_rules = body.escalation_rules;

      const { error } = await supabase
        .from('client_settings')
        .update(settingsPatch)
        .eq('client_id', clientId);
      if (error) return reply.code(400).send({ error: error.message });

      // Voice lives on `clients`, not `client_settings`.
      if (body.voice_id !== undefined) {
        await clientService.update(clientId, { retell_voice_id: body.voice_id } as never);
      }

      await writeAuditLog({
        userId: user.sub,
        clientId,
        action: 'agent.customised',
        entityType: 'client_settings',
        entityId: clientId,
        newValue: body as Record<string, unknown>,
        ipAddress: request.ip,
      });

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
}
