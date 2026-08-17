'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { format, parseISO } from 'date-fns';
import { CreditCard, Mail, ReceiptText, Save, MessageSquare } from 'lucide-react';
import clsx from 'clsx';
import { api, errorMessage } from '@/lib/api';
import { useSession } from '@/lib/SessionProvider';
import { StatusLamp, type LampLevel } from '@/components/StatusLamp';

/**
 * Billing.
 *
 * No payment provider is connected yet — subscription and payment rows are
 * entered by staff (migration 036) and read here. Nothing on this surface is
 * computed or assumed: if the API says `connected: false` this shows an empty
 * state rather than a zero, because a customer believes what a billing page
 * tells them and a fabricated figure is worse than a blank one.
 *
 * Changing or cancelling a plan opens a conversation rather than posting to an
 * endpoint. With no provider behind it, a "Cancel" button could only write a
 * row and hope somebody noticed — a control that looks like it did something
 * and did not is the worst option available.
 */

const SUB_TABS = [
  { key: 'subscription', label: 'Subscription' },
  { key: 'payments', label: 'Payments' },
  { key: 'notifications', label: 'Notifications' },
] as const;

type SubTab = (typeof SUB_TABS)[number]['key'];

interface Payment {
  id: string;
  paid_at: string;
  amount_display: string;
  status: string;
  description: string | null;
  method_brand: string | null;
  method_last4: string | null;
  invoice_url: string | null;
}

interface BillingData {
  connected: boolean;
  subscription: {
    plan_name: string;
    amount_display: string;
    billing_interval: 'month' | 'year';
    status: string;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
  } | null;
  next_payment: { date: string; amount_display: string } | null;
  payments: Payment[];
  payment_method: { brand: string | null; last4: string | null } | null;
  billing_notification_email: string | null;
}

const STATUS_LAMP: Record<string, LampLevel> = {
  active: 'good',
  trialing: 'good',
  past_due: 'bad',
  cancelled: 'off',
};

const PAYMENT_TONE: Record<string, string> = {
  paid: 'text-lamp-good-ink',
  refunded: 'text-text-muted',
  failed: 'text-lamp-bad-ink',
};

const BILLING_MAILTO =
  'mailto:hello@gravvia.com?subject=Billing%20question&body=Hello%20—%20I%20have%20a%20question%20about%20my%20subscription.';

function NotConnected({ what }: { what: string }) {
  return (
    <div className="border border-hairline bg-surface-raised px-5 py-10 text-center">
      <p className="text-sm font-medium text-text">Nothing to show yet</p>
      <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-text-muted">
        {what} will appear here once your billing is set up. Nothing is shown in the meantime
        rather than figures that are not real.
      </p>
      <a
        href={BILLING_MAILTO}
        className="mt-5 inline-flex items-center gap-2 border border-action px-4 py-2.5 text-sm font-medium text-action transition-colors duration-150 hover:bg-action hover:text-[rgb(var(--action-contrast-rgb))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
      >
        <MessageSquare className="h-4 w-4 text-current" aria-hidden strokeWidth={1.75} />
        Have a billing question?
      </a>
    </div>
  );
}

