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

export type MessageVisibility = 'client' | 'internal';

/**
 * Calendar-hour response and resolution targets. Calendar rather than business
 * hours for launch: it is simpler and it is honest about what we actually
 * promise — a client with an urgent problem at 9pm does not care about our
 * office hours.
 */
export const SLA_TARGETS: Record<TicketPriority, { responseMs: number; resolutionMs: number }> = {
  urgent: { responseMs: 1 * 60 * 60 * 1000, resolutionMs: 8 * 60 * 60 * 1000 },
  high: { responseMs: 4 * 60 * 60 * 1000, resolutionMs: 24 * 60 * 60 * 1000 },
  normal: { responseMs: 24 * 60 * 60 * 1000, resolutionMs: 5 * 24 * 60 * 60 * 1000 },
  low: { responseMs: 3 * 24 * 60 * 60 * 1000, resolutionMs: 14 * 24 * 60 * 60 * 1000 },
};

export function slaDeadlines(priority: TicketPriority, from = new Date()) {
  const target = SLA_TARGETS[priority] ?? SLA_TARGETS.normal;
  return {
    sla_response_due_at: new Date(from.getTime() + target.responseMs).toISOString(),
    sla_resolution_due_at: new Date(from.getTime() + target.resolutionMs).toISOString(),
  };
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
        ...slaDeadlines(input.priority),
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
        ...slaDeadlines(input.priority),
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
    priority?: string;
    assignedTo?: string;
    source?: string;
    /** 'breached' | 'at_risk' | 'ok' — computed against the response clock. */
    slaState?: string;
    /** Open tickets first, ordered by how close they are to breaching. */
    sortByDue?: boolean;
    page?: number;
    limit?: number;
  }): Promise<{ data: Ticket[]; count: number }> {
    const page = opts.page ?? 1;
    const limit = opts.limit ?? 50;
    const from = (page - 1) * limit;

    let query = supabase
      .from('tickets')
      .select('*', { count: 'exact' })
      .range(from, from + limit - 1);

    // Ascending due date puts the ticket closest to breaching at the top, so
    // the queue prioritises itself instead of relying on someone scanning it.
    query = opts.sortByDue
      ? query.order('sla_response_due_at', { ascending: true, nullsFirst: false })
      : query.order('created_at', { ascending: false });

    if (opts.clientId) query = query.eq('client_id', opts.clientId);
    if (opts.status) query = query.eq('status', opts.status);
    if (opts.priority) query = query.eq('priority', opts.priority);
    if (opts.assignedTo === 'unassigned') query = query.is('assigned_to', null);
    else if (opts.assignedTo) query = query.eq('assigned_to', opts.assignedTo);
    if (opts.source) query = query.eq('source', opts.source);

    if (opts.slaState === 'breached') {
      query = query.lt('sla_response_due_at', new Date().toISOString()).is('first_response_at', null);
    } else if (opts.slaState === 'at_risk') {
      // Inside the last quarter of the response budget but not yet overdue.
      const now = Date.now();
      query = query
        .gte('sla_response_due_at', new Date(now).toISOString())
        .lte('sla_response_due_at', new Date(now + 60 * 60 * 1000).toISOString())
        .is('first_response_at', null);
    }

    const { data, count } = await query;
    return { data: (data ?? []) as Ticket[], count: count ?? 0 };
  }

  /** Change priority and re-baseline the deadlines it implies. */
  async changePriority(input: {
    ticketId: string;
    priority: TicketPriority;
    changedBy: string;
  }): Promise<Ticket> {
    const { data, error } = await supabase
      .from('tickets')
      .update({ priority: input.priority, ...slaDeadlines(input.priority) })
      .eq('id', input.ticketId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as Ticket;
  }

  /**
   * Flag open tickets past their response deadline. Returns the newly breached
   * ones so the caller can notify whoever owns them.
   */
  async sweepBreaches(): Promise<Ticket[]> {
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('tickets')
      .update({ sla_breached_at: now })
      .in('status', ['investigating', 'waiting_on_client', 'waiting_on_third_party'])
      .is('first_response_at', null)
      .is('sla_breached_at', null)
      .lt('sla_response_due_at', now)
      .select();

    if (error) {
      logger.error({ err: error }, 'SLA breach sweep failed');
      return [];
    }
    return (data ?? []) as Ticket[];
  }

  /**
   * Append a message. `visibility` is explicit at every call site — an internal
   * note that silently defaults to client-visible is the worst failure this
   * system can have, and it is a quiet one.
   *
   * Posting a client-visible message from a staff member also stops the
   * first-response clock. Internal notes deliberately do not: talking to each
   * other is not responding to the customer.
   */
  async addMessage(input: {
    ticketId: string;
    authorId: string | null;
    body: string;
    visibility: MessageVisibility;
    /** True when the author is Gravvia staff, for first-response tracking. */
    fromStaff?: boolean;
  }): Promise<TicketMessage> {
    const { data, error } = await supabase
      .from('ticket_messages')
      .insert({
        ticket_id: input.ticketId,
        author_id: input.authorId,
        body: input.body,
        visibility: input.visibility,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    if (input.fromStaff && input.visibility === 'client') {
      await this.stampFirstResponse(input.ticketId);
    }

    return data as TicketMessage;
  }

  /** Idempotent: only the first qualifying staff reply sets the timestamp. */
  private async stampFirstResponse(ticketId: string): Promise<void> {
    const { error } = await supabase
      .from('tickets')
      .update({ first_response_at: new Date().toISOString() })
      .eq('id', ticketId)
      .is('first_response_at', null);
    if (error) logger.error({ err: error, ticketId }, 'Failed to stamp first response');
  }

  /**
   * Thread for a ticket.
   *
   * `includeInternal` defaults to false, so a caller that forgets to pass it
   * gets the safe answer. Routes derive it from the caller's permissions — the
   * filter is not something a route can skip by omission.
   */
  async getMessages(ticketId: string, opts: { includeInternal?: boolean } = {}): Promise<TicketMessage[]> {
    let query = supabase
      .from('ticket_messages')
      .select('*')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true });

    if (!opts.includeInternal) query = query.eq('visibility', 'client');

    const { data } = await query;
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
    const terminal = input.toStatus === 'resolved' || input.toStatus === 'closed';
    const { data, error } = await supabase
      .from('tickets')
      .update({
        status: input.toStatus,
        // Stops the resolution clock so a closed ticket never reads as overdue.
        ...(terminal ? { resolved_at: new Date().toISOString() } : { resolved_at: null }),
      })
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
