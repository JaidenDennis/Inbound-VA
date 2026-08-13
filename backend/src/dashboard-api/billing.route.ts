import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../db/index.js';
import { requirePermission, assertClientAccess } from '../middleware/index.js';
import { withAudit } from '../services/index.js';
import { formatMoney, nextPaymentOf, type SubscriptionRow } from './billing.money.js';
import type { JwtPayload } from '../types/index.js';

/**
 * Billing, read-mostly.
 *
 * There is no payment provider connected yet (see migration 036). Subscription
 * and payment rows are entered by staff for now, and this reads them. Nothing
 * here computes or invents a figure: if the tables are empty the API says so
 * and the UI shows an empty state, because a customer believes what a billing
 * page tells them.
 *
 * The one thing a client may WRITE is where billing notices go. Changing a plan
 * or cancelling is deliberately not an endpoint: with no provider behind it,
 * a "Cancel subscription" button could only write a row and hope a human
 * noticed. It opens a conversation instead, which is what actually happens.
 */

const emailSchema = z.object({
  // Nullable, not just optional: clearing the field must be expressible.
  billing_notification_email: z.string().trim().email().max(200).nullable(),
});

export async function billingRoutes(app: FastifyInstance): Promise<void> {
  function scopeFor(user: JwtPayload, requested?: string): string | null {
    const clientId = user.clientId ?? requested ?? null;
    if (!clientId) return null;
    return assertClientAccess(user, clientId) ? clientId : null;
  }

  /**
   * Everything the Billing tab needs, in one request.
   *
   * Three sub-tabs that always render together are three round trips for no
   * benefit, and a split would let the "next payment" figure and the payment
   * history disagree while one is still loading.
   */
  app.get<{ Querystring: { clientId?: string } }>('/billing', {
    // settings:read, not a billing-specific grant: this is account
    // configuration, and inventing a permission means every existing role has
    // to be taught about it before anyone can see their own invoices.
    preHandler: requirePermission('settings:read'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const clientId = scopeFor(user, request.query.clientId);
      if (!clientId) return reply.code(403).send({ error: 'Forbidden' });

      const [subRes, payRes, setRes] = await Promise.all([
        supabase
          .from('client_subscriptions')
          .select(
            'plan_name, amount_cents, currency, billing_interval, status, current_period_end, cancel_at_period_end, provider'
          )
          .eq('client_id', clientId)
          .maybeSingle(),
        supabase
          .from('client_payments')
          .select(
            'id, paid_at, amount_cents, currency, status, description, method_brand, method_last4, invoice_url'
          )
          .eq('client_id', clientId)
          .order('paid_at', { ascending: false })
          .limit(50),
        supabase
          .from('client_settings')
          .select('billing_notification_email')
          .eq('client_id', clientId)
          .maybeSingle(),
      ]);

      const subscription = (subRes.data ?? null) as (SubscriptionRow & { provider: string }) | null;
      const payments = (payRes.data ?? []) as Array<{
        id: string;
        paid_at: string;
        amount_cents: number;
        currency: string;
        status: string;
        description: string | null;
        method_brand: string | null;
        method_last4: string | null;
        invoice_url: string | null;
      }>;

      const next = nextPaymentOf(subscription);

      reply.send({
        // `connected` is the honest signal the UI branches on. False means no
        // provider and no staff-entered record — not "zero pounds owed".
        connected: subscription !== null,
        subscription: subscription && {
          ...subscription,
          amount_display: formatMoney(subscription.amount_cents, subscription.currency),
        },
        next_payment: next && {
          ...next,
          amount_display: formatMoney(next.amount_cents, next.currency),
        },
        payments: payments.map((p) => ({
          ...p,
          amount_display: formatMoney(p.amount_cents, p.currency),
        })),
        // The card that paid most recently. Read off the payments rather than
        // stored separately, so it cannot claim a card that never charged.
        payment_method: payments.find((p) => p.method_last4)
          ? {
              brand: payments.find((p) => p.method_last4)!.method_brand,
              last4: payments.find((p) => p.method_last4)!.method_last4,
            }
          : null,
        billing_notification_email:
          (setRes.data as { billing_notification_email?: string | null } | null)
            ?.billing_notification_email ?? null,
      });
    },
  });

  /** Where payment and invoice notices go. */
  app.put<{ Querystring: { clientId?: string } }>('/billing/notifications', {
    preHandler: requirePermission('settings:write'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const clientId = scopeFor(user, request.query.clientId);
      if (!clientId) return reply.code(403).send({ error: 'Forbidden' });

      const body = emailSchema.parse(request.body);

      const updated = await withAudit({
        actor: {
          userId: user.sub,
          clientId,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        },
        action: 'client.billing_email.updated',
        entityType: 'client_settings',
        entityId: clientId,
        before: async () => {
          const { data } = await supabase
            .from('client_settings')
            .select('billing_notification_email')
            .eq('client_id', clientId)
            .maybeSingle();
          return (data as Record<string, unknown> | null) ?? null;
        },
        mutate: async () => {
          const { data, error } = await supabase
            .from('client_settings')
            .update({ billing_notification_email: body.billing_notification_email })
            .eq('client_id', clientId)
            .select('billing_notification_email')
            .single();
          if (error) throw new Error(error.message);
          return data as Record<string, unknown>;
        },
      });

      reply.send(updated);
    },
  });
}
