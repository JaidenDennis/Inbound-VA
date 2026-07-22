import { supabase } from '../db/index.js';
import { logger } from '../utils/index.js';
import type { Ticket, TicketMessage, TicketPriority, TicketStatus, TicketStatusHistory } from '../types/index.js';

export interface CreateTicketInput {
  clientId: string;
  createdBy: string;
  subject: string;
  description: string;
  priority: TicketPriority;
}

export interface CreateCallerTicketInput {
  clientId: string;
  contactId?: string | null;
  callId?: string | null;
  subject: string;
  description: string;
  priority: TicketPriority;
}

export class TicketService {
  /**
   * Insert a ticket (status 'investigating') and write the initial
   * status-history row (from null → investigating). The history insert is
   * logged-but-not-fatal: the ticket itself is the primary write.
   */
  async create(input: CreateTicketInput): Promise<Ticket> {
    const { data, error } = await supabase
      .from('tickets')
      .insert({
        client_id: input.clientId,
        created_by: input.createdBy,
        subject: input.subject,
        description: input.description,
        priority: input.priority,
        status: 'investigating',
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    const ticket = data as Ticket;

    const { error: histErr } = await supabase.from('ticket_status_history').insert({
      ticket_id: ticket.id,
      from_status: null,
      to_status: 'investigating',
      changed_by: input.createdBy,
    });
    if (histErr) logger.error({ err: histErr, ticketId: ticket.id }, 'Failed to write initial ticket history');

    logger.info({ ticketId: ticket.id, clientId: input.clientId }, 'Ticket created');
    return ticket;
  }

  /**
   * Create a ticket from a CALLER complaint (no dashboard user). created_by is
   * left NULL; contact/call/source record who reported it and from where. Uses
   * the additive columns from migration 014.
   */
  async createFromCaller(input: CreateCallerTicketInput): Promise<Ticket> {
    const { data, error } = await supabase
      .from('tickets')
      .insert({
        client_id: input.clientId,
        created_by: null,
        contact_id: input.contactId ?? null,
        call_id: input.callId ?? null,
        source: 'voice',
        subject: input.subject,
        description: input.description,
        priority: input.priority,
        status: 'investigating',
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    const ticket = data as Ticket;

    const { error: histErr } = await supabase.from('ticket_status_history').insert({
      ticket_id: ticket.id,
      from_status: null,
      to_status: 'investigating',
      changed_by: null,
    });
    if (histErr) logger.error({ err: histErr, ticketId: ticket.id }, 'Failed to write initial caller-ticket history');

    logger.info({ ticketId: ticket.id, clientId: input.clientId, source: 'voice' }, 'Caller complaint ticket created');
    return ticket;
  }

  async findById(id: string): Promise<Ticket | null> {
    const { data } = await supabase.from('tickets').select('*').eq('id', id).maybeSingle();
    return data as Ticket | null;
  }

  async list(opts: {
    clientId: string | null;
    status?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: Ticket[]; count: number }> {
    const page = opts.page ?? 1;
    const limit = opts.limit ?? 50;
    const from = (page - 1) * limit;
    let query = supabase
      .from('tickets')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, from + limit - 1);
    if (opts.clientId) query = query.eq('client_id', opts.clientId);
    if (opts.status) query = query.eq('status', opts.status);
    const { data, count } = await query;
    return { data: (data ?? []) as Ticket[], count: count ?? 0 };
  }

  async addMessage(input: { ticketId: string; authorId: string; body: string }): Promise<TicketMessage> {
    const { data, error } = await supabase
      .from('ticket_messages')
      .insert({ ticket_id: input.ticketId, author_id: input.authorId, body: input.body })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as TicketMessage;
  }

  async getMessages(ticketId: string): Promise<TicketMessage[]> {
    const { data } = await supabase
      .from('ticket_messages')
      .select('*')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true });
    return (data ?? []) as TicketMessage[];
  }

  /** Newest-first, for the History tab. */
  async getHistory(ticketId: string): Promise<TicketStatusHistory[]> {
    const { data } = await supabase
      .from('ticket_status_history')
      .select('*')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: false });
    return (data ?? []) as TicketStatusHistory[];
  }

  /** Update status AND append a history row in the same operation. */
  async changeStatus(input: {
    ticketId: string;
    fromStatus: TicketStatus;
    toStatus: TicketStatus;
    changedBy: string;
    note?: string;
  }): Promise<Ticket> {
    const { data, error } = await supabase
      .from('tickets')
      .update({ status: input.toStatus })
      .eq('id', input.ticketId)
      .select()
      .single();
    if (error) throw new Error(error.message);

    const { error: histErr } = await supabase.from('ticket_status_history').insert({
      ticket_id: input.ticketId,
      from_status: input.fromStatus,
      to_status: input.toStatus,
      changed_by: input.changedBy,
      note: input.note ?? null,
    });
    if (histErr) logger.error({ err: histErr, ticketId: input.ticketId }, 'Failed to write ticket status history');

    return data as Ticket;
  }

  async assign(input: { ticketId: string; assignedTo: string | null }): Promise<Ticket> {
    const { data, error } = await supabase
      .from('tickets')
      .update({ assigned_to: input.assignedTo })
      .eq('id', input.ticketId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as Ticket;
  }
}

export const ticketService = new TicketService();
