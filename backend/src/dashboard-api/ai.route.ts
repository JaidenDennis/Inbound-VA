import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../db/index.js';
import { requirePermission, assertClientAccess, isPlatformUser } from '../middleware/index.js';
import { writeAuditLog, auditTranscriptView } from '../services/index.js';
import { isAiConfigured } from '../ai/claude.client.js';
import { askAssistant } from '../ai/assistant.service.js';
import { draftFaqs, draftGreetings } from '../ai/copilot.service.js';
import { analyzeCall } from '../ai/call-intelligence.service.js';
import { draftTicket } from '../ai/ticket-draft.service.js';
import type { JwtPayload } from '../types/index.js';

/**
 * AI surfaces.
 *
 * The tenant scope for every route is derived from the JWT, never from the
 * request body — the model is given a context object it cannot influence. A
 * client user is pinned to their own tenant; platform staff may name one or
 * work across all of them.
 *
 * Every route degrades to a 503 with an explanation when no API key is
 * configured, so an unconfigured deployment shows "AI is off" rather than a
 * stack trace.
 */

export async function aiRoutes(app: FastifyInstance): Promise<void> {
  /** Shared guard: AI available, and the caller's tenant scope resolved. */
  function scopeFor(
    user: JwtPayload,
    requested?: string
  ): { ok: true; clientId: string | null } | { ok: false } {
    const clientId = user.clientId ?? requested ?? null;
    if (!clientId) return isPlatformUser(user) ? { ok: true, clientId: null } : { ok: false };
    return assertClientAccess(user, clientId) ? { ok: true, clientId } : { ok: false };
  }

  const unavailable = { error: 'AI features are not enabled on this deployment.' };

  app.get('/ai/status', {
    preHandler: requirePermission('clients:read'),
    handler: async (_request, reply) => reply.send({ enabled: isAiConfigured() }),
  });

  /**
   * Ask-your-data chat.
   *
   * The whole conversation is sent each turn — the API is stateless and we
   * deliberately do not persist assistant threads: they would be a second copy
   * of tenant data with its own access-control surface, for a feature whose
   * value is entirely in the moment.
   */
  const chatSchema = z.object({
    clientId: z.string().uuid().optional(),
    messages: z
      .array(
        z.object({
          role: z.enum(['user', 'assistant']),
          content: z.string().min(1).max(8000),
        })
      )
      .min(1)
      .max(40),
  });

  app.post('/ai/assistant', {
    preHandler: requirePermission('clients:read'),
    handler: async (request, reply) => {
      if (!isAiConfigured()) return reply.code(503).send(unavailable);

      const user = request.user as JwtPayload;
      const body = chatSchema.parse(request.body);
      const scope = scopeFor(user, body.clientId);
      if (!scope.ok) return reply.code(403).send({ error: 'Forbidden' });

      try {
        const result = await askAssistant(
          body.messages,
          { clientId: scope.clientId },
          isPlatformUser(user) ? 'staff' : 'client'
        );
        reply.send(result);
      } catch (err) {
        request.log.error({ err }, 'Assistant failed');
        reply.code(502).send({ error: 'The assistant could not answer that. Try again shortly.' });
      }
    },
  });

  /** Copilot: draft FAQs. Returns suggestions only — the client saves them. */
  app.post('/ai/copilot/faqs', {
    preHandler: requirePermission('knowledge:write'),
    handler: async (request, reply) => {
      if (!isAiConfigured()) return reply.code(503).send(unavailable);

      const user = request.user as JwtPayload;
      const body = z
        .object({ clientId: z.string().uuid().optional(), topic: z.string().max(300).optional() })
        .parse(request.body);

      const scope = scopeFor(user, body.clientId);
      if (!scope.ok || !scope.clientId) {
        return reply.code(400).send({ error: 'Pick a client first — knowledge is per-client.' });
      }

      try {
        reply.send({ data: await draftFaqs(scope.clientId, body.topic) });
      } catch (err) {
        request.log.error({ err }, 'FAQ drafting failed');
        reply.code(502).send({ error: 'Could not draft FAQs right now.' });
      }
    },
  });

  /** Copilot: draft opening lines. */
  app.post('/ai/copilot/greeting', {
    preHandler: requirePermission('knowledge:write'),
    handler: async (request, reply) => {
      if (!isAiConfigured()) return reply.code(503).send(unavailable);

      const user = request.user as JwtPayload;
      const body = z
        .object({ clientId: z.string().uuid().optional(), brief: z.string().max(500).optional() })
        .parse(request.body);

      const scope = scopeFor(user, body.clientId);
      if (!scope.ok || !scope.clientId) {
        return reply.code(400).send({ error: 'Pick a client first.' });
      }

      try {
        reply.send({ data: await draftGreetings(scope.clientId, body.brief) });
      } catch (err) {
        request.log.error({ err }, 'Greeting drafting failed');
        reply.code(502).send({ error: 'Could not draft greetings right now.' });
      }
    },
  });

  /**
   * Per-call intelligence.
   *
   * Reading a transcript needs `transcripts:read`, not `calls:read` — the same
   * split the rest of the console uses, because a transcript carries caller PII
   * that a viewer role is not granted.
   */
  app.post<{ Params: { id: string } }>('/ai/calls/:id/analyze', {
    preHandler: requirePermission('transcripts:read'),
    handler: async (request, reply) => {
      if (!isAiConfigured()) return reply.code(503).send(unavailable);

      const user = request.user as JwtPayload;
      const { data: call } = await supabase
        .from('calls')
        .select('client_id')
        .eq('id', request.params.id)
        .maybeSingle();
      if (!call) return reply.code(404).send({ error: 'Call not found' });

      if (!assertClientAccess(user, (call as { client_id: string }).client_id)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      try {
        const analysis = await analyzeCall(request.params.id);
        if (!analysis) {
          return reply
            .code(422)
            .send({ error: 'This call has no transcript yet, so there is nothing to analyse.' });
        }

        // Analysing a transcript is still reading it — the content goes to a
        // model and comes back as prose about what the caller said. The access
        // record does not care which of those the user asked for.
        await auditTranscriptView(
          {
            userId: user.sub,
            clientId: (call as { client_id: string }).client_id,
            ipAddress: request.ip,
            userAgent: request.headers['user-agent'],
          },
          request.params.id,
          request.params.id
        );

        reply.send(analysis);
      } catch (err) {
        request.log.error({ err }, 'Call analysis failed');
        reply.code(502).send({ error: 'Could not analyse that call right now.' });
      }
    },
  });

  /**
   * AI-assisted ticket creation.
   *
   * Two steps on purpose: draft, then submit. The client sees exactly what will
   * be filed and edits it first, so a misread description never becomes a
   * ticket they did not write.
   */
  app.post('/ai/support/draft', {
    preHandler: requirePermission('tickets:write'),
    handler: async (request, reply) => {
      if (!isAiConfigured()) return reply.code(503).send(unavailable);

      const user = request.user as JwtPayload;
      const body = z
        .object({
          clientId: z.string().uuid().optional(),
          description: z.string().min(10).max(4000),
        })
        .parse(request.body);

      const scope = scopeFor(user, body.clientId);
      if (!scope.ok || !scope.clientId) {
        return reply.code(400).send({ error: 'Pick a client first.' });
      }

      try {
        const draft = await draftTicket(scope.clientId, body.description);
        if (!draft) return reply.code(502).send({ error: 'Could not draft that ticket.' });

        await writeAuditLog({
          userId: user.sub,
          clientId: scope.clientId,
          action: 'ai.ticket.drafted',
          entityType: 'ticket',
          entityId: scope.clientId,
          ipAddress: request.ip,
        });

        reply.send(draft);
      } catch (err) {
        request.log.error({ err }, 'Ticket drafting failed');
        reply.code(502).send({ error: 'Could not draft that ticket right now.' });
      }
    },
  });
}
