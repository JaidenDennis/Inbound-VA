import { describe, it, expect } from 'vitest';
import { formatMoney, nextPaymentOf } from '../dashboard-api/billing.money.js';

/**
 * Money is stored in minor units as an integer and only becomes a decimal at
 * the edge. A binary float cannot represent 0.10 exactly, and the error
 * compounds across a payment history until a displayed total is visibly wrong.
 */
describe('formatMoney', () => {
  it('renders cents as a currency amount', () => {
    expect(formatMoney(78900, 'USD')).toBe('$789.00');
  });

  it('keeps trailing zeros, which a price needs', () => {
    expect(formatMoney(20000, 'USD')).toBe('$200.00');
    expect(formatMoney(1000, 'USD')).toBe('$10.00');
  });

  it('does not lose the cent that floats lose', () => {
    expect(formatMoney(10, 'USD')).toBe('$0.10');
    expect(formatMoney(30, 'USD')).toBe('$0.30');
  });

  it('handles zero and refunds', () => {
    expect(formatMoney(0, 'USD')).toBe('$0.00');
    expect(formatMoney(-5000, 'USD')).toBe('-$50.00');
  });

  it('uses the right symbol for other currencies', () => {
    expect(formatMoney(78900, 'GBP')).toBe('£789.00');
    expect(formatMoney(78900, 'EUR')).toBe('€789.00');
  });

  it('falls back to the code for a currency it has no symbol for', () => {
    expect(formatMoney(78900, 'JPY')).toBe('JPY 789.00');
  });
});

describe('nextPaymentOf', () => {
  const base = {
    plan_name: 'Standard',
    amount_cents: 78900,
    currency: 'USD',
    billing_interval: 'month' as const,
    current_period_end: '2026-09-01' as string | null,
  };

  it('is the period end while the subscription is active', () => {
    expect(nextPaymentOf({ ...base, status: 'active', cancel_at_period_end: false })).toEqual({
      date: '2026-09-01',
      amount_cents: 78900,
      currency: 'USD',
    });
  });

  it('is null when the subscription is set to cancel — nothing will be charged', () => {
    expect(nextPaymentOf({ ...base, status: 'active', cancel_at_period_end: true })).toBeNull();
  });

  it('is null for a cancelled subscription', () => {
    expect(nextPaymentOf({ ...base, status: 'cancelled', cancel_at_period_end: false })).toBeNull();
  });

  it('is null when no period end is recorded, rather than guessing one', () => {
    expect(
      nextPaymentOf({
        ...base,
        current_period_end: null,
        status: 'active',
        cancel_at_period_end: false,
      })
    ).toBeNull();
  });

  it('still reports a due date when payment is overdue — that is the useful case', () => {
    expect(nextPaymentOf({ ...base, status: 'past_due', cancel_at_period_end: false })).toEqual({
      date: '2026-09-01',
      amount_cents: 78900,
      currency: 'USD',
    });
  });

  it('is null with no subscription at all', () => {
    expect(nextPaymentOf(null)).toBeNull();
  });
});
