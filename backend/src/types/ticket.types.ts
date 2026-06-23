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
  created_at: string;
}