export function Billing({ clientId }: { clientId: string | null }) {
  const { can } = useSession();
  const [tab, setTab] = useState<SubTab>('subscription');
  const [data, setData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);

  // Gates only the notification email — the one field on this tab a tenant
  // owns. Same split as the business profile; see migration 037.
  const writable = can('account:write');

  useEffect(() => {
    let cancelled = false;
    api
      .get('/billing', { params: clientId ? { clientId } : {} })
      .then((r) => {
        if (cancelled) return;
        setData(r.data);
        setEmail(r.data.billing_notification_email ?? '');
      })
      .catch((e) => {
        if (!cancelled) toast.error(errorMessage(e, 'Could not load billing'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const saveEmail = async () => {
    setSavingEmail(true);
    try {
      await api.put(
        '/billing/notifications',
        { billing_notification_email: email.trim() || null },
        { params: clientId ? { clientId } : {} }
      );
      toast.success('Billing notifications updated');
    } catch (e) {
      toast.error(errorMessage(e, 'Could not save that email'));
    } finally {
      setSavingEmail(false);
    }
  };

  if (loading) return <div className="h-72 animate-pulse bg-panel-100" />;

  const sub = data?.subscription ?? null;

  return (
    <div className="max-w-3xl">
      {/* Sub-tabs are local state, not URL state: the parent Settings tab
          already owns ?tab=, and nesting a second param makes a link that
          restores one but not the other. */}
      <div role="tablist" className="mb-6 flex gap-1 border-b border-hairline">
        {SUB_TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={clsx(
              '-mb-px cursor-pointer px-3 py-2.5 font-mono text-2xs uppercase tracking-[0.16em] transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action',
              tab === t.key
                ? 'border-b-2 border-action text-action'
                : 'border-b-2 border-transparent text-text-muted hover:border-rule hover:text-text'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ---- Subscription ---- */}
      {tab === 'subscription' &&
        (!sub ? (
          <NotConnected what="Your plan and next payment" />
        ) : (
          <div className="space-y-5">
            <div className="border border-edge bg-surface-raised">
              <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-hairline px-5 py-3.5">
                <div className="flex items-center gap-2.5">
                  <StatusLamp
                    level={STATUS_LAMP[sub.status] ?? 'off'}
                    size="md"
                    label={sub.status}
                  />
                  <h3 className="font-heading text-base font-medium text-text">{sub.plan_name}</h3>
                </div>
                <span className="font-mono text-2xs uppercase tracking-[0.16em] text-text-muted">
                  {sub.status.replace('_', ' ')}
                </span>
              </div>

              <dl className="grid grid-cols-1 sm:grid-cols-2">
                <div className="border-b border-hairline px-5 py-4 sm:border-r">
                  <dt className="font-mono text-2xs uppercase tracking-[0.16em] text-text-muted">
                    Amount
                  </dt>
                  <dd data-numeric className="mt-1.5 font-heading text-2xl font-medium text-text">
                    {sub.amount_display}
                    <span className="ml-1 text-sm font-normal text-text-muted">
                      / {sub.billing_interval}
                    </span>
                  </dd>
                </div>

                <div className="border-b border-hairline px-5 py-4">
                  <dt className="font-mono text-2xs uppercase tracking-[0.16em] text-text-muted">
                    Next payment
                  </dt>
                  <dd className="mt-1.5">
                    {data?.next_payment ? (
                      <>
                        <span data-numeric className="font-heading text-2xl font-medium text-text">
                          {data.next_payment.amount_display}
                        </span>
                        <span className="ml-2 text-sm text-text-secondary">
                          on {format(parseISO(data.next_payment.date), 'd MMM yyyy')}
                        </span>
                      </>
                    ) : (
                      // Explains itself rather than showing a dash. "No further
                      // payments" and "we don't know" are different answers.
                      <span className="text-sm text-text-secondary">
                        {sub.cancel_at_period_end
                          ? `None — your plan ends ${
                              sub.current_period_end
                                ? format(parseISO(sub.current_period_end), 'd MMM yyyy')
                                : 'at the end of this period'
                            }`
                          : sub.status === 'cancelled'
                            ? 'None — this plan is cancelled'
                            : 'Not scheduled yet'}
                      </span>
                    )}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="border border-hairline bg-action-50 px-5 py-4">
              <p className="text-sm font-medium text-text">
                Want to change or cancel your subscription?
              </p>
              <p className="mt-1 max-w-prose text-xs leading-relaxed text-text-secondary">
                Plan changes and cancellations are handled by your account manager, so nothing
                changes on your account without a person confirming it with you.
              </p>
              <a
                href={BILLING_MAILTO}
                className="mt-3.5 inline-flex items-center gap-2 border border-action bg-action px-4 py-2.5 text-sm font-medium text-[rgb(var(--action-contrast-rgb))] transition-colors duration-150 hover:bg-transparent hover:text-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
              >
                <MessageSquare className="h-4 w-4 text-current" aria-hidden strokeWidth={1.75} />
                Have a billing question?
              </a>
            </div>
          </div>
        ))}

      {/* ---- Payments ---- */}
      {tab === 'payments' &&
        (!data || data.payments.length === 0 ? (
          <NotConnected what="Your payment history" />
        ) : (
          <div className="space-y-5">
            {data.payment_method && (
              <div className="flex items-center gap-3 border border-hairline bg-surface-raised px-5 py-4">
                <CreditCard className="h-4 w-4 flex-shrink-0 text-text-muted" aria-hidden strokeWidth={1.75} />
                <div>
                  <p className="font-mono text-2xs uppercase tracking-[0.16em] text-text-muted">
                    Payment method
                  </p>
                  <p className="mt-0.5 text-sm text-text">
                    {data.payment_method.brand ?? 'Card'} ending{' '}
                    <span data-numeric className="font-mono">
                      {data.payment_method.last4}
                    </span>
                  </p>
                </div>
              </div>
            )}

            <div className="border border-hairline bg-surface-raised">
              <div className="border-b border-rule px-5 py-2.5">
                <span className="font-mono text-2xs uppercase tracking-[0.16em] text-text-muted">
                  Payment history
                </span>
              </div>
              <ul>
                {data.payments.map((p, i) => (
                  <li
                    key={p.id}
                    className={clsx(
                      'flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-3',
                      i > 0 && 'border-t border-hairline'
                    )}
                  >
                    <span data-numeric className="font-mono text-2xs text-text-muted">
                      {format(parseISO(p.paid_at), 'd MMM yyyy')}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-text">
                      {p.description ?? 'Subscription'}
                    </span>
                    <span
                      data-numeric
                      className={clsx('text-sm font-medium', PAYMENT_TONE[p.status] ?? 'text-text')}
                    >
                      {p.amount_display}
                    </span>
                    <span className="font-mono text-2xs uppercase tracking-[0.14em] text-text-muted">
                      {p.status}
                    </span>
                    {p.invoice_url && (
                      <a
                        href={p.invoice_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-2xs text-action underline decoration-action/40 underline-offset-2 transition-colors hover:decoration-action"
                      >
                        <ReceiptText className="h-3 w-3" aria-hidden />
                        Invoice
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}

      {/* ---- Notifications ---- */}
      {tab === 'notifications' && (
        <div className="max-w-xl">
          <div className="mb-5 flex items-start gap-3 border border-hairline bg-surface-raised px-4 py-3">
            <Mail className="mt-0.5 h-4 w-4 flex-shrink-0 text-text-muted" aria-hidden strokeWidth={1.75} />
            <p className="text-xs leading-relaxed text-text-secondary">
              Where invoices and payment notices go. Kept separate from your operational alerts
              on purpose — the person who wants to know a booking came in is rarely the person
              who needs to know a card was declined.
            </p>
          </div>

          <label
            htmlFor="billing-email"
            className="mb-1.5 block font-mono text-2xs uppercase tracking-[0.16em] text-text-secondary"
          >
            Billing email
          </label>
          <input
            id="billing-email"
            type="email"
            value={email}
            disabled={!writable}
            placeholder="accounts@yourbusiness.com"
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border border-rule bg-surface-raised px-3 py-2.5 text-sm text-text transition-colors duration-150 placeholder:text-text-muted hover:border-text-faint focus:border-action focus:outline-none focus:ring-2 focus:ring-action/25 disabled:cursor-not-allowed disabled:text-text-muted"
          />
          <p className="mt-1.5 text-2xs text-text-muted">
            Leave empty to use your account&rsquo;s main contact.
          </p>

          {writable && (
            <button
              type="button"
              onClick={saveEmail}
              disabled={savingEmail}
              className="mt-4 flex cursor-pointer items-center gap-2 border border-action bg-action px-4 py-2.5 text-sm font-medium text-[rgb(var(--action-contrast-rgb))] transition-colors duration-150 hover:bg-transparent hover:text-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action disabled:cursor-not-allowed disabled:border-rule disabled:bg-transparent disabled:text-text-muted"
            >
              <Save className="h-4 w-4 text-current" aria-hidden strokeWidth={1.75} />
              {savingEmail ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
