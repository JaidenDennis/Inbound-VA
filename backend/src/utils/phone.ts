/**
 * Is this a number a telephony provider can actually dial?
 *
 * E.164: a leading +, a non-zero country digit, at most 15 digits.
 *
 * Shared deliberately. The renderer uses it to decide whether to give an agent
 * a transfer tool, and the settings route uses it to refuse a transfer that
 * could never connect. Two copies of this rule would drift, and the failure
 * that causes is the silent one: the dashboard accepts a number, the renderer
 * rejects it, and the client is left with a transfer switch that does nothing
 * and says nothing.
 */
export const E164 = /^\+[1-9]\d{1,14}$/;

export function isDialable(value: unknown): value is string {
  return typeof value === 'string' && E164.test(value.trim());
}
