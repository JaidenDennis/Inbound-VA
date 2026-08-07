// Shared ticket presentation helpers (used by the list + detail views).
export type TicketStatus =
  | 'investigating'
  | 'waiting_on_client'
  | 'waiting_on_third_party'
  | 'resolved'
  | 'closed';

export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';

// Client-facing labels: "waiting_on_client" reads as "Waiting on you".
export const STATUS_LABEL: Record<TicketStatus, string> = {
  investigating: 'Investigating',
  waiting_on_client: 'Waiting on you',
  waiting_on_third_party: 'Waiting on third party',
  resolved: 'Resolved',
  closed: 'Closed',
};

/**
 * Chroma is reserved for state (see DESIGN.md). A ticket's *status* is mostly a
 * category, not a health reading, so only the two statuses that genuinely mean
 * "someone is blocked" light a lamp; the rest stay achromatic. Purple and slate
 * were removed outright — neither exists in the token system, so they rendered
 * as stock Tailwind and broke the palette.
 */
export const STATUS_COLOR: Record<TicketStatus, string> = {
  investigating: 'bg-signal-50 text-signal-800 border border-signal-200',
  waiting_on_client: 'bg-lamp-fair-wash text-lamp-fair-ink border border-lamp-fair-rim',
  waiting_on_third_party: 'bg-panel-100 text-panel-700 border border-panel-200',
  resolved: 'bg-lamp-good-wash text-lamp-good-ink border border-lamp-good-rim',
  closed: 'bg-panel-100 text-panel-600 border border-panel-200',
};

/** Priority IS a severity judgement, so it maps straight onto the lamps. */
export const PRIORITY_COLOR: Record<TicketPriority, string> = {
  low: 'bg-panel-100 text-panel-600 border border-panel-200',
  normal: 'bg-panel-100 text-panel-700 border border-panel-200',
  high: 'bg-lamp-fair-wash text-lamp-fair-ink border border-lamp-fair-rim',
  urgent: 'bg-lamp-bad-wash text-lamp-bad-ink border border-lamp-bad-rim',
};

export const TICKET_STATUSES: TicketStatus[] = [
  'investigating',
  'waiting_on_client',
  'waiting_on_third_party',
  'resolved',
  'closed',
];

export const TICKET_PRIORITIES: TicketPriority[] = ['low', 'normal', 'high', 'urgent'];

export function statusLabel(s: string): string {
  return STATUS_LABEL[s as TicketStatus] ?? s;
}
export function statusColor(s: string): string {
  return STATUS_COLOR[s as TicketStatus] ?? 'bg-panel-100 text-panel-600 border border-panel-200';
}
export function priorityColor(p: string): string {
  return PRIORITY_COLOR[p as TicketPriority] ?? 'bg-panel-100 text-panel-600 border border-panel-200';
}
