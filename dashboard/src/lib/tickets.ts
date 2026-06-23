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

export const STATUS_COLOR: Record<TicketStatus, string> = {
  investigating: 'bg-blue-100 text-blue-700',
  waiting_on_client: 'bg-amber-100 text-amber-700',
  waiting_on_third_party: 'bg-purple-100 text-purple-700',
  resolved: 'bg-green-100 text-green-700',
  closed: 'bg-gray-100 text-gray-600',
};

export const PRIORITY_COLOR: Record<TicketPriority, string> = {
  low: 'bg-gray-100 text-gray-600',
  normal: 'bg-slate-100 text-slate-700',
  high: 'bg-orange-100 text-orange-700',
  urgent: 'bg-red-100 text-red-700',
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
  return STATUS_COLOR[s as TicketStatus] ?? 'bg-gray-100 text-gray-500';
}
export function priorityColor(p: string): string {
  return PRIORITY_COLOR[p as TicketPriority] ?? 'bg-gray-100 text-gray-500';
}
