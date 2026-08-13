/**
 * Money handling for the billing surface.
 *
 * Amounts are stored and passed around as INTEGER minor units (cents) and only
 * become a decimal string here, at the edge. A binary float cannot represent
 * 0.10 exactly, and the error compounds across a payment history until a
 * displayed total is visibly wrong — the kind of wrong a customer notices on a
 * bill before anyone else does.
 */

/** Symbols for the currencies this product actually bills in. */
const SYMBOL: Record<string, string> = {
  USD: '$',
  CAD: '$',
  AUD: '$',
  GBP: '£',
  EUR: '€',
};

export function formatMoney(amountCents: number, currency: string): string {
  const code = currency.toUpperCase();
  const negative = amountCents < 0;
  const abs = Math.abs(amountCents);

  // Integer arithmetic throughout: no division into a float anywhere.
  const major = Math.floor(abs / 100);
  const minor = String(abs % 100).padStart(2, '0');
  const amount = `${major.toLocaleString('en-US')}.${minor}`;

  const symbol = SYMBOL[code];
  // An unknown currency shows its code rather than a wrong symbol. Guessing
  // that JPY uses '$' would misstate a price, which is worse than being plain.
  const body = symbol ? `${symbol}${amount}` : `${code} ${amount}`;

  // The sign leads, outside the symbol: "-$50.00", the way a refund is written.
  return negative ? `-${body}` : body;
}

export interface SubscriptionRow {
  plan_name: string;
  amount_cents: number;
  currency: string;
  billing_interval: 'month' | 'year';
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

export interface NextPayment {
  date: string;
  amount_cents: number;
  currency: string;
}

/**
 * When the customer will next be charged, and how much — or null if they will
 * not be.
 *
 * Null in three cases, all of which mean "no payment is coming": the
 * subscription is cancelled, it is set to cancel at the end of the paid period,
 * or no period end is recorded. That last one is deliberately not a guess.
 * Adding an interval to `created_at` to invent a date would put a number on a
 * billing page that nothing in the system actually intends to charge.
 *
 * `past_due` DOES return a date. An overdue payment is exactly the case where
 * the customer needs to see what is owed and when it was due.
 */
export function nextPaymentOf(subscription: SubscriptionRow | null): NextPayment | null {
  if (!subscription) return null;
  if (subscription.status === 'cancelled') return null;
  if (subscription.cancel_at_period_end) return null;
  if (!subscription.current_period_end) return null;

  return {
    date: subscription.current_period_end,
    amount_cents: subscription.amount_cents,
    currency: subscription.currency,
  };
}
