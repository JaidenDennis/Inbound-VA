export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';

export type TicketStatus =
  | 'investigating'
  | 'waiting_on_client'
  | 'waiting_on_third_party'
  | 'resolved'
  | 'closed';

export const TICKET_PRIORITIES: TicketPriority[] = ['low', 'normal', 'high', 'urgent'];

export const TICKET_STATUSES: TicketStatus[] = [
  'investigating',
  'waiting_on_client',
  'waiting_on_third_party',
  'resolved',
  'closed',
];

export interface Ticket {
  id: string;
  client_id: string;
  created_by: string | null;
  subject: string;
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  assigned_to: string | null;
  /** 'dashboard' (default), 'voice' (caller complaint), 'system' (auto-opened). */
  source: string;
  contact_id: string | null;
  call_id: string | null;
  /** Set when the auto-ticket bridge opened this from a recurring fault. */
  error_fingerprint: string | null;
  /** First client-visible staff reply. Internal notes do not count. */
  first_response_at: string | null;
  resolved_at: string | null;
  sla_response_due_at: string | null;
  sla_resolution_due_at: string | null;
  sla_breached_at: string | null;
  auto_closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TicketStatusHistory {
  id: string;
  ticket_id: string;
  from_status: TicketStatus | null;
  to_status: TicketStatus;
  changed_by: string | null;
  note: string | null;
  created_at: string;
}

export interface TicketMessage {
  id: string;
  ticket_id: string;
  author_id: string | null;
  body: string;
  /** 'internal' notes are staff-only and never returned on a client request. */
  visibility: 'client' | 'internal';
  created_at: string;
}
