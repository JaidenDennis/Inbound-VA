import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/index.js';
import { clayLeadService, ClayIngestError } from '../../services/clay-lead.service.js';

/**
 * The website intake form.
 *
 * Reuses the lead pipeline the Clay ingest already runs on
 * (clay-lead.service): contact upsert by identity, so someone who called last
 * week and then fills in the form is ONE contact; the CRM write queued through
 * crmSyncQueue, so it retries, dead-letters and lands in crm_sync_logs; and an
 * idempotency key, so a double-submit does not open two opportunities.
 *
 * WHY THIS IS NOT /webhooks/clay/lead
 *
 * That route is guarded by a shared secret. gravvia.com is a Render Static
 * Site with no server side, so a secret used from the form would sit in
 * browser JavaScript, readable by anyone opening view-source — and would then
 * authorise writes into the CRM at Clay's 600-per-window limit. A secret that
 * is public is worse than no secret, because it looks like authentication.
 *
 * So this endpoint is unauthenticated by design, and defended by the things
 * that actually work against a public form:
 *
 *   1. It refuses to exist unless SITE_LEAD_CLIENT_ID names a tenant.
 *   2. Origin must be on the SITE_LEAD_ORIGINS allow-list.
 *   3. A tight per-IP rate limit — 5, not Clay's 600.
 *   4. A honeypot field no human ever sees or fills.
 *   5. A minimum fill time; a form completed in under three seconds was not typed.
 *
 * None of these stop a determined attacker, and none pretend to. They stop
 * commodity form spam, which is the actual threat to a contact form. A captcha
 * belongs here only once spam is observed, not before — it costs every real
 * visitor something to deter an attack that may never come.
 */

const siteLeadSchema = z.object({
  // Matches the field names in gravvia-site/start.html.
  name: z.string().trim().min(1).max(120),
  business: z.string().trim().max(160).optional(),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().max(40).optional(),
  industry: z.string().trim().max(120).optional(),
  volume: z.coerce.number().int().nonnegative().max(1_000_000).optional(),
  crm: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(4000).optional(),

  /**
   * Honeypot. Hidden from people by CSS and never focusable, so anything in it
   * came from a bot filling every input it found. Named to look worth filling.
   */
  company_website: z.string().max(200).optional(),

  /**
   * Milliseconds the form was on screen before submitting, set by the page.
   * Trivially forgeable — that is fine. It costs a spammer a code change and
   * costs us nothing, which is the correct trade for commodity spam.
   */
  elapsedMs: z.coerce.number().int().nonnegative().optional(),
});

/** Requests that look automated are accepted and dropped, never rejected. */
function looksAutomated(body: z.infer<typeof siteLeadSchema>): string | null {
  if (body.company_website && body.company_website.trim().length > 0) return 'honeypot filled';
  if (body.elapsedMs !== undefined && body.elapsedMs < env.SITE_LEAD_MIN_FILL_MS) {
    return `submitted in ${body.elapsedMs}ms`;
  }
  return null;
}

function originAllowed(request: FastifyRequest): boolean {
  const allowed = (env.SITE_LEAD_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (allowed.length === 0) return false;

  // Origin is set by the browser on cross-origin POSTs and cannot be spoofed
  // by page JavaScript. It is absent on same-origin and on non-browser callers
  // like curl — which is why this is one layer of several, not the lock.
  const origin = request.headers.origin;
  return typeof origin === 'string' && allowed.includes(origin);
}

export async function siteLeadRoute(app: FastifyInstance): Promise<void> {
  app.post('/webhooks/site/lead', {
    config: {
      rateLimit: {
        max: env.SITE_LEAD_RATE_LIMIT_MAX,
        timeWindow: env.RATE_LIMIT_WINDOW_MS,
      },
    },
    handler: async (request, reply) => {
      if (!env.SITE_LEAD_CLIENT_ID) {
        request.log.warn('Site lead posted but SITE_LEAD_CLIENT_ID is not configured');
        return reply.code(503).send({ error: 'The intake form is not configured yet.' });
      }

      if (!originAllowed(request)) {
        request.log.warn({ origin: request.headers.origin }, 'Site lead from disallowed origin');
        return reply.code(403).send({ error: 'Not allowed from this origin.' });
      }

      const body = siteLeadSchema.parse(request.body);

      // Answer 202 to a bot exactly as to a person. Telling a spammer which
      // check caught them is free tuning information, and a real visitor who
      // trips the timer by pasting a saved answer is not shown an error for it.
      const automated = looksAutomated(body);
      if (automated) {
        request.log.info({ reason: automated }, 'Site lead discarded as automated');
        return reply.code(202).send({ received: true });
      }

      try {
        const result = await clayLeadService.ingest({
          clientId: env.SITE_LEAD_CLIENT_ID,
          // The submitted email anchors idempotency, so a double-click or a
          // retry after a flaky connection does not open a second opportunity.
          recordId: `site:${body.email.toLowerCase()}`,
          fullName: body.name,
          email: body.email,
          ...(body.phone ? { phone: body.phone } : {}),
          ...(body.business ? { company: body.business } : {}),
          ...(body.industry ? { industry: body.industry } : {}),
          ...(body.volume !== undefined ? { callVolume: body.volume } : {}),
          ...(body.notes ? { notes: body.notes } : {}),
          // Distinguishes a website enquiry from a Clay-sourced prospect and
          // from a lead captured on a call — three very different things that
          // would otherwise be indistinguishable in the CRM.
          source: 'website',
          tags: ['website-intake'],
          ...(body.crm ? { customFields: { 'Current CRM': body.crm } } : {}),
        });

        return reply.code(202).send({ received: true, reference: result.contactId.slice(0, 8) });
      } catch (err) {
        if (err instanceof ClayIngestError) {
          // The visitor is not shown the CRM's problem — it is not theirs and
          // they can do nothing with it. It is logged at error level because
          // it means enquiries are being lost and someone must look.
          request.log.error({ err: err.message }, 'Site lead could not be ingested');
          return reply
            .code(502)
            .send({ error: 'We could not record that just now. Please email hello@gravvia.com.' });
        }
        throw err;
      }
    },
  });
}
